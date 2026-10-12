const { planMissionCompletion, openMissionsForPlayer } = require('./missionCompletion');

describe('planMissionCompletion', () => {
    const baseTask = {
        taskIndex: 1,
        title: 'Find the clue',
        taskType: 'Task',
        pointValue: '10',
        isComplete: false,
        completedBy: [],
        maxCompletions: null,
    };

    it('returns an error for a missing task', () => {
        expect(planMissionCompletion(null, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Invalid task index',
        });
    });

    it('returns an error when the mission has already ended', () => {
        const task = { ...baseTask, isComplete: true };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Mission 1 has already ended',
        });
    });

    it('returns an error when this player already completed the mission', () => {
        const task = { ...baseTask, completedBy: ['alice'] };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Player alice has already completed the mission',
        });
    });

    it('returns an error for a Revival Mission attempted by a player who is not dead', () => {
        const task = { ...baseTask, taskType: 'Revival Mission', pointValue: '0' };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Player alice is not dead',
        });
    });

    it('returns a plan awarding points for a Task, with revivesPlayer false', () => {
        expect(planMissionCompletion(baseTask, 'alice', { isPlayerDead: false })).toEqual({
            awardsPoints: 10,
            revivesPlayer: false,
            autoEnds: false,
        });
    });

    it('returns a plan reviving the player for a Revival Mission, with awardsPoints null', () => {
        const task = { ...baseTask, taskType: 'Revival Mission', pointValue: '0' };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: true })).toEqual({
            awardsPoints: null,
            revivesPlayer: true,
            autoEnds: false,
        });
    });

    it('sets autoEnds true once this completion meets maxCompletions', () => {
        const task = { ...baseTask, completedBy: ['bob'], maxCompletions: 2 };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false }).autoEnds).toBe(true);
    });

    it('sets autoEnds false when this completion falls short of maxCompletions', () => {
        const task = { ...baseTask, completedBy: [], maxCompletions: 2 };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false }).autoEnds).toBe(false);
    });

    it('sets autoEnds false when maxCompletions is unset', () => {
        expect(planMissionCompletion(baseTask, 'alice', { isPlayerDead: false }).autoEnds).toBe(
            false
        );
    });
});

describe('openMissionsForPlayer', () => {
    const missions = [
        { taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] },
        { taskIndex: 2, title: 'Ended mission', isComplete: true, completedBy: ['bob'] },
        { taskIndex: 3, title: 'Already done by alice', isComplete: false, completedBy: ['alice'] },
    ];

    it('excludes a mission that has already ended', () => {
        expect(openMissionsForPlayer(missions, 'carol').map((m) => m.taskIndex)).not.toContain(2);
    });

    it('excludes a mission this player has already completed', () => {
        expect(openMissionsForPlayer(missions, 'alice').map((m) => m.taskIndex)).not.toContain(3);
    });

    it('includes everything else, in the given order', () => {
        expect(openMissionsForPlayer(missions, 'carol').map((m) => m.taskIndex)).toEqual([1, 3]);
    });

    it('does not exclude a multi-completion mission for a player who has not completed it, even after another player has', () => {
        const missions = [
            {
                taskIndex: 4,
                title: 'Multi mission',
                isComplete: false,
                completedBy: ['bob'],
                maxCompletions: 2,
            },
        ];

        expect(openMissionsForPlayer(missions, 'alice').map((m) => m.taskIndex)).toEqual([4]);
    });

    it('excludes a Revival Mission when the player is alive', () => {
        const missions = [
            {
                taskIndex: 1,
                title: 'Revive Bob',
                taskType: 'Revival Mission',
                isComplete: false,
                completedBy: [],
            },
        ];

        expect(openMissionsForPlayer(missions, 'alice', false)).toEqual([]);
    });

    it('includes a Revival Mission when the player is dead', () => {
        const missions = [
            {
                taskIndex: 1,
                title: 'Revive Bob',
                taskType: 'Revival Mission',
                isComplete: false,
                completedBy: [],
            },
        ];

        expect(openMissionsForPlayer(missions, 'alice', true)).toEqual(missions);
    });

    it('includes a Task-type mission regardless of isPlayerDead', () => {
        const missions = [
            {
                taskIndex: 1,
                title: 'Find the clue',
                taskType: 'Task',
                isComplete: false,
                completedBy: [],
            },
        ];

        expect(openMissionsForPlayer(missions, 'alice', false)).toEqual(missions);
        expect(openMissionsForPlayer(missions, 'alice', true)).toEqual(missions);
    });
});
