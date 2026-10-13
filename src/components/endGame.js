import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const endGameCallable = httpsCallable(functions, 'endGame');

/**
 * Ends the room's game and clears every player's exposed boundary status
 * in the same server-side transaction. Replaces the old dbCalls.js
 * client-only write — boundaryStatuses can only be written under the
 * Admin SDK, so there was no way for a plain client write to also clear
 * exposure.
 *
 * @throws if the caller is not the room's host, the room doesn't exist,
 *   or the game has already ended — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const endGame = async (roomID) => {
    await endGameCallable({ roomId: roomID });
};
