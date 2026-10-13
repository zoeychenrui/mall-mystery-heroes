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
const { functions: hostFunctions } = require('../../src/utils/firebase');
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
// killPlayer is host-only; the shared singleton from src/utils/firebase is
// signed in as the host (seedRoom's hostUid(), same pattern
// gameBoundary.integration.test.js uses to call host-only callables).
const killPlayer = httpsCallable(hostFunctions, 'killPlayer');

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

    it('a valid fix writes lat and lng onto the status doc', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

        await reportAs(alice)(fix(INSIDE, Date.now() - 5000));

        const status = await readStatus('alice');
        expect(status.lat).toBe(INSIDE.lat);
        expect(status.lng).toBe(INSIDE.lng);
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

    it('a sample more than 30 s old or more than 5 s in the future writes status unavailable with clock_skew, keeps lastSampleMs, and writes no event', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);

        const old = await call(fix(INSIDE, Date.now() - 31000));
        expect(old.data).toEqual({ status: 'unavailable', reason: 'clock_skew' });
        expect(await readStatus('alice')).toMatchObject({
            status: 'unavailable',
            reason: 'clock_skew',
            lastSampleAt: null,
        });

        const future = await call(fix(INSIDE, Date.now() + 6000));
        expect(future.data).toEqual({ status: 'unavailable', reason: 'clock_skew' });
        expect((await readStatus('alice')).lastSampleAt).toBeNull();

        // A valid sample after the skewed ones is still accepted, so the skewed
        // samples did not move lastSampleMs.
        const valid = await call(fix(INSIDE, Date.now() - 5000));
        expect(valid.data).toEqual({ status: 'inside', reason: null });
        expect(await readEvents()).toEqual([]);
    });

    it('a brand-new player whose first-ever report is clock-skewed writes null lat and lng, not absent fields', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

        const result = await reportAs(alice)(fix(INSIDE, Date.now() - 31000));

        expect(result.data).toEqual({ status: 'unavailable', reason: 'clock_skew' });
        const status = await readStatus('alice');
        expect(status.lat).toBeNull();
        expect(status.lng).toBeNull();
    });

    it('a clock-skew report leaves a stored lastSampleAt unchanged', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 5000;
        await call(fix(INSIDE, T0));
        const storedSample = (await readStatus('alice')).lastSampleAt.toMillis();

        const skewed = await call(fix(INSIDE, Date.now() + 6000));

        expect(skewed.data).toEqual({ status: 'unavailable', reason: 'clock_skew' });
        expect((await readStatus('alice')).lastSampleAt.toMillis()).toBe(storedSample);
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
        expect(events[0]).toMatchObject({
            type: 'outside',
            playerName: 'alice',
            playerId: 'alice',
        });

        await call(fix(OUTSIDE, T0 + 23000));
        expect((await readStatus('alice')).status).toBe('outside');
        events = await readEvents();
        expect(events).toHaveLength(1);
    });

    it('an error report does not end a confirmed outside episode: the next outside fix is outside again with no new outside event', async () => {
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
        expect(await readEvents()).toHaveLength(1);

        await call({
            roomId: ROOM,
            boundaryRevision: 1,
            sampleMs: T0 + 21000,
            error: 'permission_denied',
        });
        const result = await call(fix(OUTSIDE, T0 + 23000));

        expect(result.data.status).toBe('outside');
        expect((await readStatus('alice')).status).toBe('outside');
        const types = (await readEvents()).map((event) => event.type);
        expect(types.filter((type) => type === 'outside')).toHaveLength(1);
        expect(types).not.toContain('returnedInside');
    });

    it('after the room revision changes, a player who is still outside stays exposed and keeps their cooldown', async () => {
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
        expect(await readEvents()).toHaveLength(1);
        const before = await readStatus('alice');

        // The GM republishes the area. The player is still outside it.
        await updateDoc(doc(bypass, 'rooms', ROOM), { 'gameBoundary.revision': 2 });

        const next = await call(fix(OUTSIDE, T0 + 24000, { boundaryRevision: 2 }));
        const after = await readStatus('alice');

        expect(next.data.status).toBe('outside');
        expect(after.status).toBe('outside');
        expect(after.boundaryRevision).toBe(2);
        expect(after.outsideSince.toMillis()).toBe(before.outsideSince.toMillis());
        expect(after.outsideConfirmedAt.toMillis()).toBe(before.outsideConfirmedAt.toMillis());
        expect((await readEvents()).filter((e) => e.type === 'outside')).toHaveLength(1);
    });

    it('after the room revision changes, a player who was inside and is now outside starts a new cooldown', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 5000;
        await call(fix(INSIDE, T0));

        await updateDoc(doc(bypass, 'rooms', ROOM), { 'gameBoundary.revision': 2 });

        const next = await call(fix(OUTSIDE, T0 + 1000, { boundaryRevision: 2 }));
        const status = await readStatus('alice');

        expect(next.data.status).toBe('near');
        expect(status.status).toBe('near');
        expect(status.outsideConfirmedAt).toBeNull();
        expect(status.outsideSince).toBeInstanceOf(Timestamp);
        expect(await readEvents()).toEqual([]);
    });

    it('an error report older than the last stored sample is rejected as out-of-order and leaves the status unchanged', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });
        const call = reportAs(alice);
        const T0 = Date.now() - 5000;
        await call(fix(INSIDE, T0 + 200));
        const before = await readStatus('alice');

        await expect(
            call({
                roomId: ROOM,
                boundaryRevision: 1,
                sampleMs: T0 + 100,
                error: 'permission_denied',
            })
        ).rejects.toMatchObject({ code: 'functions/invalid-argument' });

        expect(await readStatus('alice')).toEqual(before);
    });

    it('a non-error unusable fix keeps a confirmed outside: the status doc stays outsideConfirmedAt-set and the next outside fix is outside with no new event', async () => {
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
        expect(await readEvents()).toHaveLength(1);

        const unusable = await call(fix(OUTSIDE, T0 + 21000, { accuracyM: 60 }));
        expect(unusable.data).toEqual({ status: 'unavailable', reason: 'poor_accuracy' });
        expect((await readStatus('alice')).outsideConfirmedAt).toBeInstanceOf(Timestamp);

        const result = await call(fix(OUTSIDE, T0 + 23000));

        expect(result.data.status).toBe('outside');
        const types = (await readEvents()).map((event) => event.type);
        expect(types.filter((type) => type === 'outside')).toHaveLength(1);
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
        const events = await readEvents();
        expect(events.map((event) => event.type).sort()).toEqual(['outside', 'returnedInside']);
        expect(events.find((event) => event.type === 'returnedInside')).toMatchObject({
            playerId: 'alice',
            playerName: 'alice',
        });
    });

    it('a near-edge fix after a confirmed outside ends exposure and writes returnedInside', async () => {
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
        expect((await readStatus('alice')).status).toBe('outside');

        // Just outside the ring, within the 15 m edge tolerance → near.
        const nearEdge = { lat: 40.00105, lng: -75.0 };
        await call(fix(nearEdge, T0 + 23500));

        const status = await readStatus('alice');
        expect(status.status).toBe('near');
        expect(status.outsideConfirmedAt).toBeNull();
        const events = await readEvents();
        expect(events.map((event) => event.type).sort()).toEqual(['outside', 'returnedInside']);
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

    it('an error report with no prior fix writes status unavailable with the reason and null coordinates', async () => {
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
        expect(status.lat).toBeNull();
        expect(status.lng).toBeNull();
        expect(await readEvents()).toEqual([]);
    });

    it('an error report after a known fix carries the previous lat and lng forward unchanged', async () => {
        const alice = await newIdentity();
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

        await reportAs(alice)(fix(INSIDE, Date.now() - 10000));
        await reportAs(alice)({
            roomId: ROOM,
            boundaryRevision: 1,
            sampleMs: Date.now() - 5000,
            error: 'timeout',
        });

        const status = await readStatus('alice');
        expect(status).toMatchObject({ status: 'unavailable', reason: 'timeout' });
        expect(status.lat).toBe(INSIDE.lat);
        expect(status.lng).toBe(INSIDE.lng);
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

    it('rejects a location report from a player killed after their last report, and leaves the kill-cleared status doc untouched', async () => {
        const alice = await newIdentity();
        await seedRoom(
            ROOM,
            [
                { name: 'alice', uid: alice.uid, targets: [] },
                { name: 'bob', targets: ['alice'] },
            ],
            { gameBoundary: BOUNDARY }
        );
        // A near/outside fix so killPlayer's exposure-clear guard
        // (status === 'outside' || 'near') actually fires — see
        // killPlayer.js — leaving the status doc in the cleared/eliminated
        // state this test needs to confirm stays untouched.
        await reportAs(alice)(fix(OUTSIDE, Date.now() - 10000));
        expect((await readStatus('alice')).status).toBe('near');

        await killPlayer({ target: 'alice', assassin: 'bob', roomId: ROOM });
        const clearedStatus = await readStatus('alice');
        expect(clearedStatus).toMatchObject({ status: 'unavailable', reason: 'eliminated' });
        expect(clearedStatus.lat).toBeNull();
        expect(clearedStatus.lng).toBeNull();

        await expect(reportAs(alice)(fix(INSIDE, Date.now() - 5000))).rejects.toMatchObject({
            code: 'functions/failed-precondition',
        });

        expect(await readStatus('alice')).toEqual(clearedStatus);
    });
});
