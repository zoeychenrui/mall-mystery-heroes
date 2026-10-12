/**
 * Layer 1b — the atomic player-removal Cloud Functions, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `leaveGame` and `removePlayer` are thin
 * wrappers around `httpsCallable(functions, ...)` — these tests call them
 * exactly the way the real app does, then assert on what actually landed
 * in Firestore (docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
 */
import { leaveGame } from './leaveGame';
import { removePlayer } from './removePlayer';
import { requestReconnect } from './requestReconnect';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { auth, db } from '../utils/firebase';
import { collection, doc, getDoc, getDocs, setDoc, terminate } from 'firebase/firestore';
import {
    callableAsNonHost,
    clearFirestore,
    createRulesBypassDb,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';

// boundaryStatuses is written only by Cloud Functions, so the rules keep
// clients out of it; this bypass instance seeds and reads it directly.
let bypass;
beforeAll(() => {
    bypass = createRulesBypassDb();
});
beforeEach(clearFirestore);
afterAll(async () => {
    await terminate(bypass);
});
afterAll(shutdown);

// leaveGame resolves which player to remove from the caller's own uid, so
// every "successful leave" test needs a seeded player whose uid matches
// whoever is actually signed in when the test calls the real leaveGame
// wrapper — the shared singleton `auth`/`db` from utils/firebase, the
// same one seedRoom signs in as host on its first call in this file
// (mirrors joinRoom.integration.test.js's own use of `auth.currentUser.uid`,
// read only after an earlier seedRoom call has guaranteed sign-in
// happened). A second seedRoom call is what adds that player, since
// auth.currentUser is still null at the time of the very first seedRoom
// call in a fresh test file run.
describe('leaveGame', () => {
    it("removes the caller's own document and reassigns whoever that leaves short", async () => {
        await seedRoom(ROOM, [
            { name: 'bob', targets: [], assassins: ['alice'] },
            { name: 'carol', targets: ['alice'], assassins: [] },
        ]);
        await seedRoom(ROOM, [
            { name: 'alice', uid: auth.currentUser.uid, targets: ['bob'], assassins: ['carol'] },
        ]);

        const result = await leaveGame(ROOM);

        expect(result.removedPlayerName).toBe('alice');
        await expect(fetchPlayerForRoom('alice', ROOM)).rejects.toThrow('Player not found');

        // alice's old target (bob) needed a new assassin; alice's old
        // assassin (carol) needed a new target — both should now point at
        // each other, the only other two players left.
        expect((await fetchPlayerForRoom('bob', ROOM)).data().assassins).toEqual(['carol']);
        expect((await fetchPlayerForRoom('carol', ROOM)).data().targets).toEqual(['bob']);
        expect(result.addedTargets.carol).toEqual(['bob']);
        // Not ['carol']: with exactly two players left, planRemap's needTargets
        // pass links carol->bob first (satisfying bob's assassin need as a
        // side effect of that same link), so the later needAssassins pass for
        // bob has nothing left to do and its own `added.assassins` bookkeeping
        // — which only tracks links made during that pass — reports empty.
        // The actual write above is correct either way; this is a pre-existing
        // quirk of src/game/remapPlan.js's `added` accounting (shared,
        // pre-dating this feature and out of scope here), not a removePlayer
        // bug — killPlayer.js drives the same planRemap call and has simply
        // never had a test assert `addedAssassins` in this exact overlap shape.
        expect(result.addedAssassins.bob).toEqual([]);
    });

    it('writes a logs entry and a broadcast playerMessages entry naming the departed player', async () => {
        await seedRoom(ROOM, []);
        await seedRoom(ROOM, [{ name: 'alice', uid: auth.currentUser.uid }]);

        await leaveGame(ROOM);

        const logsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'logs'));
        expect(logsSnapshot.docs).toHaveLength(1);
        expect(logsSnapshot.docs[0].data()).toMatchObject({
            log: 'alice left the game',
            color: 'gray.400',
        });

        const messagesSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'playerMessages'));
        expect(messagesSnapshot.docs).toHaveLength(1);
        expect(messagesSnapshot.docs[0].data()).toMatchObject({
            type: 'broadcast',
            recipient: null,
            text: 'alice left the game',
            standings: null,
        });
    });

    it('succeeds and does nothing but delete the document before the game starts (empty target graph)', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        await seedRoom(ROOM, [{ name: 'alice', uid: auth.currentUser.uid }]);

        const result = await leaveGame(ROOM);

        expect(result.addedTargets).toEqual({});
        expect(result.addedAssassins).toEqual({});
        expect(result.remapLogs).toEqual([]);
        await expect(fetchPlayerForRoom('alice', ROOM)).rejects.toThrow('Player not found');
        expect((await fetchPlayerForRoom('bob', ROOM)).data()).toBeDefined();
    });

    it('rejects a caller whose uid never joined this room, writing nothing', async () => {
        // alice is seeded without a uid override, so her doc's uid never
        // matches whoever seedRoom itself just signed in as (the host) —
        // the same "no matching player doc" state leaveGame must reject.
        await seedRoom(ROOM, [{ name: 'alice' }]);

        await expect(leaveGame(ROOM)).rejects.toThrow('You have not joined this room.');
        expect((await fetchPlayerForRoom('alice', ROOM)).data()).toBeDefined();
    });

    it('rejects a caller whose uid is linked to more than one player doc in the room, writing nothing', async () => {
        // Reachable today: joinRoom only enforces *name* uniqueness, so the
        // same uid revisiting /join under a second name owns two player
        // docs in one room (docs/improvements.md item 66). Taking docs[0]
        // would silently remove whichever name sorts first — mirrors
        // submitChatMessage.integration.test.js's equivalent guard test.
        await seedRoom(ROOM, []);
        await seedRoom(ROOM, [
            { name: 'alice', uid: auth.currentUser.uid },
            { name: 'alice2', uid: auth.currentUser.uid },
        ]);

        await expect(leaveGame(ROOM)).rejects.toThrow(
            'Multiple player identities are linked to your account in this room'
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data()).toBeDefined();
        expect((await fetchPlayerForRoom('alice2', ROOM)).data()).toBeDefined();
    });

    it('rejects a room that does not exist', async () => {
        // seedRoom (for an unrelated room) is what actually signs in the
        // shared auth singleton the first time — calling it here keeps
        // this test self-contained rather than relying on an earlier test
        // in the file to have done so first, matching every test in
        // joinRoom.integration.test.js.
        await seedRoom('some-other-room', []);

        await expect(leaveGame('nonexistent-room')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });

    // A pending reconnect request left dangling after the player it names
    // is gone would still be approvable by the host into a player doc that
    // no longer exists — this must be denied inside the same removal
    // transaction, not left for something else to clean up later.
    it('auto-denies a pending reconnect request for the player who left', async () => {
        await seedRoom(ROOM, [], { gameStarted: true });
        await seedRoom(ROOM, [{ name: 'alice', uid: auth.currentUser.uid }], {
            gameStarted: true,
        });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await leaveGame(ROOM);

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('denied');
    });

    it("deletes the caller's boundary status doc in the same call", async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        await seedRoom(ROOM, [{ name: 'alice', uid: auth.currentUser.uid }]);
        await setDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'), { state: 'inside' });

        await leaveGame(ROOM);

        expect(
            (await getDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'))).exists()
        ).toBe(false);
    });
});

describe('removePlayer', () => {
    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }]);
        const removePlayerAsNonHost = callableAsNonHost('removePlayer');

        await expect(removePlayerAsNonHost({ roomId: ROOM, playerName: 'alice' })).rejects.toThrow(
            /permission-denied|host/i
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data()).toBeDefined();
    });

    it("removes the named player's document and reassigns whoever that leaves short, as the host", async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], assassins: ['carol'] },
            { name: 'bob', targets: [], assassins: ['alice'] },
            { name: 'carol', targets: ['alice'], assassins: [] },
        ]);

        const result = await removePlayer('alice', ROOM);

        expect(result.removedPlayerName).toBe('alice');
        await expect(fetchPlayerForRoom('alice', ROOM)).rejects.toThrow('Player not found');
        expect((await fetchPlayerForRoom('bob', ROOM)).data().assassins).toEqual(['carol']);
        expect((await fetchPlayerForRoom('carol', ROOM)).data().targets).toEqual(['bob']);
    });

    it('writes no logs or playerMessages entries of its own', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }]);

        await removePlayer('alice', ROOM);

        const logsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'logs'));
        expect(logsSnapshot.docs).toHaveLength(0);
        const messagesSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'playerMessages'));
        expect(messagesSnapshot.docs).toHaveLength(0);
    });

    it('rejects a player name that does not exist, writing nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }]);

        await expect(removePlayer('nobody', ROOM)).rejects.toThrow('Player not found: nobody');
        expect((await fetchPlayerForRoom('alice', ROOM)).data()).toBeDefined();
    });

    it('succeeds before the game starts (empty target graph), removing only the document', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }, { name: 'bob' }]);

        const result = await removePlayer('alice', ROOM);

        expect(result.addedTargets).toEqual({});
        expect(result.addedAssassins).toEqual({});
        expect(result.remapLogs).toEqual([]);
        await expect(fetchPlayerForRoom('alice', ROOM)).rejects.toThrow('Player not found');
    });

    // Same gap as leaveGame's equivalent test above — a pending reconnect
    // request left dangling after the player it names is gone would still
    // be approvable by the host into a player doc that no longer exists.
    it('auto-denies a pending reconnect request for the removed player', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await removePlayer('alice', ROOM);

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('denied');
    });

    it("deletes the removed player's boundary status doc in the same call", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }, { name: 'bob' }]);
        await setDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'), { state: 'inside' });

        await removePlayer('alice', ROOM);

        expect(
            (await getDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'))).exists()
        ).toBe(false);
    });

    // Deliberate, user-approved decision: removal genuinely knows whose
    // device access to revoke, unlike the reconnect case (where a stale
    // uid might legitimately belong to someone else later).
    it("prunes the removed player's uid from the room's joinedUids", async () => {
        await seedRoom(ROOM, [{ name: 'alice', uid: 'alice-device-uid' }, { name: 'bob' }], {
            joinedUids: ['alice-device-uid', 'some-other-uid'],
        });

        await removePlayer('alice', ROOM);

        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().joinedUids).not.toContain('alice-device-uid');
        expect(roomSnapshot.data().joinedUids).toContain('some-other-uid');
    });

    it('does not error when removing a player with no uid field at all', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { joinedUids: ['some-other-uid'] });

        await removePlayer('alice', ROOM);

        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().joinedUids).toEqual(['some-other-uid']);
    });
});
