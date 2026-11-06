import { storage } from './firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as Crypto from 'expo-crypto';

export const uploadKillPhoto = async (roomID, photoBlob) => {
    const photoID = Crypto.randomUUID();
    const photoRef = ref(storage, `rooms/${roomID}/photos/${photoID}.jpg`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
