import { render } from '@testing-library/react-native';
import RootNavigator from './RootNavigator';

// Same reason as every other test file that reaches firebaseConfig.js (see
// GameScreen.test.js/JoinScreen.test.js): the real module throws at import
// time under Jest. RootNavigator pulls it in transitively via JoinScreen,
// ReconnectPendingScreen and GameScreen, even though the mocked Screen below
// never actually renders any of them.
jest.mock('../firebase/firebaseConfig', () => ({
    db: {},
    auth: {},
}));

// Task 16 QA follow-up: the Game screen's options must disable iOS's native
// swipe-back gesture (see RootNavigator.js's comment on that Stack.Screen for
// why — swiping back used to pop straight to Join without running any of
// GameScreen's cleanup). Rather than fully mounting the real Join/Game
// screens (and their firebase dependencies) just to inspect static
// navigator config, createNativeStackNavigator is replaced with a fake
// whose Navigator simply renders its children and whose Screen is a plain
// mock component — so rendering <RootNavigator /> calls that mock once per
// <Stack.Screen>, with the exact props (name, options, ...) RootNavigator.js
// passed in, and this test reads them straight off the mock rather than
// reaching into real navigation state.
jest.mock('@react-navigation/native-stack', () => {
    const mockScreen = jest.fn(() => null);
    return {
        createNativeStackNavigator: () => ({
            Navigator: ({ children }) => children,
            Screen: mockScreen,
        }),
        __mockScreen: mockScreen,
    };
});

const { __mockScreen: mockScreen } = require('@react-navigation/native-stack');

describe('RootNavigator', () => {
    it("disables the Game screen's swipe-back gesture", async () => {
        await render(<RootNavigator />);

        const gameScreenCall = mockScreen.mock.calls.find(([props]) => props.name === 'Game');
        expect(gameScreenCall).toBeDefined();
        expect(gameScreenCall[0].options).toMatchObject({ gestureEnabled: false });
    });
});
