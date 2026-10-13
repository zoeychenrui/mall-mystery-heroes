/**
 * Layer 1b — the host-only game-boundary publish and disable callables,
 * against the real Functions, Firestore, and Auth emulators together.
 * Calls each callable through httpsCallable as a real signed-in identity
 * and asserts on the room doc that actually landed in Firestore, not only
 * on whether the call threw.
 */
const { initializeApp } = require('firebase/app');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');
const { doc, getDoc, setDoc, terminate, Timestamp } = require('firebase/firestore');
const { db, functions } = require('../../src/utils/firebase');
const { shapeToPolygon } = require('../vendor/game/gameBoundary');
const {
    callableAsNonHost,
    clearFirestore,
    createRulesBypassDb,
    seedRoom,
    shutdown,
} = require('../../test/emulatorHelpers');

const ROOM = 'test-room';

const RECTANGLE_CORNERS = [
    { lat: 0.001, lng: 0.001 },
    { lat: 0.002, lng: 0.002 },
];
const RECTANGLE_VERTICES = [
    { lat: 0.001, lng: 0.001 },
    { lat: 0.001, lng: 0.002 },
    { lat: 0.002, lng: 0.002 },
    { lat: 0.002, lng: 0.001 },
    { lat: 0.001, lng: 0.001 },
];
const RECTANGLE_PUBLISH = {
    roomId: ROOM,
    expectedRevision: 0,
    shapeType: 'rectangle',
    vertices: RECTANGLE_VERTICES,
    shapeParameters: { corners: RECTANGLE_CORNERS },
};

// A figure-eight: a closed ring whose edges cross, so validateBoundaryShape
// rejects it on self-intersection.
const BOW_TIE_VERTICES = [
    { lat: 0.001, lng: 0.001 },
    { lat: 0.002, lng: 0.002 },
    { lat: 0.002, lng: 0.001 },
    { lat: 0.001, lng: 0.002 },
    { lat: 0.001, lng: 0.001 },
];

// An already-enabled boundary at revision 1, for tests that disable it.
const ENABLED_BOUNDARY = {
    enabled: true,
    revision: 1,
    shapeType: 'rectangle',
    vertices: RECTANGLE_VERTICES,
    shapeParameters: { corners: RECTANGLE_CORNERS },
};

const readRoom = async () => (await getDoc(doc(db, 'rooms', ROOM))).data();

// The client SDK surfaces HttpsError codes with a 'functions/' prefix.
const publish = () => httpsCallable(functions, 'publishGameBoundary');
const disable = () => httpsCallable(functions, 'disableGameBoundary');

// boundaryStatuses is written only by Cloud Functions, so firestore.rules
// does not open it to clients. Tests read/seed it through createRulesBypassDb
// (test/emulatorHelpers.js), the same pattern as
// reportPlayerLocation.integration.test.js.
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

describe('publishGameBoundary', () => {
    it('host publishes a valid rectangle: room gets gameBoundary at revision 1 with the vertices and shapeType', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);

        const result = await publish()(RECTANGLE_PUBLISH);

        expect(result.data).toEqual({ revision: 1 });
        const room = await readRoom();
        expect(room.gameBoundary).toMatchObject({
            enabled: true,
            revision: 1,
            shapeType: 'rectangle',
            vertices: RECTANGLE_VERTICES,
        });
        expect(room.gameBoundary.updatedAt).toBeInstanceOf(Timestamp);
    });

    it('stores each vertex with only lat and lng, dropping any extra keys', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const withExtraKeys = RECTANGLE_VERTICES.map((p) => ({ ...p, accuracy: 3, note: 'x' }));

        await publish()({ ...RECTANGLE_PUBLISH, vertices: withExtraKeys });

        expect((await readRoom()).gameBoundary.vertices).toEqual(RECTANGLE_VERTICES);
    });

    it('a second publish with expectedRevision 1 yields revision 2', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        await publish()(RECTANGLE_PUBLISH);

        const result = await publish()({ ...RECTANGLE_PUBLISH, expectedRevision: 1 });

        expect(result.data).toEqual({ revision: 2 });
        expect((await readRoom()).gameBoundary.revision).toBe(2);
    });

    it('rejects a stale expectedRevision with revision_conflict and leaves the room unchanged', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }], {
            gameBoundary: {
                enabled: true,
                revision: 2,
                shapeType: 'rectangle',
                vertices: RECTANGLE_VERTICES,
                shapeParameters: { corners: RECTANGLE_CORNERS },
            },
        });
        const before = await readRoom();

        await expect(
            publish()({ ...RECTANGLE_PUBLISH, expectedRevision: 1 })
        ).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'revision_conflict',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects a non-host caller with permission-denied and leaves the room unchanged', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();
        const call = callableAsNonHost('publishGameBoundary');

        await expect(call(RECTANGLE_PUBLISH)).rejects.toMatchObject({
            code: 'functions/permission-denied',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects an invalid shape (bow-tie) with invalid-argument and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();

        await expect(
            publish()({
                roomId: ROOM,
                expectedRevision: 0,
                shapeType: 'freehand',
                vertices: BOW_TIE_VERTICES,
                shapeParameters: null,
            })
        ).rejects.toMatchObject({ code: 'functions/invalid-argument' });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects publishing on an ended room with "This game has ended."', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }], { isGameActive: false });
        const before = await readRoom();

        await expect(publish()(RECTANGLE_PUBLISH)).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'This game has ended.',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects a rectangle whose shapeParameters corners do not match its vertices, and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();

        await expect(
            publish()({
                ...RECTANGLE_PUBLISH,
                shapeParameters: {
                    corners: [
                        { lat: 0.001, lng: 0.001 },
                        { lat: 0.003, lng: 0.003 },
                    ],
                },
            })
        ).rejects.toMatchObject({ code: 'functions/invalid-argument' });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects a freehand boundary that carries non-null shapeParameters, and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();

        await expect(
            publish()({
                roomId: ROOM,
                expectedRevision: 0,
                shapeType: 'freehand',
                vertices: RECTANGLE_VERTICES,
                shapeParameters: { corners: RECTANGLE_CORNERS },
            })
        ).rejects.toMatchObject({ code: 'functions/invalid-argument' });

        expect(await readRoom()).toEqual(before);
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
        const call = httpsCallable(anonymousFunctions, 'publishGameBoundary');

        await expect(call(RECTANGLE_PUBLISH)).rejects.toMatchObject({
            code: 'functions/unauthenticated',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('rejects publishing to a room that does not exist as not-found, and creates nothing', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);

        await expect(
            publish()({ ...RECTANGLE_PUBLISH, roomId: 'no-such-room' })
        ).rejects.toMatchObject({ code: 'functions/not-found' });

        expect((await getDoc(doc(db, 'rooms', 'no-such-room'))).exists()).toBe(false);
    });

    it('host publishes a valid circle built from its parameters', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const shapeParameters = {
            center: { lat: 0.0015, lng: 0.0015 },
            radiusMeters: 50,
        };
        const vertices = shapeToPolygon('circle', shapeParameters);

        const result = await publish()({
            roomId: ROOM,
            expectedRevision: 0,
            shapeType: 'circle',
            vertices,
            shapeParameters,
        });

        expect(result.data).toEqual({ revision: 1 });
        const room = await readRoom();
        expect(room.gameBoundary).toMatchObject({
            enabled: true,
            revision: 1,
            shapeType: 'circle',
        });
    });

    it('host publishes a valid oval built from its parameters', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const shapeParameters = {
            center: { lat: 0.0015, lng: 0.0015 },
            radiusXMeters: 80,
            radiusYMeters: 40,
        };
        const vertices = shapeToPolygon('oval', shapeParameters);

        const result = await publish()({
            roomId: ROOM,
            expectedRevision: 0,
            shapeType: 'oval',
            vertices,
            shapeParameters,
        });

        expect(result.data).toEqual({ revision: 1 });
        const room = await readRoom();
        expect(room.gameBoundary).toMatchObject({ enabled: true, revision: 1, shapeType: 'oval' });
    });
});

describe('disableGameBoundary', () => {
    it('rejects disabling a room that has no game area, and leaves the room unchanged', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const before = await readRoom();

        await expect(disable()({ roomId: ROOM, expectedRevision: 0 })).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'There is no game area to disable.',
        });

        expect(await readRoom()).toEqual(before);
    });

    it('disable with the correct expectedRevision sets enabled false, increments revision, and keeps the shape', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }], {
            gameBoundary: {
                enabled: true,
                revision: 2,
                shapeType: 'rectangle',
                vertices: RECTANGLE_VERTICES,
                shapeParameters: { corners: RECTANGLE_CORNERS },
            },
        });

        const result = await disable()({ roomId: ROOM, expectedRevision: 2 });

        expect(result.data).toEqual({ revision: 3 });
        const room = await readRoom();
        expect(room.gameBoundary).toMatchObject({
            enabled: false,
            revision: 3,
            shapeType: 'rectangle',
            vertices: RECTANGLE_VERTICES,
            shapeParameters: { corners: RECTANGLE_CORNERS },
        });
        expect(room.gameBoundary.updatedAt).toBeInstanceOf(Timestamp);
    });

    it('rejects a stale revision with revision_conflict and leaves the room unchanged', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }], {
            gameBoundary: {
                enabled: true,
                revision: 2,
                shapeType: 'rectangle',
                vertices: RECTANGLE_VERTICES,
                shapeParameters: { corners: RECTANGLE_CORNERS },
            },
        });
        const before = await readRoom();

        await expect(disable()({ roomId: ROOM, expectedRevision: 1 })).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'revision_conflict',
        });

        expect(await readRoom()).toEqual(before);
    });

    it("clears every exposed player's boundary status when the boundary is disabled", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }, { name: 'bob' }], {
            gameBoundary: ENABLED_BOUNDARY,
        });
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

        await disable()({ roomId: ROOM, expectedRevision: 1 });

        expect(await readStatus('alice')).toMatchObject({
            status: 'unavailable',
            reason: 'boundary_disabled',
            lat: null,
            lng: null,
            outsideConfirmedAt: null,
        });
        expect(await readStatus('bob')).toMatchObject({
            status: 'unavailable',
            reason: 'boundary_disabled',
            outsideSince: null,
        });
    });

    it('does not throw when disabling a boundary for a player with no boundaryStatuses document at all', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameBoundary: ENABLED_BOUNDARY });
        // No boundaryStatuses document seeded for alice at all.

        await expect(disable()({ roomId: ROOM, expectedRevision: 1 })).resolves.toBeDefined();
    });

    it("leaves an already-inside player's boundary status untouched when the boundary is disabled", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameBoundary: ENABLED_BOUNDARY });
        await setDoc(statusRef('alice'), { status: 'inside' });

        await disable()({ roomId: ROOM, expectedRevision: 1 });

        expect(await readStatus('alice')).toEqual({ status: 'inside' });
    });
});
