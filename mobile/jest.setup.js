// AsyncStorage's native module does not exist under Jest. Swap in the
// library's bundled in-memory mock for every test.
jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
