/**
 * Layer 1b — the host-only endGame callable, against the real Functions,
 * Firestore, and Auth emulators together. Calls it through httpsCallable as
 * a real signed-in identity and asserts on the room doc and boundaryStatuses
 * that actually landed in Firestore, not only on whether the call threw.
 */
const { initializeApp } = require('firebase/app');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');
const { doc, getDoc, setDoc, terminate, Timestamp } = require('firebase/firestore');
const { db, functions } = require('../../src/utils/firebase');
const {
    callableAsNonHost,
    clearFirestore,
    createRulesBypassDb,
    seedRoom,
    shutdown,
} = require('../../test/emulatorHelpers');

const ROOM = 'test-room';

const readRoom = async () => (await getDoc(doc(db, 'rooms', ROOM))).data();

// The client SDK surfaces HttpsError codes with a 'functions/' prefix.
const endGame = () => httpsCallable(functions, 'endGame');

// boundaryStatuses is written only by Cloud Functions, so firestore.rules
// does not open it to clients. Tests read/seed it through createRulesBypassDb
// (test/emulatorHelpers.js), the same pattern as
// gameBoundary.integration.test.js.
let bypass;
const statusRef = (playerKey) => doc(bypass, 'rooms', ROOM, 'boundaryStatuses', playerKey);
const readStatus = async (playerKey) => (await getDoc(statusRef(playerKey))).data();

beforeAll(() => {
    bypass = createRulesBypassDb();
});
beforeEach(clearFirestore);
afterAll(async () => {
    await terminate(bypass);
    await shutdown();
});

describe('endGame', () => {
    it('sets isGameActive false and endedAt, as the host', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);

        await endGame()({ roomId: ROOM });

        const room = await readRoom();
        expect(room.isGameActive).toBe(false);
        expect(room.endedAt).toBeInstanceOf(Timestamp);
    });

    it("clears every exposed player's boundary status when the game ends", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }, { name: 'bob' }]);
        await setDoc(statusRef('alice'), {
            status: 'outside',
            lat: 1,
            lng: 2,
            outsideSince: Timestamp.now(),
            outsideConfirmedAt: Timestamp.now(),
        });
        await setDoc(statusRef('bob'), {
            status: 'near',
            lat: 3,
            lng: 4,
            outsideSince: Timestamp.now(),
        });

        await endGame()({ roomId: ROOM });

        expect(await readStatus('alice')).toMatchObject({
            status: 'unavailable',
            reason: 'game_ended',
            lat: null,
            lng: null,
            outsideConfirmedAt: null,
        });
        expect(await readStatus('bob')).toMatchObject({
            status: 'unavailable',
            reason: 'game_ended',
            outsideSince: null,
        });
    });

    it('rejects a non-host caller with permission-denied and changes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();
        const call = callableAsNonHost('endGame');

        await expect(call({ roomId: ROOM })).rejects.toMatchObject({
            code: 'functions/permission-denied',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects ending an already-ended game', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }], { isGameActive: false });
        const before = await readRoom();

        await expect(endGame()({ roomId: ROOM })).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'This game has already ended.',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects ending a room that does not exist, as not-found', async () => {
        await expect(endGame()({ roomId: 'no-such-room' })).rejects.toMatchObject({
            code: 'functions/not-found',
        });
    });

    it('rejects a caller with no auth token as unauthenticated, and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();
        // A fresh Functions instance that never signs in: the request carries
        // no auth token, so context.auth is undefined on the server.
        const anonymousApp = initializeApp(
            { projectId: 'demo-mall-mystery-heroes', apiKey: 'emulator-key' },
            `unauthenticated-${Date.now()}-${Math.random()}`
        );
        const anonymousFunctions = getFunctions(anonymousApp);
        connectFunctionsEmulator(anonymousFunctions, 'localhost', 5001);
        const call = httpsCallable(anonymousFunctions, 'endGame');

        await expect(call({ roomId: ROOM })).rejects.toMatchObject({
            code: 'functions/unauthenticated',
        });

        expect(await readRoom()).toEqual(before);
    });
});
