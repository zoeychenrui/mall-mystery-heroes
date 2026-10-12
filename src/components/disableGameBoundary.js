import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const disableGameBoundaryCallable = httpsCallable(functions, 'disableGameBoundary');

/**
 * Turns off enforcement of the room's current game-area boundary,
 * host-only. Does not clear the stored shape — a disabled boundary can
 * still be reopened and republished later.
 *
 * @throws if the caller isn't the room's host, there is no boundary to
 *   disable, or expectedRevision no longer matches.
 */
export const disableGameBoundary = async ({ roomId, expectedRevision }) => {
    const { data } = await disableGameBoundaryCallable({ roomId, expectedRevision });
    return data;
};
