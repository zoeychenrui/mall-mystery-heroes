import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../utils/firebase"

// export const testStorageCall = async () => {
//     const storageRef = ref(storage, 'test');
//     const file = new Blob(['Hello World']);
//     console.log('running');
//     await uploadBytes(storageRef, file).then((snapshot) => {
//         console.log('uloaded file: ', snapshot);
//     });


export const fetchPhotoURLFromStorageForRoom = async (photoName, roomID) => {
    try {
        const photoRef = ref(storage, roomID, photoName);
        const photoURL = await getDownloadURL(photoRef);
        return photoURL;    
    } catch (error) {
        console.error("Error fetching photo url: ", error);
    }
}