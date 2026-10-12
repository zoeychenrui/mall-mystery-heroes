import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const undoMissionCommandCallable = httpsCallable(functions, 'undoMissionCommand');

/**
 * Reverses the most recent /mission done completion, server-side, in one
 * Firestore transaction — the command-path half of mission undo's two
 * independent stacks (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 *
 * @throws if there is nothing to undo, or the caller isn't the room's
 *   host — surfaces as a rejected promise carrying `.message`.
 */
export const undoMissionCommand = async (roomID) => {
    await undoMissionCommandCallable({ roomId: roomID });
};
