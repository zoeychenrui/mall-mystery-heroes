import { buildPhotoClaimOptions } from './photoClaimOptions';

describe('buildPhotoClaimOptions', () => {
    it("combines the player's own kill targets and open missions into one array", () => {
        const players = [{ name: 'alice', targets: ['bob'], isAlive: true, openSeason: false }];
        const missions = [
            {
                taskIndex: 1,
                title: 'Find the clue',
                taskType: 'Task',
                isComplete: false,
                completedBy: [],
            },
        ];

        const result = buildPhotoClaimOptions(players, missions, 'alice');

        expect(result).toEqual([
            { value: 'target:bob', label: 'bob', group: 'Kill Target' },
            { value: 'mission:1', label: 'Find the clue', group: 'Mission' },
        ]);
    });

    it("includes an open-season player alongside the assassin's own target", () => {
        const players = [
            { name: 'alice', targets: ['bob'], isAlive: true, openSeason: false },
            { name: 'bob', targets: [], isAlive: true, openSeason: false },
            { name: 'carol', targets: [], isAlive: true, openSeason: true },
        ];

        const result = buildPhotoClaimOptions(players, [], 'alice');

        expect(result).toEqual(
            expect.arrayContaining([
                { value: 'target:bob', label: 'bob', group: 'Kill Target' },
                { value: 'target:carol', label: 'carol', group: 'Kill Target' },
            ])
        );
        expect(result).toHaveLength(2);
    });

    it('returns an empty array when the player has no targets and no open missions', () => {
        const players = [
            { name: 'alice', targets: [], isAlive: true, openSeason: false },
            { name: 'bob', targets: [], isAlive: true, openSeason: false },
        ];

        expect(buildPhotoClaimOptions(players, [], 'alice')).toEqual([]);
    });

    it('excludes a Revival Mission for a living player, includes it for a dead one', () => {
        const missions = [
            {
                taskIndex: 3,
                title: 'Revive Dave',
                taskType: 'Revival Mission',
                isComplete: false,
                completedBy: [],
            },
        ];
        const withDeadBob = [
            { name: 'alice', targets: [], isAlive: true, openSeason: false },
            { name: 'bob', targets: [], isAlive: false, openSeason: false },
        ];

        expect(buildPhotoClaimOptions(withDeadBob, missions, 'alice')).toEqual([]);
        expect(buildPhotoClaimOptions(withDeadBob, missions, 'bob')).toEqual([
            { value: 'mission:3', label: 'Revive Dave', group: 'Mission' },
        ]);
    });

    it('excludes a mission this player already completed, normalizing display-cased names', () => {
        const players = [{ name: 'alice', targets: [], isAlive: true, openSeason: false }];
        const missions = [
            {
                taskIndex: 1,
                title: 'Find the clue',
                taskType: 'Task',
                isComplete: false,
                completedBy: ['alice'],
            },
        ];

        expect(buildPhotoClaimOptions(players, missions, 'Alice')).toEqual([]);
    });

    it('returns an empty kill-target list for a player not found in the roster, without throwing', () => {
        const players = [{ name: 'alice', targets: ['bob'], isAlive: true, openSeason: false }];

        expect(buildPhotoClaimOptions(players, [], 'nobody')).toEqual([]);
    });
});
