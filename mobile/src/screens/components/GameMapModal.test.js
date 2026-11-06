/**
 * Component test for GameMapModal — the RN port of
 * src/components/map_components/{GameMap.js,PlayerMapModal.js}. Purely
 * presentational: no Firebase dependency, so no Firebase mocks needed here
 * (only GameScreen.test.js, which wires this in, needs those).
 *
 * 'react-native-maps' is mocked the same way the web tests mock
 * 'react-map-gl' (GameMap.test.jsx): MapView/Marker/Polygon become plain
 * Views carrying their original props straight through (coordinate,
 * coordinates, testID), so assertions read `.props` the same way every
 * other RN component test in this repo does (see ChatComposer.test.js,
 * JoinScreen.test.js).
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import GameMapModal from './GameMapModal';

const mockAnimateToRegion = jest.fn();

jest.mock('react-native-maps', () => {
    const ReactForMock = require('react');
    const { View } = require('react-native');
    const MockMapView = ReactForMock.forwardRef((props, ref) => {
        ReactForMock.useImperativeHandle(ref, () => ({
            animateToRegion: mockAnimateToRegion,
        }));
        return <View testID="game-map-view">{props.children}</View>;
    });
    const MockMarker = (props) => (
        <View testID={props.testID ?? 'mock-marker'} coordinate={props.coordinate}>
            {props.children}
        </View>
    );
    const MockPolygon = (props) => (
        <View testID="boundary-polygon" coordinates={props.coordinates} />
    );
    return {
        __esModule: true,
        default: MockMapView,
        Marker: MockMarker,
        Polygon: MockPolygon,
    };
});

const RING = [
    { lat: 10, lng: 20 },
    { lat: 10, lng: 21 },
    { lat: 11, lng: 21 },
    { lat: 10, lng: 20 },
];

const renderModal = async (props = {}) =>
    render(
        <GameMapModal
            isOpen
            onClose={jest.fn()}
            boundaryVertices={RING}
            ownPosition={null}
            otherPositions={[]}
            {...props}
        />
    );

beforeEach(() => jest.clearAllMocks());

describe('GameMapModal', () => {
    it('renders the boundary as a Polygon with coordinates in {latitude, longitude} order, no GeoJSON flip', async () => {
        await renderModal({ boundaryVertices: RING });
        const polygon = screen.getByTestId('boundary-polygon');
        expect(polygon.props.coordinates).toEqual([
            { latitude: 10, longitude: 20 },
            { latitude: 10, longitude: 21 },
            { latitude: 11, longitude: 21 },
            { latitude: 10, longitude: 20 },
        ]);
    });

    it('renders no boundary polygon when boundaryVertices is empty', async () => {
        await renderModal({ boundaryVertices: [] });
        expect(screen.queryByTestId('boundary-polygon')).toBeNull();
    });

    it("renders a marker at the player's own position", async () => {
        await renderModal({ ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        const marker = screen.getByTestId('own-position-marker');
        expect(marker.props.coordinate).toEqual({ latitude: 10, longitude: 20 });
    });

    it('renders no own-position marker when ownPosition is null', async () => {
        await renderModal({ ownPosition: null });
        expect(screen.queryByTestId('own-position-marker')).toBeNull();
    });

    it('renders one marker per entry in otherPositions, at the right coordinates', async () => {
        await renderModal({
            otherPositions: [
                { id: 'alice', lat: 10, lng: 20, label: 'Alice', alwaysShowLabel: true },
                { id: 'bob', lat: 30, lng: 40, label: 'Bob', alwaysShowLabel: true },
            ],
        });
        const markers = screen.getAllByTestId('other-position-marker');
        expect(markers).toHaveLength(2);
        expect(markers[0].props.coordinate).toEqual({ latitude: 10, longitude: 20 });
        expect(markers[1].props.coordinate).toEqual({ latitude: 30, longitude: 40 });
    });

    it('always shows each other-position label next to its marker, with no hover needed', async () => {
        await renderModal({
            otherPositions: [{ id: 'alice', lat: 10, lng: 20, label: 'Alice' }],
        });
        expect(screen.getByText('Alice')).toBeTruthy();
    });

    it('Recenter on Me is disabled with no own position', async () => {
        await renderModal({ ownPosition: null });
        expect(screen.getByLabelText('Recenter on Me').props.accessibilityState.disabled).toBe(
            true
        );
    });

    it('Recenter on Me animates the real map to the own position once available', async () => {
        await renderModal({ ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        await fireEvent.press(screen.getByLabelText('Recenter on Me'));
        expect(mockAnimateToRegion).toHaveBeenCalledWith(
            expect.objectContaining({ latitude: 10, longitude: 20 })
        );
    });

    it('renders the boundary status prominently, so it stays visible while the modal is full-screen', async () => {
        await renderModal({ statusText: 'You are outside the game area.' });
        expect(screen.getByText('You are outside the game area.')).toBeTruthy();
    });

    it('renders nothing extra when no statusText is given', async () => {
        await renderModal({ statusText: null });
        expect(screen.getByTestId('game-map-view')).toBeTruthy();
    });

    it('is not visible when isOpen is false', async () => {
        await renderModal({ isOpen: false });
        expect(screen.queryByTestId('game-map-view')).toBeNull();
    });

    it('pads the header by the top safe-area inset, so it clears the status bar/notch in the full-screen (non-transparent) Modal', async () => {
        // Real device bug: this Modal is not `transparent`, so unlike a
        // screen reached through React Navigation it gets no safe-area
        // handling for free — the header (title + close button) rendered
        // up under the iOS status bar/clock with the close button
        // unreachable. Reads the inset from context (useSafeAreaInsets)
        // rather than relying on the SafeAreaView component to remeasure
        // this Modal's own native window — that remeasurement was found to
        // be unreliable right after the OS's location-permission prompt
        // had just been shown and dismissed.
        await render(
            <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 0, left: 0, right: 0 }}>
                <GameMapModal
                    isOpen
                    onClose={jest.fn()}
                    boundaryVertices={RING}
                    ownPosition={null}
                    otherPositions={[]}
                />
            </SafeAreaInsetsContext.Provider>
        );
        const headerSafeArea = screen.getByTestId('map-header-safe-area');
        expect(headerSafeArea.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ paddingTop: 47 })])
        );
        expect(within(headerSafeArea).getByText('Game Area')).toBeTruthy();
        expect(within(headerSafeArea).getByLabelText('Close modal')).toBeTruthy();
    });

    it('auto-centers on the own position once it becomes available, without waiting for Recenter to be pressed', async () => {
        await renderModal({ ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        expect(mockAnimateToRegion).toHaveBeenCalledWith(
            expect.objectContaining({ latitude: 10, longitude: 20 })
        );
    });

    it('does not try to auto-center when there is no own position yet', async () => {
        await renderModal({ ownPosition: null });
        expect(mockAnimateToRegion).not.toHaveBeenCalled();
    });

    it('calls onClose when the close button is pressed', async () => {
        const onClose = jest.fn();
        await renderModal({ onClose });
        await fireEvent.press(screen.getByLabelText('Close modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
