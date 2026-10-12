import { killTargetsForAssassin } from './killTargets';

const players = [
    { name: 'Alice', targets: ['Bob'], openSeason: false, isAlive: true },
    { name: 'Bob', targets: [], openSeason: false, isAlive: true },
    { name: 'Carol', targets: [], openSeason: true, isAlive: true },
    { name: 'Dave', targets: [], openSeason: true, isAlive: true },
];

describe('killTargetsForAssassin', () => {
    it("returns just the assassin's own target list when nobody has open season", () => {
        const noOpenSeason = players.map((player) => ({ ...player, openSeason: false }));
        expect(killTargetsForAssassin(noOpenSeason, 'Alice')).toEqual(['Bob']);
    });

    it("includes an open-season player who isn't on the assassin's own list", () => {
        const result = killTargetsForAssassin(players, 'Alice');
        expect(result).toEqual(expect.arrayContaining(['Bob', 'Carol', 'Dave']));
        expect(result).toHaveLength(3);
    });

    it('does not duplicate a player who is both on the target list and open season', () => {
        const bobIsOpenSeason = players.map((player) =>
            player.name === 'Bob' ? { ...player, openSeason: true } : player
        );
        const result = killTargetsForAssassin(bobIsOpenSeason, 'Alice');
        expect(result.filter((name) => name === 'Bob')).toHaveLength(1);
    });

    it('excludes the assassin themselves, even if they have open season on themselves', () => {
        const aliceIsOpenSeason = players.map((player) =>
            player.name === 'Alice' ? { ...player, openSeason: true } : player
        );
        const result = killTargetsForAssassin(aliceIsOpenSeason, 'Alice');
        expect(result).not.toContain('Alice');
    });

    it('excludes a dead player even if open season was somehow left set on them', () => {
        const deadButFlagged = players.map((player) =>
            player.name === 'Carol' ? { ...player, isAlive: false } : player
        );
        const result = killTargetsForAssassin(deadButFlagged, 'Alice');
        expect(result).not.toContain('Carol');
    });

    it('matches the assassin name case-insensitively, matching improvements item 1', () => {
        expect(killTargetsForAssassin(players, 'alice')).toEqual(
            expect.arrayContaining(['Bob', 'Carol', 'Dave'])
        );
    });

    it('returns an empty array when the assassin name matches nobody in the roster, even with open-season players present', () => {
        const result = killTargetsForAssassin(players, 'nobody');
        expect(result).toEqual([]);
    });

    it('returns an empty array when there is nothing to offer', () => {
        const noOpenSeason = players.map((player) => ({
            ...player,
            openSeason: false,
            targets: [],
        }));
        expect(killTargetsForAssassin(noOpenSeason, 'Alice')).toEqual([]);
    });
});
