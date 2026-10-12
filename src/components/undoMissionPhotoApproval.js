import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const undoMissionPhotoApprovalCallable = httpsCallable(functions, 'undoMissionPhotoApproval');

/**
 * Reverses a photo-approved mission completion in full, server-side, in
 * one Firestore transaction — the photo-anchored half of mission undo's
 * two independent stacks
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 *
 * @throws if the photo is not an approved mission completion, or the
 *   caller isn't the room's host — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const undoMissionPhotoApproval = async (roomID, photoID) => {
    await undoMissionPhotoApprovalCallable({ roomId: roomID, photoId: photoID });
};
