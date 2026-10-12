import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const joinRoomCallable = httpsCallable(functions, 'joinRoom');

/**
 * Lets the current signed-in user (Google or guest/anonymous) join a room
 * as a new player, from their own device
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 * Only succeeds while the room is still in its Lobby phase.
 *
 * @throws if the room doesn't exist, has already started, or the name is
 *   already taken — surfaces as a rejected promise carrying `.message`.
 */
export const joinRoom = async (roomId, playerName) => {
    await joinRoomCallable({ roomId, playerName });
};
