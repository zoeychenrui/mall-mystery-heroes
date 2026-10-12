/**
 * Layer 1b — the atomic mission-completion Cloud Function, against the
 * real Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. There is no client wrapper yet (Task 4
 * adds one) — these tests call `httpsCallable(functions, 'completeMission')`
 * directly, the same way executeKill.integration.test.js calls killPlayer
 * before executeKill.js existed, then assert on what actually landed in
 * Firestore (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../utils/firebase';

const ROOM = 'test-room';
const completeMissionCallable = httpsCallable(functions, 'completeMission');

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

describe('completeMission', () => {
    it('awards points for a Task completion and returns a snapshot naming only the completing player', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 1 });

        const { data } = await completeMissionCallable({
            missionIndex: 1,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
        expect((await fetchTask(1)).completedBy).toEqual(['alice']);
        expect(data.reversalSnapshot).toEqual({
            missionIndex: 1,
            playerName: 'alice',
            wasAutoEnded: false,
            players: {
                alice: { score: 5, targets: [], assassins: [], isAlive: true, openSeason: false },
            },
        });
        expect(data.taskTitle).toBe('Find the clue');
        expect(data.maxCompletions).toBeNull();
        expect(data.revivesPlayer).toBe(false);
    });

    it('revives the player for a Revival Mission completion and reassigns targets for everyone the regen touched', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', isAlive: false, score: 0 },
            { name: 'bob', targets: [], assassins: [] },
        ]);
        await seedTask({ taskIndex: 2, taskType: 'Revival Mission', pointValue: '0' });

        const { data } = await completeMissionCallable({
            missionIndex: 2,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().isAlive).toBe(true);
        // bob is the only other alive player, so the revived alice must
        // have been assigned to bob (or vice versa) — proves the regen
        // step actually ran, not just the revival flag flip.
        expect(data.addedTargets).toBeDefined();
        const bobAfter = (await fetchPlayerForRoom('bob', ROOM)).data();
        const aliceAfter = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect([...bobAfter.targets, ...aliceAfter.targets].length).toBeGreaterThan(0);
        // The snapshot must name every player the regen touched, not just alice.
        expect(Object.keys(data.reversalSnapshot.players)).toEqual(
            expect.arrayContaining(['alice', 'bob'])
        );
        expect(data.revivesPlayer).toBe(true);
    });

    it('sets isComplete and wasAutoEnded once maxCompletions is reached', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        await seedTask({ taskIndex: 3, maxCompletions: 1 });

        const { data } = await completeMissionCallable({
            missionIndex: 3,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchTask(3)).isComplete).toBe(true);
        expect(data.reversalSnapshot.wasAutoEnded).toBe(true);
        expect(data.taskTitle).toBe('Find the clue');
        expect(data.maxCompletions).toBe(1);
        expect(data.revivesPlayer).toBe(false);
    });

    it('does not set wasAutoEnded when maxCompletions is not yet reached', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', score: 0 },
            { name: 'bob', score: 0 },
        ]);
        await seedTask({ taskIndex: 4, maxCompletions: 2 });

        const { data } = await completeMissionCallable({
            missionIndex: 4,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchTask(4)).isComplete).toBe(false);
        expect(data.reversalSnapshot.wasAutoEnded).toBe(false);
    });

    it('rejects an invalid mission index and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);

        await expect(
            completeMissionCallable({ missionIndex: 99, playerName: 'alice', roomId: ROOM })
        ).rejects.toThrow('Invalid task index');
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(0);
    });

    it('rejects a Revival Mission completion for a player who is not dead, and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice', isAlive: true, score: 0 }]);
        await seedTask({ taskIndex: 5, taskType: 'Revival Mission', pointValue: '0' });

        await expect(
            completeMissionCallable({ missionIndex: 5, playerName: 'alice', roomId: ROOM })
        ).rejects.toThrow('is not dead');
        expect((await fetchTask(5)).completedBy).toEqual([]);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        await seedTask({ taskIndex: 6 });
        const callAsNonHost = callableAsNonHost('completeMission');

        await expect(
            callAsNonHost({ missionIndex: 6, playerName: 'alice', roomId: ROOM })
        ).rejects.toThrow(/permission-denied|host/i);
        expect((await fetchTask(6)).completedBy).toEqual([]);
    });
});
