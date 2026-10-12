/**
 * Combines a player's own kill-target options and open-mission options
 * into one array, for the player's own photo-submission picker
 * (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md).
 * This is the exact shape PhotosDisplay.js's moderator-side dropdown used
 * to build inline before this feature moved the pick to submission time —
 * now computed for the submitting player instead of a resolved photo's
 * assassin.
 */
import { killTargetsForAssassin } from './killTargets';
import { openMissionsForPlayer } from './missionCompletion';
import { normalizePlayerName } from './playerNames';

/**
 * @param {Array<{name: string, targets?: string[], openSeason?: boolean, isAlive?: boolean}>} players
 * @param {Array<{taskIndex: number, title: string, taskType: string, isComplete: boolean, completedBy: string[]}>} missions
 * @param {string} playerName
 * @returns {Array<{value: string, label: string, group: 'Kill Target' | 'Mission'}>}
 */
export const buildPhotoClaimOptions = (players, missions, playerName) => {
    const normalizedName = normalizePlayerName(playerName);
    const playerRow = players.find((player) => normalizePlayerName(player.name) === normalizedName);
    const isPlayerDead = playerRow ? !playerRow.isAlive : false;

    const killTargets = killTargetsForAssassin(players, playerName);
    const openMissions = openMissionsForPlayer(missions, normalizedName, isPlayerDead);

    return [
        ...killTargets.map((target) => ({
            value: `target:${target}`,
            label: target,
            group: 'Kill Target',
        })),
        ...openMissions.map((mission) => ({
            value: `mission:${mission.taskIndex}`,
            label: mission.title,
            group: 'Mission',
        })),
    ];
};
