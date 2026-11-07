import { render } from '@testing-library/react-native';
import { onSnapshot } from 'firebase/firestore';
import App from './App';
import { readPlayerSession } from './src/utils/playerSession';
import { auth } from './src/firebase/firebaseConfig';

jest.mock('./src/utils/playerSession');
// Same reason as every other test file that reaches firebaseConfig.js (see
// GameScreen.test.js): the real module throws under Jest, so it's stubbed
// with a plain object. `auth` is a mutable object so each test can set
// `.currentUser` directly, same as the real SDK's auth object.
jest.mock('./src/firebase/firebaseConfig', () => ({
    db: {},
    // authStateReady() resolves once the SDK's own async restore (an
    // AsyncStorage read, then a network call on a real device) has set
    // currentUser one way or the other — tests set currentUser first, then
    // resolve this, the same order a real app sees it in.
    auth: { currentUser: null, authStateReady: jest.fn().mockResolvedValue(undefined) },
}));
// Resuming into Game mounts the real GameScreen (unlike the Join-screen
// cases below, App.js itself never touches dbCalls/firestore — this is only
// here because its child does). GameScreen's effects call straight into
// dbCalls, which calls firebase/firestore's doc()/collection()/query() with
// the fake `db` object above; the real SDK validates that argument and
// throws synchronously. Automocking firebase/firestore (same approach as
// GameScreen.test.js) replaces those with no-op jest.fn()s so mounting
// GameScreen here doesn't require a full Firestore double.
jest.mock('firebase/firestore');

describe('App launch', () => {
    beforeEach(() => {
        // Automocked onSnapshot returns `undefined` by default; GameScreen
        // calls it as its own cleanup (`return () => unsubscribe()`), which
        // throws on unmount unless it's a function.
        onSnapshot.mockReturnValue(() => {});
    });

    it('resumes straight into the Game screen with a valid stored session', async () => {
        readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
        auth.currentUser = { uid: 'uid1' };
        const { findByTestId } = await render(<App />);
        await findByTestId('game-screen');
    });

    it('shows the Join screen with no stored session', async () => {
        readPlayerSession.mockResolvedValue(null);
        auth.currentUser = null;
        const { findByTestId } = await render(<App />);
        await findByTestId('join-screen');
    });

    it('shows the Join screen when a session is stored but there is no signed-in user', async () => {
        readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
        auth.currentUser = null;
        const { findByTestId } = await render(<App />);
        await findByTestId('join-screen');
    });

    // Real-device regression: the Firebase SDK restores the signed-in user
    // from AsyncStorage asynchronously (a storage read, then a network
    // call) — readPlayerSession() is unrelated and has no reason to finish
    // after that restore does. This simulates the restore landing LAST, the
    // way it actually does on a device, to prove App.js waits for it rather
    // than reading currentUser the instant readPlayerSession() resolves.
    it('resumes into Game even when auth restore finishes after the session read', async () => {
        readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
        let resolveAuthRestore;
        auth.authStateReady.mockReturnValue(
            new Promise((resolve) => {
                resolveAuthRestore = () => {
                    auth.currentUser = { uid: 'uid1' };
                    resolve();
                };
            })
        );
        auth.currentUser = null;

        const { findByTestId, queryByTestId } = await render(<App />);
        // Still waiting on auth restore — must not have already decided
        // Join just because the session read alone came back.
        expect(queryByTestId('join-screen')).toBeNull();
        expect(queryByTestId('game-screen')).toBeNull();

        resolveAuthRestore();
        await findByTestId('game-screen');
    });
});
