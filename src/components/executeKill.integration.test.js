/**
 * Layer 1b — the atomic kill Cloud Function, against the real Functions,
 * Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `executeKill` is a thin wrapper around
 * `httpsCallable(functions, 'killPlayer')` — these tests call it exactly
 * the way the real app does, then assert on what actually landed in
 * Firestore, rather than asserting against the function's internals
 * (docs/superpowers/specs/2026-08-01-atomic-kill-cloud-function-design.md).
 * See functions/callableFunctions/killPlayer.js for what this replaced:
 * ~9-15 separate, unbatched client writes (docs/improvements.md item 4).
 */
import { doc, getDoc, getDocs, setDoc, terminate, Timestamp } from 'firebase/firestore';
import { executeKill } from './executeKill';
import {
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
    setOpenSznOfPlayerToValueForRoom,
} from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createRulesBypassDb,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';

// boundaryStatuses is written only by Cloud Functions, so firestore.rules
// does not open it to clients — seeding/reading it directly here needs the
// rules-bypass instance, same convention reportPlayerLocation.integration.
// test.js uses for the same collection.
let bypass;
const boundaryStatusRef = (playerKey) => doc(bypass, 'rooms', ROOM, 'boundaryStatuses', playerKey);

beforeAll(() => {
    bypass = createRulesBypassDb();
});
beforeEach(clearFirestore);
afterAll(async () => {
    await terminate(bypass);
    await shutdown();
});

describe('executeKill', () => {
    it("rejects a kill when the target is not on the assassin's list and open season is off", async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: [] },
            { name: 'bob', score: 5 },
        ]);

        await expect(executeKill('bob', 'alice', ROOM)).rejects.toThrow(
            'bob is not a valid target for alice'
        );
        // Nothing should have happened — still alive, no points moved.
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(0);
    });

    it("allows a kill when the target is on the assassin's list, and remaps whoever's left short", async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
            { name: 'carol', targets: [], assassins: [] },
        ]);

        const result = await executeKill('bob', 'alice', ROOM);

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15); // 10 + bob's 5
        expect(result.preKillSnapshot).toEqual({
            alice: { score: 10, targets: ['bob'], assassins: [], isAlive: true, openSeason: false },
            bob: { score: 5, targets: [], assassins: ['alice'], isAlive: true, openSeason: false },
            carol: { score: 0, targets: [], assassins: [], isAlive: true, openSeason: false },
        });

        // Alice's old target (bob) just died — carol is the only other
        // alive player, so she's the only possible new assignment. This is
        // the remap step, folded into the same transaction as the kill
        // itself (docs/improvements.md item 4) rather than a separate
        // client-driven follow-up.
        expect(result.addedTargets.alice).toEqual(['carol']);
        expect(result.remapLogs).toEqual(['New target for alice: carol']);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().targets).toEqual(['carol']);
        expect((await fetchPlayerForRoom('carol', ROOM)).data().assassins).toEqual(['alice']);
    });

    it("allows a kill when the assassin has open season, even off the target's list", async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: [] }, // bob NOT on alice's list
            { name: 'bob', score: 5 },
        ]);
        await setOpenSznOfPlayerToValueForRoom('alice', true, ROOM);

        await expect(executeKill('bob', 'alice', ROOM)).resolves.toBeDefined();
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });

    it('allows a kill when the target has open season on themselves, even for a different hunter', async () => {
        // Open season on the TARGET means anyone may kill them, not just
        // their assigned hunter — a separate rule from the assassin's own
        // open season above. This used to be enforced by
        // dbCalls.fetchTargetsForPlayer merging every open-season player's
        // name into the assassin's target list before the comparison;
        // killPlayer.js checks targetData.openSeason directly instead.
        await seedRoom(ROOM, [
            { name: 'alice', targets: [] }, // bob NOT on alice's list
            { name: 'bob', score: 5, openSeason: true },
        ]);

        await expect(executeKill('bob', 'alice', ROOM)).resolves.toBeDefined();
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });

    it('is case-insensitive, matching improvements item 1', async () => {
        await seedRoom(ROOM, [
            { name: 'Alice', targets: ['Bob'] },
            { name: 'Bob', score: 5 },
        ]);

        await expect(executeKill('bob', 'alice', ROOM)).resolves.toBeDefined();
    });

    it('unmaps the victim from every neighbor, with normally-capitalized names (improvements item 36)', async () => {
        // The exact scenario item 36 found broken: the pre-fix unmapping
        // query never matched a capitalized name at all. killPlayer.js is
        // a from-scratch implementation of this step, not a port of the
        // buggy version, but this pins the behavior directly rather than
        // trusting that by absence of a bug report.
        await seedRoom(ROOM, [
            { name: 'Alice', targets: ['Bob'], assassins: ['Carol'] },
            { name: 'Bob', score: 5, targets: ['Dave'], assassins: ['Alice'] },
            { name: 'Carol', targets: ['Alice'], assassins: [] },
            { name: 'Dave', targets: [], assassins: ['Bob'] },
        ]);

        await executeKill('bob', 'alice', ROOM);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.targets).toEqual([]);
        expect(bob.assassins).toEqual([]);
        expect((await fetchPlayerForRoom('dave', ROOM)).data().assassins).not.toContain('Bob');
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'] },
            { name: 'bob', score: 5 },
        ]);
        const killAsNonHost = callableAsNonHost('killPlayer');

        await expect(
            killAsNonHost({ target: 'bob', assassin: 'alice', roomId: ROOM })
        ).rejects.toThrow(/permission-denied|host/i);
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);
    });

    it("clears the target's boundary status if they were confirmed outside at the moment of the kill", async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'] },
            { name: 'bob', score: 5 },
        ]);
        await setDoc(boundaryStatusRef('bob'), {
            status: 'outside',
            reason: null,
            lat: 40.01,
            lng: -75.0,
            accuracyMeters: 5,
            outsideSince: null,
            lastOutsideSampleAt: null,
            outsideSampleCount: 2,
            outsideConfirmedAt: null,
            boundaryRevision: 1,
            uid: 'bob-uid',
        });

        await executeKill('bob', 'alice', ROOM);

        const status = (await getDoc(boundaryStatusRef('bob'))).data();
        expect(status.status).toBe('unavailable');
        expect(status.reason).toBe('eliminated');
        expect(status.lat).toBeNull();
        expect(status.lng).toBeNull();
    });

    it("also clears the target's boundary status when they were only 'near' (not yet confirmed outside) at the moment of the kill", async () => {
        // The other half of the guard condition
        // (`status === 'outside' || status === 'near'`) — the 'outside'
        // test above alone would miss a regression that narrowed the
        // check to 'outside' only.
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'] },
            { name: 'bob', score: 5 },
        ]);
        await setDoc(boundaryStatusRef('bob'), {
            status: 'near',
            reason: null,
            lat: 40.01,
            lng: -75.0,
            accuracyMeters: 5,
            outsideSince: null,
            lastOutsideSampleAt: null,
            outsideSampleCount: 1,
            outsideConfirmedAt: null,
            boundaryRevision: 1,
            uid: 'bob-uid',
        });

        await executeKill('bob', 'alice', ROOM);

        const status = (await getDoc(boundaryStatusRef('bob'))).data();
        expect(status.status).toBe('unavailable');
        expect(status.reason).toBe('eliminated');
        expect(status.lat).toBeNull();
        expect(status.lng).toBeNull();
    });

    it('does not throw when killing a target with no boundaryStatuses document at all', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'] },
            { name: 'bob', score: 5 },
        ]);

        await expect(executeKill('bob', 'alice', ROOM)).resolves.toBeDefined();
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });
});

describe('executeKill — Horcrux (POWER_UPS_SPEC.md)', () => {
    const horcruxRoom = (bobExtra) =>
        seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, assassins: ['alice'], horcrux: true, ...bobExtra },
        ]);

    it('saves a protected target: no kill, no points move, grace period starts, everyone told', async () => {
        await horcruxRoom({ horcruxEndsAt: null });
        const before = Date.now();

        const result = await executeKill('bob', 'alice', ROOM);

        expect(result).toEqual({ blockedByHorcrux: true, targetName: 'bob' });
        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.score).toBe(5);
        expect(bob.horcrux).toBe(true);
        expect(bob.horcruxEndsAt.toMillis()).toBeGreaterThanOrEqual(before + 5000 - 2000);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(10);

        const messages = (await getDocs(fetchPlayerMessagesQueryForRoom(ROOM))).docs.map((d) =>
            d.data()
        );
        expect(messages).toEqual([
            expect.objectContaining({ type: 'horcruxSaved', text: "🛡️ bob's Horcrux saved them!" }),
        ]);
        const logs = (await getDocs(fetchLogsQueryByAscendingTimestampForRoom(ROOM))).docs;
        expect(logs[0].data().log).toMatch(/bob's Horcrux saved them/);
    });

    it('also blocks a second attempt inside the 5-second grace period, without extending it', async () => {
        const endsAt = Timestamp.fromMillis(Date.now() + 4000);
        await horcruxRoom({ horcruxEndsAt: endsAt });

        expect(await executeKill('bob', 'alice', ROOM)).toEqual(
            expect.objectContaining({ blockedByHorcrux: true })
        );
        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.horcruxEndsAt.toMillis()).toBe(endsAt.toMillis());
    });

    it('kills normally once the grace period is over, and clears the spent Horcrux', async () => {
        await horcruxRoom({ horcruxEndsAt: Timestamp.fromMillis(Date.now() - 1000) });

        const result = await executeKill('bob', 'alice', ROOM);

        expect(result.blockedByHorcrux).toBeUndefined();
        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(false);
        expect(bob.horcrux).toBe(false);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
    });
});
