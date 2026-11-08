import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Same Firebase project as the web app (src/utils/firebase.js) — read from
// EXPO_PUBLIC_FIREBASE_* so Expo inlines these at build/runtime. See
// .env.example for the full key list and mobile/.env (gitignored) for the
// real values.
const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
});
// experimentalForceLongPolling (rather than the web app's
// experimentalAutoDetectLongPolling) is the starting point here per the
// Task 1 brief, pending the manual realtime-listener check in Step 5. If
// that check shows this isn't needed/doesn't work, switch to
// experimentalAutoDetectLongPolling and retest before relying on it.
export const db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
});
export const storage = getStorage(app);
export const functions = getFunctions(app);
