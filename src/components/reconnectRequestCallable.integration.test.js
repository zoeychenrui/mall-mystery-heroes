/**
 * Layer 1b — the reconnect-request Cloud Functions, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `requestReconnect`,
 * `approveReconnectRequest`, and `denyReconnectRequest` are thin wrappers
 * around `httpsCallable(functions, ...)` — these tests call them exactly
 * the way the real app does, then assert on what actually landed in
 * Firestore (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 */
import { requestReconnect } from './requestReconnect';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';
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

// requestReconnect resolves the caller purely from context.auth.uid — it
// never needs to already own a player doc (that's the entire premise:
// the caller has just lost the identity that used to). The shared
// singleton `auth`/`db` from utils/firebase, signed in as host by
// seedRoom's own first call, doubles as "some other signed-in device"
// for these tests, matching this codebase's own established shortcut
// (see removePlayerCallable.integration.test.js's identical reasoning)
// rather than always reaching for createIndependentIdentity.
describe('requestReconnect', () => {
    it('creates a pending request for an existing player name', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });

        const result = await requestReconnect(ROOM, 'alice');

        expect(result.requestId).toBeDefined();
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', result.requestId)
        );
        expect(requestSnapshot.data()).toMatchObject({
            playerName: 'alice',
            trimmedNameLowerCase: 'alice',
            requestingUid: auth.currentUser.uid,
            status: 'pending',
        });
    });

    it('rejects a second request for the same player from the same device while one is already pending', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        await requestReconnect(ROOM, 'alice');

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'You already have a pending reconnect request for this player'
        );

        const requestsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'reconnectRequests'));
        expect(requestsSnapshot.docs).toHaveLength(1);
    });

    it('creates a pending join request for a name with no matching player', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });

        const result = await requestReconnect(ROOM, 'nobody');
        expect(result.requestId).toBeDefined();

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', result.requestId)
        );
        expect(requestSnapshot.data()).toMatchObject({
            playerName: 'nobody',
            trimmedNameLowerCase: 'nobody',
            requestType: 'join',
            status: 'pending',
        });
        const requestsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'reconnectRequests'));
        expect(requestsSnapshot.docs).toHaveLength(1);
    });

    it('rejects a room where the game has not started yet', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: false });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This room has not started a game yet — just join normally.'
        );
    });

    it('rejects a room that has already ended', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], {
            gameStarted: true,
            isGameActive: false,
            endedAt: new Date(),
        });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This room is no longer active.'
        );
    });

    it('rejects a room that does not exist', async () => {
        await seedRoom('some-other-room', []);

        await expect(requestReconnect('nonexistent-room', 'alice')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });

    // docs/improvements.md item 66: without this check, an already-joined
    // caller (or the host, mis-tapping "Join Game") submitting the join
    // form under someone else's name after the game has started falls
    // straight through joinRoom.js's own "already started" rejection into
    // this reconnect fallback — the guard this test covers is what stops
    // that uid from ending up linked to a second player doc.
    it('rejects a caller whose uid is already in joinedUids, writing nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], {
            gameStarted: true,
            joinedUids: [auth.currentUser.uid],
        });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This device is already signed in as a player in this room.'
        );
        const requestsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'reconnectRequests'));
        expect(requestsSnapshot.docs).toHaveLength(0);
    });

    // The stored casing/whitespace round-trip: playerName/trimmedNameLowerCase
    // on the request must reflect the player document's actual stored
    // values, not whatever the requester happened to type.
    it('stores the real stored casing and a normalized lookup key regardless of what was typed', async () => {
        await seedRoom(ROOM, [{ name: 'Alice Smith' }], { gameStarted: true });

        const result = await requestReconnect(ROOM, '  alice smith ');

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', result.requestId)
        );
        expect(requestSnapshot.data()).toMatchObject({
            playerName: 'Alice Smith',
            trimmedNameLowerCase: 'alicesmith',
        });

        await approveReconnectRequest(ROOM, result.requestId);

        expect((await fetchPlayerForRoom('Alice Smith', ROOM)).data().uid).toBe(
            auth.currentUser.uid
        );
    });
});

describe('approveReconnectRequest', () => {
    it("re-links the player document's uid and adds the requester to joinedUids", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await approveReconnectRequest(ROOM, requestId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBe(auth.currentUser.uid);
        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().joinedUids).toContain(auth.currentUser.uid);
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('approved');
    });

    // The old identity's status trail must not carry over to the new uid:
    // approval deletes the player's boundaryStatuses doc, so the re-linked
    // player starts fresh.
    it("deletes the player's old boundary status doc on approval", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        await setDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'), { state: 'inside' });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await approveReconnectRequest(ROOM, requestId);

        expect(
            (await getDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'))).exists()
        ).toBe(false);
    });

    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const approveAsNonHost = callableAsNonHost('approveReconnectRequest');

        await expect(approveAsNonHost({ roomId: ROOM, requestId })).rejects.toThrow(
            /permission-denied|host/i
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
    });

    it('rejects a request that has already been resolved', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await approveReconnectRequest(ROOM, requestId);

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been approved.'
        );
    });

    // Belt-and-braces version of requestReconnect's own joinedUids check
    // (docs/improvements.md item 66): the request sat pending while its
    // requester joined the room under a different name by some other route
    // in the meantime.
    it("rejects when the requester's uid already owns a different player doc by approval time, mutating nothing", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await setDoc(doc(db, 'rooms', ROOM, 'players', 'bob'), {
            name: 'bob',
            trimmedNameLowerCase: 'bob',
            uid: auth.currentUser.uid,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This device is already linked to a different player in this room.'
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('pending');
    });

    // Before removePlayer.js's own removeAndRemap auto-denied a departing
    // player's pending reconnect requests (final review, cross-feature
    // player-removal/reconnect seam), this request would still be
    // "pending" here and approval would fail on the player-doc lookup
    // instead — that path is effectively unreachable through the public
    // API now, since removal always resolves the request first, in the
    // very same transaction that deletes the player.
    it('rejects a request naming a player who was removed, since removal already denied it', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const { removePlayer } = await import('./removePlayer');
        await removePlayer('alice', ROOM);

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('denied');

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been denied.'
        );
    });
});

describe('denyReconnectRequest', () => {
    it('marks the request denied and writes nothing else', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await denyReconnectRequest(ROOM, requestId);

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('denied');
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
    });

    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const denyAsNonHost = callableAsNonHost('denyReconnectRequest');

        await expect(denyAsNonHost({ roomId: ROOM, requestId })).rejects.toThrow(
            /permission-denied|host/i
        );
    });

    it('rejects a request that has already been resolved', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await denyReconnectRequest(ROOM, requestId);

        await expect(denyReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been denied.'
        );
    });
});
