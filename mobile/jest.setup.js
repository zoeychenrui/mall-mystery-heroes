// AsyncStorage's native module does not exist under Jest. Swap in the
// library's bundled in-memory mock for every test.
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// SafeAreaProvider's real implementation renders its children only after the
// native view fires an onInsetsChange event with the measured frame/insets —
// that native event never fires under Jest, so without this, EVERY screen
// nested inside a SafeAreaProvider (i.e. anything reached through
// RootNavigator) renders as an empty <RNCSafeAreaProvider /> with no
// children, no matter what the screen itself does. The library ships this
// exact jest mock for that reason: a SafeAreaProvider that renders children
// immediately with fixed default metrics.
jest.mock('react-native-safe-area-context', () => {
    // The mock file is itself an ES module with only a default export; undo
    // that one level of wrapping so named imports (e.g. `{ SafeAreaProvider }`)
    // resolve against its properties instead of getting `undefined`.
    const mock = require('react-native-safe-area-context/jest/mock');
    return mock.default ?? mock;
});
