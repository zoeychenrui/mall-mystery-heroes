import { ref, uploadBytes } from "firebase/storage";
import { storage } from "../utils/firebase"

// export const testStorageCall = async () => {
//     const storageRef = ref(storage, 'test');
//     const file = new Blob(['Hello World']);
//     console.log('running');
//     await uploadBytes(storageRef, file).then((snapshot) => {
//         console.log('uloaded file: ', snapshot);
//     });
// }