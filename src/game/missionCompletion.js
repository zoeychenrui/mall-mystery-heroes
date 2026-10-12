/**
 * Decides what a mission completion should do, without performing any of
 * it — matches src/game/missionEdit.js's decide-then-write shape
 * (CLAUDE.md's "Separate deciding from writing"). Shared by
 * ChatInput.js's /mission done command and PhotosDisplay.js's
 * photo-approval flow, both of which call the server-side
 * completeMission Cloud Function (functions/callableFunctions/
 * completeMission.js is the I/O shell that calls this — via its vendored
 * copy, functions/vendor/game/missionCompletion.js — and performs the
 * actual writes), so the two paths can never quietly diverge.
 */

/**
 * Returns { error } when the attempt is invalid — a bad index, a mission
 * that has already ended, a player who already completed it, or a
 * Revival Mission attempted by a player who is not dead — checked in
 * that order, before anything is ever written, so an invalid attempt
 * never partially lands. Otherwise returns a plan: `awardsPoints` is the
 * point value to add (a Task's own pointValue, parsed to a number) or
 * null (a Revival Mission never awards points); `revivesPlayer` is true
 * only for a Revival Mission; `autoEnds` is true once this completion
 * would meet or exceed the mission's own optional maxCompletions cap.
 */
const planMissionCompletion = (task, playerName, { isPlayerDead }) => {
    if (!task) return { error: 'Invalid task index' };
    if (task.isComplete) return { error: `Mission ${task.taskIndex} has already ended` };
    if (task.completedBy.includes(playerName)) {
        return { error: `Player ${playerName} has already completed the mission` };
    }
    if (task.taskType === 'Revival Mission' && !isPlayerDead) {
        return { error: `Player ${playerName} is not dead` };
    }

    const completedCount = task.completedBy.length + 1;
    return {
        awardsPoints: task.taskType === 'Task' ? parseInt(task.pointValue, 10) : null,
        revivesPlayer: task.taskType === 'Revival Mission',
        autoEnds: Boolean(task.maxCompletions) && completedCount >= task.maxCompletions,
    };
};

/**
 * Which of `missions` a given player could still complete: not already
 * ended, not already completed by this player, and not a Revival Mission
 * when the player is alive. Feeds the photo-approval dropdown's mission
 * options directly — a mission that would obviously fail
 * planMissionCompletion is never offered as an option in the first place.
 */
const openMissionsForPlayer = (missions, playerName, isPlayerDead) =>
    missions.filter(
        (mission) =>
            !mission.isComplete &&
            !mission.completedBy.includes(playerName) &&
            (mission.taskType !== 'Revival Mission' || isPlayerDead)
    );

module.exports = { planMissionCompletion, openMissionsForPlayer };
