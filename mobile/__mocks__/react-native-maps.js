// Manual mock for the whole package, picked up by Jest automatically for
// every test in this project (no jest.mock() call needed) — there is no
// native 'RNMapsAirModule' TurboModule under Jest, ever, unlike
// expo-location/expo-image-picker/etc., which jest-expo's preset already
// mocks for us. Without this, importing anything that reaches
// GameMapModal.js (GameScreen.js, App.js) throws at require time.
//
// A test that cares about GameMapModal's own map-rendering behavior
// (GameMapModal.test.js) overrides this with its own more detailed
// jest.mock('react-native-maps', ...) — that local mock takes precedence
// over this one for that file, same as any other manual mock.
const React = require('react');
const { View } = require('react-native');

const MapView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
        animateToRegion: () => {},
    }));
    return React.createElement(View, { testID: props.testID }, props.children);
});

const Marker = (props) => React.createElement(View, { testID: props.testID }, props.children);
const Polygon = (props) => React.createElement(View, { testID: props.testID });

module.exports = {
    __esModule: true,
    default: MapView,
    Marker,
    Polygon,
};
