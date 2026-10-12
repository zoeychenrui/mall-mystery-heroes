import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const undoKillPlayerCallable = httpsCallable(functions, 'undoKillPlayer');

/**
 * Reverses an approved kill photo's kill in full — the target and every
 * other player killPlayer.js's transaction touched — via one Firestore
 * transaction, server-side
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
 *
 * @throws if the photo is not currently approved, or the caller isn't the
 *   room's host — surfaces as a rejected promise carrying `.message`.
 */
export const undoKill = async (roomID, photoID) => {
    await undoKillPlayerCallable({ roomId: roomID, photoId: photoID });
};
