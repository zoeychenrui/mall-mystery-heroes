import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const removePlayerCallable = httpsCallable(functions, 'removePlayer');

/**
 * Removes a named player from the room for good, moderator-initiated —
 * the same unmap/remap/delete `leaveGame` performs, minus the
 * self-announcement (the caller, the host's own browser, announces it
 * afterward — see ChatInput.js's `/kick` case)
 * (docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
 *
 * @throws if playerName doesn't match anyone in the room, or the caller
 *   isn't the room's host — surfaces as a rejected promise carrying
 *   `.message`.
 */
export const removePlayer = async (playerName, roomID) => {
    const { data } = await removePlayerCallable({ playerName, roomId: roomID });
    return data;
};
