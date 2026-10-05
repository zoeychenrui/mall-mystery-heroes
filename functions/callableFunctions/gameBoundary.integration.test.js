/**
 * Layer 1b — the host-only game-boundary publish and disable callables,
 * against the real Functions, Firestore, and Auth emulators together.
 * Calls each callable through httpsCallable as a real signed-in identity
 * and asserts on the room doc that actually landed in Firestore, not only
 * on whether the call threw.
 */
const { httpsCallable } = require('firebase/functions');
const { doc, getDoc, Timestamp } = require('firebase/firestore');
const { db, functions } = require('../../src/utils/firebase');
const {
    callableAsNonHost,
    clearFirestore,
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

const readRoom = async () => (await getDoc(doc(db, 'rooms', ROOM))).data();

// The client SDK surfaces HttpsError codes with a 'functions/' prefix.
const publish = () => httpsCallable(functions, 'publishGameBoundary');
const disable = () => httpsCallable(functions, 'disableGameBoundary');

beforeEach(clearFirestore);
afterAll(shutdown);

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
});

describe('disableGameBoundary', () => {
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
});
