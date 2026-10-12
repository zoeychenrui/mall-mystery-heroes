import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const denyReconnectRequestCallable = httpsCallable(functions, 'denyReconnectRequest');

/**
 * Denies a pending reconnect request — touches no player data
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if the caller isn't the room's host, or the request has
 *   already been resolved — surfaces as a rejected promise carrying
 *   `.message`.
 */
export const denyReconnectRequest = async (roomID, requestId) => {
    await denyReconnectRequestCallable({ roomId: roomID, requestId });
};
