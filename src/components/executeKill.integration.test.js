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
import { executeKill } from './executeKill';
import { fetchPlayerForRoom, setOpenSznOfPlayerToValueForRoom } from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

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
});
