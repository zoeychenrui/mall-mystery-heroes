import { storage } from './firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as Crypto from 'expo-crypto';

export const uploadKillPhoto = async (roomID, photoBlob) => {
    const photoID = Crypto.randomUUID();
    const photoRef = ref(storage, `rooms/${roomID}/photos/${photoID}.jpg`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};

// RN port of src/components/firebase_calls/storageCalls.js's
// uploadPlayerAvatar — one fixed path per player (`.../avatars/{uid}`, no
// file extension, unlike uploadKillPhoto's per-photo `.jpg`-suffixed path
// above), so re-uploading a new avatar simply overwrites the old one at the
// same path instead of accumulating orphaned photos in Storage.
export const uploadPlayerAvatar = async (roomID, uid, photoBlob) => {
    const photoRef = ref(storage, `rooms/${roomID}/avatars/${uid}`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
