/**
 * Layer 1b — the atomic mission-undo Cloud Functions, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. There is no client wrapper yet (Task 4
 * adds one) — these tests call httpsCallable directly, the same way
 * undoKill.integration.test.js calls undoKillPlayer before undoKill.js
 * existed, then assert on what actually landed in Firestore
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 */
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../utils/firebase';
import { collection, addDoc, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';
const completeMissionCallable = httpsCallable(functions, 'completeMission');
const undoMissionPhotoApprovalCallable = httpsCallable(functions, 'undoMissionPhotoApproval');
const undoMissionCommandCallable = httpsCallable(functions, 'undoMissionCommand');

beforeEach(clearFirestore);
afterAll(shutdown);

const seedTask = async (task) => {
    const tasksRef = collection(db, 'rooms', ROOM, 'tasks');
    await addDoc(tasksRef, {
        title: 'Find the clue',
        description: 'Look around',
        taskType: 'Task',
        pointValue: '10',
        maxCompletions: null,
        isComplete: false,
        completedBy: [],
        dateCreated: '12:00',
        ...task,
    });
};

const fetchTask = async (taskIndex) => {
    const tasksRef = collection(db, 'rooms', ROOM, 'tasks');
    const snapshot = await getDocs(query(tasksRef, where('taskIndex', '==', taskIndex)));
    return snapshot.docs[0].data();
};

const seedApprovedMissionPhoto = async (assassin, missionIndex, reversalSnapshot) => {
    const photosRef = collection(db, 'rooms', ROOM, 'photos');
    const ref = await addDoc(photosRef, {
        url: 'https://example.com/photo.jpg',
        assassin,
        target: null,
        mission: missionIndex,
        missionUndoSnapshot: reversalSnapshot,
        timestamp: new Date(),
        status: 'approved',
        originalPlayerData: null,
    });
    return ref.id;
};

describe('undoMissionPhotoApproval', () => {
    it('restores the player and resets the photo to pending', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 1 });
        const { data } = await completeMissionCallable({
            missionIndex: 1,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 1, data.reversalSnapshot);

        await undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
        expect((await fetchTask(1)).completedBy).toEqual([]);
        const photoSnapshot = await getDoc(doc(db, 'rooms', ROOM, 'photos', photoId));
        expect(photoSnapshot.data().status).toBe('pending');
    });

    it('un-sets isComplete only when the completion had auto-ended the mission', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        await seedTask({ taskIndex: 2, maxCompletions: 1 });
        const { data } = await completeMissionCallable({
            missionIndex: 2,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 2, data.reversalSnapshot);
        expect((await fetchTask(2)).isComplete).toBe(true);

        await undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId });

        expect((await fetchTask(2)).isComplete).toBe(false);
    });

    it('rejects undo of a photo that is not approved', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        const photosRef = collection(db, 'rooms', ROOM, 'photos');
        const ref = await addDoc(photosRef, {
            url: 'https://example.com/photo.jpg',
            assassin: 'alice',
            target: null,
            mission: null,
            missionUndoSnapshot: null,
            timestamp: new Date(),
            status: 'pending',
            originalPlayerData: null,
        });

        await expect(
            undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId: ref.id })
        ).rejects.toThrow(/not approved|nothing to undo/i);
    });

    it('rejects undo when a snapshotted player no longer exists, and mutates nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 3 });
        const { data } = await completeMissionCallable({
            missionIndex: 3,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 3, data.reversalSnapshot);
        // Simulates the roster changing unexpectedly between completion and undo.
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'rooms', ROOM, 'players', 'alice'));

        await expect(
            undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId })
        ).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: expect.stringMatching(/no longer exists/i),
        });
        const photoSnapshot = await getDoc(doc(db, 'rooms', ROOM, 'photos', photoId));
        expect(photoSnapshot.data().status).toBe('approved');
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 4 });
        const { data } = await completeMissionCallable({
            missionIndex: 4,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 4, data.reversalSnapshot);
        const undoAsNonHost = callableAsNonHost('undoMissionPhotoApproval');

        await expect(undoAsNonHost({ roomId: ROOM, photoId })).rejects.toThrow(
            /permission-denied|host/i
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
    });

    it('rejects undo of a photo approved before mission-undo shipped (no missionUndoSnapshot), and mutates nothing', async () => {
        // Photos approved as missions by the mission-completion-via-photo
        // feature (which shipped before mission-undo) have status:
        // 'approved' and mission set, but no missionUndoSnapshot field at
        // all — it didn't exist yet when they were approved.
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        const photosRef = collection(db, 'rooms', ROOM, 'photos');
        const ref = await addDoc(photosRef, {
            url: 'https://example.com/photo.jpg',
            assassin: 'alice',
            target: null,
            mission: 1,
            timestamp: new Date(),
            status: 'approved',
            originalPlayerData: null,
        });

        await expect(
            undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId: ref.id })
        ).rejects.toThrow(/predates undo support/i);
        const photoSnapshot = await getDoc(doc(db, 'rooms', ROOM, 'photos', ref.id));
        expect(photoSnapshot.data().status).toBe('approved');
    });
});

describe('undoMissionCommand', () => {
    const recordLastMissionCommandCompletion = async (reversalSnapshot) => {
        const { updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'rooms', ROOM), { lastMissionCommandCompletion: reversalSnapshot });
    };

    it('restores the player and clears lastMissionCommandCompletion', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 1 });
        const { data } = await completeMissionCallable({
            missionIndex: 1,
            playerName: 'alice',
            roomId: ROOM,
        });
        await recordLastMissionCommandCompletion(data.reversalSnapshot);

        await undoMissionCommandCallable({ roomId: ROOM });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
        expect((await fetchTask(1)).completedBy).toEqual([]);
        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().lastMissionCommandCompletion).toBeNull();
    });

    it('rejects when there is nothing to undo', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        // lastMissionCommandCompletion was never set.

        await expect(undoMissionCommandCallable({ roomId: ROOM })).rejects.toThrow(
            /nothing to undo/i
        );
    });

    it('rejects a second undo once the field has already been cleared', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 2 });
        const { data } = await completeMissionCallable({
            missionIndex: 2,
            playerName: 'alice',
            roomId: ROOM,
        });
        await recordLastMissionCommandCompletion(data.reversalSnapshot);
        await undoMissionCommandCallable({ roomId: ROOM });

        await expect(undoMissionCommandCallable({ roomId: ROOM })).rejects.toThrow(
            /nothing to undo/i
        );
        // The first undo's restore must not be re-applied a second time.
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 3 });
        const { data } = await completeMissionCallable({
            missionIndex: 3,
            playerName: 'alice',
            roomId: ROOM,
        });
        await recordLastMissionCommandCompletion(data.reversalSnapshot);
        const undoAsNonHost = callableAsNonHost('undoMissionCommand');

        await expect(undoAsNonHost({ roomId: ROOM })).rejects.toThrow(/permission-denied|host/i);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
    });
});
