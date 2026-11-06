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
    auth: { currentUser: null },
}));
jest.mock('../firebase/callables', () => ({
    joinRoom: jest.fn(),
    requestReconnect: jest.fn(),
}));
jest.mock('../utils/playerSession', () => ({
    writePlayerSession: jest.fn(),
}));

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
});
