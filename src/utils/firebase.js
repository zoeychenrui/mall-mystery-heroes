import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: process.env.REACT_PUBLIC_APIKEY,
    authDomain: process.env.REACT_PUBLIC_AUTHDOMAIN,
    projectId: process.env.REACT_PUBLIC_PROJECTID,
    storageBucket: process.env.REACT_PUBLIC_STORAGEBUCKET,
    messagingSenderId: process.env.REACT_PUBLIC_MESSAGINGSENDERID,
    appId: process.env.REACT_PUBLIC_APPID,
  };

  const app = initializeApp(firebaseConfig);

  export const db = getFirestore(app);
