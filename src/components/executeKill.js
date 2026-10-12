import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const killPlayerCallable = httpsCallable(functions, 'killPlayer');

/**
 * Kills a player: validates the target is on the assassin's target list (or
 * the assassin has open season), transfers the target's points to the
 * assassin, kills the target, unmaps them from every neighbor, and
 * reassigns targets/assassins to whoever that leaves short — all inside one
 * Firestore transaction, server-side (docs/improvements.md item 4).
 *
 * This used to be ~9-15 separate, unbatched writes from the browser (see
 * functions/callableFunctions/killPlayer.js for what replaced it, and this
 * file's own git history before item 4 for what used to be here). A
 * dropped connection partway through could leave the game in a state
 * nothing detected or repaired. Now it's one request; it either fully
 * succeeds or fully fails.
 *
 * @throws if target isn't a valid kill for assassin, or the caller isn't
 *   the room's host — surfaces as a rejected promise carrying `.message`,
 *   same as any other error this codebase throws (docs/improvements.md
 *   item 10's error-propagation pattern needs no changes to handle this).
 */
export const executeKill = async (target, assassin, roomID) => {
    const { data } = await killPlayerCallable({ target, assassin, roomId: roomID });
    return data;
};
