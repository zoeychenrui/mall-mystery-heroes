import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { onSnapshot } from 'firebase/firestore';
import ReconnectPendingScreen from './ReconnectPendingScreen';

// firebaseConfig.js calls initializeAuth(..., { persistence: getReactNativePersistence(...) })
// at module load time. Under Jest, 'firebase/auth' resolves to its browser
// build rather than the React Native build (the top-level `firebase`
// package's own "./auth" export map has no "react-native" condition, only
// the nested @firebase/auth package does) — getReactNativePersistence is
// undefined there and the module-level call throws the instant anything
// imports firebaseConfig.js, which dbCalls.js does for `db`. Mock it out so
// this stays a pure unit test of this screen's own rendering/navigation
// logic, same spirit as CLAUDE.md's "never import dbCalls.js/utils/firebase.js
// from a unit test" rule for the web app, and the same pattern JoinScreen.test.js
// uses.
jest.mock('../firebase/firebaseConfig', () => ({
    db: {},
}));
// firebase/firestore itself is safe to import under Jest, but auto-mocking it
// lets this test control onSnapshot's callback directly and makes dbCalls'
// doc()/collection()/query() calls no-ops, since their real return values are
// never inspected here — only the onSnapshot mock's own ref argument matters.
jest.mock('firebase/firestore');

describe('ReconnectPendingScreen', () => {
    it('resets the stack to Game once the request is approved', async () => {
        const navigate = jest.fn();
        const reset = jest.fn();
        onSnapshot.mockImplementation((ref, onNext) => {
            onNext({
                exists: () => true,
                data: () => ({ status: 'approved', playerName: 'Alice' }),
            });
            return () => {};
        });
        // @testing-library/react-native v14's `render` is async by default
        // (see its "Migration to 14.0" notes) — await it rather than reading
        // off an unresolved Promise, same as JoinScreen.test.js.
        await render(
            <ReconnectPendingScreen
                route={{ params: { roomID: 'ROOM1', requestId: 'req1' } }}
                navigation={{ navigate, reset }}
            />
        );
        // reset, not navigate: navigate() would push Game on top and leave
        // this screen (and its request-doc listener) mounted underneath.
        await waitFor(() =>
            expect(reset).toHaveBeenCalledWith({
                index: 0,
                routes: [{ name: 'Game', params: { roomID: 'ROOM1' } }],
            })
        );
        expect(navigate).not.toHaveBeenCalled();
    });

    it('resets the stack to Join from the denied screen', async () => {
        const navigate = jest.fn();
        const reset = jest.fn();
        onSnapshot.mockImplementation((ref, onNext) => {
            onNext({ exists: () => false });
            return () => {};
        });
        const { findByText } = await render(
            <ReconnectPendingScreen
                route={{ params: { roomID: 'ROOM1', requestId: 'req1' } }}
                navigation={{ navigate, reset }}
            />
        );
        await fireEvent.press(await findByText('Back to home'));
        expect(reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Join' }] });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('shows join-specific wording when requestType is "join"', async () => {
        onSnapshot.mockImplementation((ref, onNext) => {
            onNext({
                exists: () => true,
                data: () => ({ status: 'pending', requestType: 'join' }),
            });
            return () => {};
        });
        const { findByText } = await render(
            <ReconnectPendingScreen
                route={{ params: { roomID: 'ROOM1', requestId: 'req1' } }}
                navigation={{ navigate: jest.fn() }}
            />
        );
        await findByText('Waiting for the host to approve your join…');
    });
});
