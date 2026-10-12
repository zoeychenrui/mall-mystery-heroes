import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const publishGameBoundaryCallable = httpsCallable(functions, 'publishGameBoundary');

/**
 * Publishes a new game-area boundary for the room, host-only, with an
 * expected-revision check to reject a conflicting concurrent edit.
 *
 * @throws if the caller isn't the room's host, the geometry is invalid,
 *   the game has ended, or expectedRevision no longer matches — surfaces
 *   as a rejected promise carrying `.message`, same as executeKill.js.
 */
export const publishGameBoundary = async ({
    roomId,
    expectedRevision,
    shapeType,
    vertices,
    shapeParameters,
}) => {
    const { data } = await publishGameBoundaryCallable({
        roomId,
        expectedRevision,
        shapeType,
        vertices,
        shapeParameters,
    });
    return data;
};
