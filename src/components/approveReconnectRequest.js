import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const approveReconnectRequestCallable = httpsCallable(functions, 'approveReconnectRequest');

/**
 * Approves a pending reconnect request — re-links the named player's
 * document to the requesting device's uid
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if the caller isn't the room's host, or the request has
 *   already been resolved — surfaces as a rejected promise carrying
 *   `.message`.
 */
export const approveReconnectRequest = async (roomID, requestId) => {
    await approveReconnectRequestCallable({ roomId: roomID, requestId });
};
