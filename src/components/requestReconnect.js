import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const requestReconnectCallable = httpsCallable(functions, 'requestReconnect');

/**
 * Requests to reclaim an existing player's identity in a room whose game
 * has already started — the caller's own uid becomes pending approval,
 * not immediately linked
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if playerName doesn't match an existing player, or the room
 *   hasn't started/is no longer active — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const requestReconnect = async (roomID, playerName) => {
    const { data } = await requestReconnectCallable({ roomId: roomID, playerName });
    return data;
};
