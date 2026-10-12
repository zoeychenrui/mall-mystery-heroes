import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const leaveGameCallable = httpsCallable(functions, 'leaveGame');

/**
 * Removes the calling player from the room for good — unmaps them from
 * the target graph, reassigns whoever that leaves short, deletes their
 * player document, and announces the departure
 * (docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
 * The server resolves which player to remove from the caller's own uid —
 * no argument for it.
 *
 * @throws if the caller hasn't joined this room — surfaces as a rejected
 *   promise carrying `.message`.
 */
export const leaveGame = async (roomID) => {
    const { data } = await leaveGameCallable({ roomId: roomID });
    return data;
};
