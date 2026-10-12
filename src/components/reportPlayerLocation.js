import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const reportPlayerLocationCallable = httpsCallable(functions, 'reportPlayerLocation');

/**
 * Reports one location fix or one location error for the calling
 * player, evaluated server-side against the room's current game
 * boundary. Identity comes from the caller's own Firebase Auth session,
 * same as submitChatMessage.js — there is no player name to pass here.
 *
 * A fix report: { roomId, boundaryRevision, sampleMs, lat, lng, accuracyM }.
 * An error report: { roomId, boundaryRevision, sampleMs, error }, where
 * error is 'permission_denied' | 'unavailable' | 'timeout', with no
 * coordinates.
 *
 * @returns {Promise<{status: 'inside'|'outside'|'near'|'unavailable', reason: string|null}>}
 * @throws if the caller isn't a player of the room, the game has ended,
 *   the boundary is disabled or revision-mismatched, the sample is
 *   out-of-order/too old/too far in the future, or the rate limit is
 *   exceeded — surfaces as a rejected promise carrying `.message`.
 */
export const reportPlayerLocation = async (payload) => {
    const { data } = await reportPlayerLocationCallable(payload);
    return data;
};
