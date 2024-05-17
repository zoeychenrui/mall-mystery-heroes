import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
    apiKey: process.env.REACT_APP_APIKEY,
    authDomain: process.env.REACT_APP_AUTHDOMAIN,
    projectId: process.env.REACT_APP_PROJECTID,
    storageBucket: process.env.REACT_APP_STORAGEBUCKET,
    messagingSenderId: process.env.REACT_APP_MESSAGINGSENDERID,
    appId: process.env.REACT_APP_APPID,
  };
  

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  console.log("Firebase apped:", app);
  export const functions = getFunctions(app);

  if (process.env.NODE_ENV === 'development') {
    connectFunctionsEmulator(getFunctions(app), "localhost", 5001);
  }

  export const auth = getAuth(app);
  export const googleProvider = new GoogleAuthProvider();
  export {db};