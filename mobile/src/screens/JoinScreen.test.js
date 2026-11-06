import { render, fireEvent } from '@testing-library/react-native';
import JoinScreen from './JoinScreen';

// firebaseConfig.js calls initializeAuth(..., { persistence: getReactNativePersistence(...) })
// at module load time. Under Jest, 'firebase/auth' resolves to its browser
// build rather than the React Native build (the top-level `firebase`
// package's own "./auth" export map has no "react-native" condition, only
// the nested @firebase/auth package does) — getReactNativePersistence is
// undefined there and the module-level call throws the instant anything
// imports firebaseConfig.js. Mock the firebase-touching modules so this
// stays a pure unit test of JoinScreen's own rendering/input logic, same
// spirit as CLAUDE.md's "never import dbCalls.js/utils/firebase.js from a
// unit test" rule for the web app.
jest.mock('../firebase/firebaseConfig', () => ({
    auth: { currentUser: { uid: 'test-uid' } },
}));
jest.mock('firebase/auth', () => ({
    signInAnonymously: jest.fn(),
}));
jest.mock('../firebase/callables', () => ({
    joinRoom: jest.fn(),
    requestReconnect: jest.fn(),
}));
jest.mock('../utils/playerSession', () => ({
    writePlayerSession: jest.fn(),
}));

const callables = require('../firebase/callables');

describe('JoinScreen', () => {
    // @testing-library/react-native v14's `render` and `fireEvent` are both
    // async by default now (see its "Migration to 14.0" notes) — await
    // both rather than destructuring/reading off an unresolved Promise.
    it('uppercases the room code as typed, matching the web app', async () => {
        const { getByPlaceholderText } = await render(
            <JoinScreen navigation={{ navigate: jest.fn() }} />
        );
        const input = getByPlaceholderText('Game ID');
        await fireEvent.changeText(input, 'abc123');
        expect(input.props.value).toBe('ABC123');
    });

    // Real-device repro (Task 16 QA): a player swipes back out of the Game
    // screen (bypassing Leave) and tries rejoining with the same name after
    // the game has started. joinRoom.js throws
    // HttpsError('failed-precondition', 'This game has already started.'),
    // but the mobile app's firebase SDK (^13.2.0) appends the raw HTTP
    // status to that message inside @firebase/functions'
    // _errorForResponse — e.g. "This game has already started. [400]" — so
    // an exact string match against the bare backend message fails. This
    // must still fall through to the reconnect-request fallback rather
    // than surfacing the raw error.
    it('falls back to requestReconnect when joinRoom fails with an already-started error whose message was reformatted by the SDK', async () => {
        const alreadyStartedError = new Error('This game has already started. [400]');
        alreadyStartedError.code = 'functions/failed-precondition';
        callables.joinRoom.mockRejectedValueOnce(alreadyStartedError);
        callables.requestReconnect.mockResolvedValueOnce({ requestId: 'req-1' });
        const navigate = jest.fn();

        const { getByPlaceholderText, getByText } = await render(
            <JoinScreen navigation={{ navigate }} />
        );
        await fireEvent.changeText(getByPlaceholderText('Game ID'), 'abc123');
        await fireEvent.changeText(getByPlaceholderText('Your name'), 'Alice');
        await fireEvent.press(getByText('Join'));

        expect(callables.requestReconnect).toHaveBeenCalledWith('ABC123', 'Alice');
        expect(navigate).toHaveBeenCalledWith('ReconnectPending', {
            roomID: 'ABC123',
            requestId: 'req-1',
        });
    });
});
