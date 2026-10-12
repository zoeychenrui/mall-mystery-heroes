import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const completeMissionCallable = httpsCallable(functions, 'completeMission');

/**
 * Completes a mission — awards points for a Task, or revives the player
 * and regenerates targets for a Revival Mission — server-side, in one
 * Firestore transaction, returning a reversal snapshot the caller can
 * persist for later undo
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md). Replaces the
 * client-orchestrated completeMission.js the mission-completion-via-photo
 * feature originally shipped (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md)
 * — see that file's git history for what used to be here.
 *
 * @throws if the mission index is invalid, the mission has already ended,
 *   the player already completed it, a Revival Mission is attempted by a
 *   player who is not dead, or the caller isn't the room's host —
 *   surfaces as a rejected promise carrying `.message`.
 */
export const completeMission = async (missionIndex, playerName, roomID) => {
    const { data } = await completeMissionCallable({ missionIndex, playerName, roomId: roomID });
    return data;
};
