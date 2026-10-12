import { buildLeaderboardStandings } from './leaderboard';

describe('buildLeaderboardStandings', () => {
    it('sorts players by score descending', () => {
        const players = [
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Bob', score: 10, isAlive: true },
            { name: 'Carol', score: 0, isAlive: true },
        ];

        expect(buildLeaderboardStandings(players)).toEqual([
            { name: 'Bob', score: 10, isAlive: true },
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Carol', score: 0, isAlive: true },
        ]);
    });

    it('includes dead players rather than filtering them out', () => {
        const players = [
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Bob', score: 10, isAlive: false },
        ];

        const standings = buildLeaderboardStandings(players);

        expect(standings.find((p) => p.name === 'Bob')).toEqual({
            name: 'Bob',
            score: 10,
            isAlive: false,
        });
    });

    it('returns an empty array for an empty roster', () => {
        expect(buildLeaderboardStandings([])).toEqual([]);
    });

    it('does not mutate the input array', () => {
        const players = [
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Bob', score: 10, isAlive: true },
        ];
        const original = [...players];

        buildLeaderboardStandings(players);

        expect(players).toEqual(original);
    });
});
