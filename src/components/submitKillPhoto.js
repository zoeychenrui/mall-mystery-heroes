import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const submitKillPhotoCallable = httpsCallable(functions, 'submitKillPhoto');

/**
 * Submits a kill-photo claim on the caller's own behalf — the Cloud
 * Function derives who "the caller" is from their own signed-in identity,
 * so there is no assassin name to pass here, only which target and which
 * already-uploaded photo url
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 * uploadKillPhoto (storageCalls.js) still handles the Storage upload
 * itself, unchanged — this only writes the Firestore doc pointing at it.
 *
 * @throws if the caller isn't a player of the room, the game has ended,
 *   the url isn't a legitimate photo for this room, the rate limit is
 *   exceeded, or target/mission aren't exactly-one-set (neither or both
 *   present, blank target, or non-integer mission) — surfaces as a
 *   rejected promise carrying `.message`, same as executeKill.js
 *   (docs/improvements.md item 10's error-propagation pattern needs no
 *   changes to handle this).
 */
export const submitKillPhoto = async ({ roomId, target, mission, url }) => {
    await submitKillPhotoCallable({ roomId, target, mission, url });
};
