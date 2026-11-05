import { storage } from '../../utils/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Uploads a kill-photo Blob (already resized/compressed by compressImage)
// to this room's photo path and returns its public download URL, ready to
// write into the photos Firestore document via submitKillPhoto
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
// docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
export const uploadKillPhoto = async (roomID, photoBlob) => {
    const photoID = crypto.randomUUID();
    const photoRef = ref(storage, `rooms/${roomID}/photos/${photoID}.jpg`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};

// Self-photos live separately from kill evidence and can be replaced by
// uploading to the player's own uid-scoped avatar path.
export const uploadPlayerAvatar = async (roomID, uid, photoBlob) => {
    const photoRef = ref(storage, `rooms/${roomID}/avatars/${uid}`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
