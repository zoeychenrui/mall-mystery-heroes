/**
 * Layer 1b — the server-evaluated player location report callable, against
 * the real Functions, Firestore, and Auth emulators together. Each test calls
 * the callable as a real signed-in identity and asserts on the boundary
 * status and event docs that actually landed in Firestore.
 *
 * boundaryStatuses and boundaryEvents are written only by Cloud Functions, so
 * firestore.rules does not open them to clients. Tests read them through
 * createRulesBypassDb (test/emulatorHelpers.js).
 *
 * Confirmation timing uses the server's receive clock (Date.now()), which the
 * emulator runs in real time. Tests that need two outside fixes 20 s apart
 * therefore backdate the stored candidate timestamps between calls, rather
 * than waiting 20 s.
 */
const { httpsCallable } = require('firebase/functions');
const {
    collection,
    doc,
    getDoc,
    getDocs,
    terminate,
    Timestamp,
    updateDoc,
} = require('firebase/firestore');
const {
    clearFirestore,
    createIndependentIdentity,
    createRulesBypassDb,
    seedRoom,
    shutdown,
} = require('../../test/emulatorHelpers');

const ROOM = 'test-room';

// A ~220 m by ~220 m rectangle centered on INSIDE. OUTSIDE is about 1.1 km
// north, well beyond the 15 m edge tolerance.
const RING = [
    { lat: 39.999, lng: -75.001 },
    { lat: 39.999, lng: -74.999 },
    { lat: 40.001, lng: -74.999 },
    { lat: 40.001, lng: -75.001 },
    { lat: 39.999, lng: -75.001 },
];
const BOUNDARY = {
    enabled: true,
    revision: 1,
    shapeType: 'rectangle',
    vertices: RING,
    shapeParameters: null,
};
const INSIDE = { lat: 40.0, lng: -75.0 };
const OUTSIDE = { lat: 40.01, lng: -75.0 };

const fix = (point, sampleMs, extra = {}) => ({
    roomId: ROOM,
    boundaryRevision: 1,
    sampleMs,
    lat: point.lat,
    lng: point.lng,
    accuracyM: 5,
    ...extra,
});

const reportAs = (identity) => httpsCallable(identity.functions, 'reportPlayerLocation');

const identities = [];
const newIdentity = async () => {
    const identity = await createIndependentIdentity();
    identities.push(identity);
    return identity;
};

let bypass;
const statusRef = (playerKey) => doc(bypass, 'rooms', ROOM, 'boundaryStatuses', playerKey);
const readStatus = async (playerKey) => (await getDoc(statusRef(playerKey))).data();
const readStatusDocs = async () =>
    (await getDocs(collection(bypass, 'rooms', ROOM, 'boundaryStatuses'))).docs;
const readEvents = async () =>
    (await getDocs(collection(bypass, 'rooms', ROOM, 'boundaryEvents'))).docs.map((d) => d.data());

beforeAll(() => {
    bypass = createRulesBypassDb();
});
beforeEach(clearFirestore);
afterEach(async () => {
    await Promise.all(identities.splice(0).map((identity) => terminate(identity.db)));
});
afterAll(async () => {
    await terminate(bypass);
    await shutdown();
});

describe('reportPlayerLocation', () => {
    it('a valid inside fix from the matching player writes a status doc keyed by the normalized id, and no event', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const sampleMs = Date.now() - 5000;

        await reportAs(alice)(fix(INSIDE, sampleMs));

        const status = await readStatus('alice');
        expect(status).toMatchObject({
            status: 'inside',
            boundaryRevision: 1,
            uid: alice.uid,
        });
        expect(status.lastUsableReceivedAt).toBeInstanceOf(Timestamp);
        expect(await readEvents()).toEqual([]);
    });

    it('the stored status doc contains no lat or lng fields', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

        await reportAs(alice)(fix(INSIDE, Date.now() - 5000));

        const status = await readStatus('alice');
        expect(status).not.toHaveProperty('lat');
        expect(status).not.toHaveProperty('lng');
    });

    it('rejects a caller whose uid matches no player with not-found and writes nothing', async () => {
        const stranger = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: 'someone-else' }], {
            gameBoundary: BOUNDARY,
        });

        await expect(reportAs(stranger)(fix(INSIDE, Date.now() - 5000))).rejects.toMatchObject({
            code: 'functions/not-found',
        });

        expect(await readStatusDocs()).toHaveLength(0);
        expect(await readEvents()).toEqual([]);
    });

    it('rejects a caller whose uid matches two player docs with failed-precondition and writes nothing', async () => {
        const alice = await newIdentity();
        await seedRoom(
            ROOM,
            [
                { name: 'alice', uid: alice.uid },
                { name: 'alice2', uid: alice.uid },
            ],
            { gameBoundary: BOUNDARY }
        );

        await expect(reportAs(alice)(fix(INSIDE, Date.now() - 5000))).rejects.toMatchObject({
            code: 'functions/failed-precondition',
        });

        expect(await readStatusDocs()).toHaveLength(0);
    });

    it('rejects a report for a stale boundary revision with revision_conflict and writes nothing', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

        await expect(
            reportAs(alice)(fix(INSIDE, Date.now() - 5000, { boundaryRevision: 0 }))
        ).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'revision_conflict',
        });

        expect(await readStatusDocs()).toHaveLength(0);
    });

    it('rejects a sample more than 30 s old or more than 5 s in the future with invalid-argument', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);

        await expect(call(fix(INSIDE, Date.now() - 31000))).rejects.toMatchObject({
            code: 'functions/invalid-argument',
        });
        await expect(call(fix(INSIDE, Date.now() + 6000))).rejects.toMatchObject({
            code: 'functions/invalid-argument',
        });

        expect(await readStatusDocs()).toHaveLength(0);
    });

    it('rejects a sample older than the last stored sample as out-of-order and leaves the status unchanged', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 5000;
        await call(fix(INSIDE, T0 + 200));
        const before = await readStatus('alice');

        await expect(call(fix(OUTSIDE, T0 + 100))).rejects.toMatchObject({
            code: 'functions/invalid-argument',
        });

        expect(await readStatus('alice')).toEqual(before);
    });

    it('two outside fixes 20 s apart write status outside and one outside event; a third outside fix adds no event', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 25000;

        await call(fix(OUTSIDE, T0));
        expect((await readStatus('alice')).status).toBe('near');
        expect(await readEvents()).toEqual([]);

        // Backdate the first candidate by 20 s so the second fix lands 20 s
        // after it on the server clock.
        const twentySecondsAgo = Timestamp.fromMillis(Date.now() - 20000);
        await updateDoc(statusRef('alice'), {
            outsideSince: twentySecondsAgo,
            lastOutsideSampleAt: twentySecondsAgo,
        });
        await call(fix(OUTSIDE, T0 + 20000));
        expect((await readStatus('alice')).status).toBe('outside');
        let events = await readEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: 'outside', playerName: 'alice' });

        await call(fix(OUTSIDE, T0 + 23000));
        expect((await readStatus('alice')).status).toBe('outside');
        events = await readEvents();
        expect(events).toHaveLength(1);
    });

    it('an inside fix after a confirmed outside writes one returnedInside event and status inside', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 25000;
        await call(fix(OUTSIDE, T0));
        const twentySecondsAgo = Timestamp.fromMillis(Date.now() - 20000);
        await updateDoc(statusRef('alice'), {
            outsideSince: twentySecondsAgo,
            lastOutsideSampleAt: twentySecondsAgo,
        });
        await call(fix(OUTSIDE, T0 + 20000));

        await call(fix(INSIDE, T0 + 23500));

        expect((await readStatus('alice')).status).toBe('inside');
        const types = (await readEvents()).map((event) => event.type).sort();
        expect(types).toEqual(['outside', 'returnedInside']);
    });

    it('a player with a disabled boundary is rejected with "Game area is not active." and nothing is written', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], {
            gameBoundary: { ...BOUNDARY, enabled: false },
        });

        await expect(reportAs(alice)(fix(INSIDE, Date.now() - 5000))).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: 'Game area is not active.',
        });

        expect(await readStatusDocs()).toHaveLength(0);
        expect(await readEvents()).toEqual([]);
    });

    it('an error report writes status unavailable with the reason, carries no coordinates, and writes no outside event', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

        const result = await reportAs(alice)({
            roomId: ROOM,
            boundaryRevision: 1,
            sampleMs: Date.now() - 5000,
            error: 'permission_denied',
        });

        expect(result.data).toEqual({ status: 'unavailable', reason: 'permission_denied' });
        const status = await readStatus('alice');
        expect(status).toMatchObject({ status: 'unavailable', reason: 'permission_denied' });
        expect(status).not.toHaveProperty('lat');
        expect(status).not.toHaveProperty('lng');
        expect(await readEvents()).toEqual([]);
    });

    it('rate-limits a player to 20 reports per minute: the 21st gets resource-exhausted', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 5000;

        for (let i = 0; i < 20; i += 1) {
            await call(fix(INSIDE, T0 + i * 10));
        }

        await expect(call(fix(INSIDE, T0 + 500))).rejects.toMatchObject({
            code: 'functions/resource-exhausted',
        });
    });

    it('two players reporting concurrently each affect only their own status doc', async () => {
        const alice = await newIdentity();
        const bob = await newIdentity();
        await seedRoom(
            ROOM,
            [
                { name: 'alice', uid: alice.uid },
                { name: 'bob', uid: bob.uid },
            ],
            { gameBoundary: BOUNDARY }
        );
        const T0 = Date.now() - 5000;

        await Promise.all([reportAs(alice)(fix(INSIDE, T0)), reportAs(bob)(fix(OUTSIDE, T0))]);

        const aliceStatus = await readStatus('alice');
        const bobStatus = await readStatus('bob');
        expect(aliceStatus).toMatchObject({ status: 'inside', uid: alice.uid });
        expect(bobStatus).toMatchObject({ status: 'near', uid: bob.uid });
        expect(await readStatusDocs()).toHaveLength(2);
    });
});
