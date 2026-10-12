/**
 * Layer 1b — the atomic kill-undo Cloud Function, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `undoKill` is a thin wrapper around
 * `httpsCallable(functions, 'undoKillPlayer')` — these tests call it
 * exactly the way the real app does, then assert on what actually landed
 * in Firestore, rather than asserting against the function's internals
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). Each test
 * builds a real approved kill photo first (via a raw pending-photo doc,
 * seeded directly in the same shape the client's own kill-photo write path
 * produces, then the real `executeKill` + `approvePhotoForRoom`), matching
 * exactly what `PhotosDisplay.js`'s Accept flow does, so the snapshot being
 * undone is genuine, not hand-constructed.
 */
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp } from 'firebase/firestore';
import { undoKill } from './undoKill';
import { executeKill } from './executeKill';
import {
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
} from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';
import { db } from '../utils/firebase';
import { normalizePlayerName } from '../game/playerNames';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

const latestPhotoId = async () => {
    const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
    return snapshot.docs[0].id;
};

// Seeds a raw pending photo doc directly in Firestore, matching the shape
// the client's kill-photo submission path writes (Task 5 of
// docs/superpowers/sdd/2026-08-22-identity-verified-player-writes moved
// that write behind the identity-verified `submitKillPhoto` Cloud Function)
// — undoKill only cares that an approved-then-undone photo doc exists with
// this shape, not which code path wrote it.
const seedPendingPhoto = async (assassin, target) => {
    const photosRef = collection(db, 'rooms', ROOM, 'photos');
    await addDoc(photosRef, {
        url: 'https://example.com/photo.jpg',
        assassin,
        target,
        timestamp: serverTimestamp(),
        status: 'pending',
        originalPlayerData: null,
    });
};

describe('undoKill', () => {
    it('reverts a simple kill: killer and target both restored, photo back to pending', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await seedPendingPhoto('alice', 'bob');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, 'bob', killResult.preKillSnapshot);

        await undoKill(ROOM, photoId);

        const alice = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect(alice.score).toBe(10);
        expect(alice.targets).toEqual(['bob']);
        expect(alice.assassins).toEqual([]);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.score).toBe(5);
        expect(bob.targets).toEqual([]);
        expect(bob.assassins).toEqual(['alice']);

        const photoSnapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(photoSnapshot.docs[0].data().status).toBe('pending');
    });

    it('reverts a kill whose remap touched a third player, restoring their targets/assassins too', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
            { name: 'carol', targets: [], assassins: [] },
        ]);
        await seedPendingPhoto('alice', 'bob');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, 'bob', killResult.preKillSnapshot);

        // Confirm the remap actually touched carol before undoing, so this
        // test is proven non-vacuous.
        expect((await fetchPlayerForRoom('carol', ROOM)).data().assassins).toEqual(['alice']);

        await undoKill(ROOM, photoId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(10);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().targets).toEqual(['bob']);
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);

        const carol = (await fetchPlayerForRoom('carol', ROOM)).data();
        expect(carol.targets).toEqual([]);
        expect(carol.assassins).toEqual([]);
    });

    it('rejects undo of a photo that is not approved', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await seedPendingPhoto('alice', 'bob');
        const photoId = await latestPhotoId();
        // Photo is still 'pending' — never approved.

        await expect(undoKill(ROOM, photoId)).rejects.toThrow(/not approved|nothing to undo/i);

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);
    });

    it('restores openSeason on the target after undoing an open-season kill', async () => {
        // bob has no assigned hunter at all — alice is not on bob's
        // assassins list and bob is not on alice's targets list — so the
        // ONLY valid kill path here is bob's own openSeason flag. This
        // proves the scenario is real, not vacuous: if openSeason were not
        // actually driving the kill's validity, executeKill would reject it.
        await seedRoom(ROOM, [
            { name: 'alice', targets: [], assassins: [], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: [], openSeason: true },
        ]);
        await seedPendingPhoto('alice', 'bob');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, 'bob', killResult.preKillSnapshot);

        // The kill itself clears openSeason on the target.
        expect((await fetchPlayerForRoom('bob', ROOM)).data().openSeason).toBe(false);

        await undoKill(ROOM, photoId);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.openSeason).toBe(true);
    });

    it('rejects undo when a snapshotted player no longer exists, and mutates nothing', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await seedPendingPhoto('alice', 'bob');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, 'bob', killResult.preKillSnapshot);

        // Simulates the room's player list changing in some unexpected way
        // between the kill and the undo — delete the killer's own doc
        // directly, bypassing the normal app flow, which has no "remove a
        // player entirely" path for a still-referenced killer.
        await deleteDoc(doc(db, 'rooms', ROOM, 'players', normalizePlayerName('alice')));

        await expect(undoKill(ROOM, photoId)).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: expect.stringMatching(/no longer exists/i),
        });

        // Bob (who could have been resolved and restored) must not have
        // been touched either — this is one atomic transaction, not a
        // best-effort partial restore.
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
        const photoSnapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(photoSnapshot.docs[0].data().status).toBe('approved');
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await seedPendingPhoto('alice', 'bob');
        const photoId = await latestPhotoId();
        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, 'bob', killResult.preKillSnapshot);

        const undoAsNonHost = callableAsNonHost('undoKillPlayer');
        await expect(undoAsNonHost({ roomId: ROOM, photoId })).rejects.toThrow(
            /permission-denied|host/i
        );

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });
});
