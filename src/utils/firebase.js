import { initializeApp, getApps, getApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
    connectFirestoreEmulator,
    initializeFirestore,
    enableNetwork,
    disableNetwork,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { readFirebaseConfig, shouldUseEmulators, assertSafeFirebaseTarget } from './firebaseEnv';

// Throws if a test run is about to connect to a live project. See firebaseEnv.js.
assertSafeFirebaseTarget(process.env);

const app = getApps().length ? getApp() : initializeApp(readFirebaseConfig(process.env));

// Plain getFirestore(app) lets the SDK guess, at connect time, whether a
// real WebSocket-style stream will work on this network. Some networks make
// that guess wrong; experimentalAutoDetectLongPolling has the SDK actively
// probe instead of assuming. A general reliability improvement, but not a
// fix for the stalled-listener report below (that turned out to be a
// browser tab-throttling issue, not a connection-type issue).
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app);

if (shouldUseEmulators(process.env)) {
    connectFunctionsEmulator(functions, 'localhost', 5001);
    connectAuthEmulator(auth, 'http://localhost:9099');
    connectFirestoreEmulator(db, 'localhost', 8081);
    connectStorageEmulator(storage, 'localhost', 9199);
}

// Browsers throttle a background tab's timers and network activity to save
// power. Firestore's own automatic reconnect-after-drop logic runs on a
// timer, so a listen stream that drops while the tab is backgrounded can
// stay stalled indefinitely — nothing arrives until some unrelated user
// action (a click, a send) happens to wake the tab back up. Forcing a
// disable/enable cycle the moment the tab becomes visible again re-syncs
// every active listener immediately, without waiting on a throttled retry
// or an unrelated user action. Confirmed as the real-world trigger via a
// live user report this session: messages sent by other players only
// appeared after switching back to a backgrounded chat tab and sending a
// message of their own.
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            disableNetwork(db).then(() => enableNetwork(db));
        }
    });
}

export const googleProvider = new GoogleAuthProvider();
export { app, auth, db, functions, storage };
