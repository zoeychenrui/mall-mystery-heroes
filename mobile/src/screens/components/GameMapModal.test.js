/**
 * Component test for GameMapModal — the RN port of
 * src/components/map_components/{GameMap.js,PlayerMapModal.js}. Despite
 * the filename, this is now one of GameScreen's five swipeable pages
 * (the Clash-Royale-style redesign), not a popup — no isOpen/onClose.
 * Purely presentational: no Firebase dependency, so no Firebase mocks
 * needed here (only GameScreen.test.js, which wires this in, needs those).
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
import { render, screen, fireEvent } from '@testing-library/react-native';
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
            isActive
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

    it('renders the boundary status prominently, so it stays visible while this page is full-screen', async () => {
        await renderModal({ statusText: 'You are outside the game area.' });
        expect(screen.getByText('You are outside the game area.')).toBeTruthy();
    });

    it('renders nothing extra when no statusText is given', async () => {
        await renderModal({ statusText: null });
        expect(screen.getByTestId('game-map-view')).toBeTruthy();
    });

    it('auto-centers on the own position once it becomes available while this is the active page', async () => {
        await renderModal({ isActive: true, ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        expect(mockAnimateToRegion).toHaveBeenCalledWith(
            expect.objectContaining({ latitude: 10, longitude: 20 })
        );
    });

    it('does not try to auto-center when there is no own position yet', async () => {
        await renderModal({ isActive: true, ownPosition: null });
        expect(mockAnimateToRegion).not.toHaveBeenCalled();
    });

    it('does not auto-center while this page is not the active one', async () => {
        await renderModal({ isActive: false, ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        expect(mockAnimateToRegion).not.toHaveBeenCalled();
    });

    it('does not re-center on every later position update while the page stays active', async () => {
        // useBoundaryLocation's watch delivers one update per OS fix
        // (timeInterval/distanceInterval both 0), so ownPosition's identity
        // changes constantly while this page is open — only the first one
        // per visit should move the map, or a player panning to look at
        // someone else gets yanked back moments later.
        const { rerender } = await render(
            <GameMapModal
                isActive
                boundaryVertices={RING}
                ownPosition={{ lat: 10, lng: 20, accuracyM: 12 }}
                otherPositions={[]}
            />
        );
        expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);

        await rerender(
            <GameMapModal
                isActive
                boundaryVertices={RING}
                ownPosition={{ lat: 10.001, lng: 20.001, accuracyM: 10 }}
                otherPositions={[]}
            />
        );
        expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);
    });

    it('centers again on the next visit after the page goes inactive and active again', async () => {
        const { rerender } = await render(
            <GameMapModal
                isActive
                boundaryVertices={RING}
                ownPosition={{ lat: 10, lng: 20, accuracyM: 12 }}
                otherPositions={[]}
            />
        );
        expect(mockAnimateToRegion).toHaveBeenCalledTimes(1);

        await rerender(
            <GameMapModal
                isActive={false}
                boundaryVertices={RING}
                ownPosition={{ lat: 10, lng: 20, accuracyM: 12 }}
                otherPositions={[]}
            />
        );
        await rerender(
            <GameMapModal
                isActive
                boundaryVertices={RING}
                ownPosition={{ lat: 30, lng: 40, accuracyM: 12 }}
                otherPositions={[]}
            />
        );
        expect(mockAnimateToRegion).toHaveBeenCalledTimes(2);
        expect(mockAnimateToRegion).toHaveBeenLastCalledWith(
            expect.objectContaining({ latitude: 30, longitude: 40 })
        );
    });

    it('shows a message instead of an empty map when zones are not enabled', async () => {
        await renderModal({ zonesEnabled: false });
        expect(screen.getByText("Zones aren't enabled for this game.")).toBeTruthy();
        expect(screen.queryByTestId('game-map-view')).toBeNull();
    });

    it('renders the real map as usual when zones are enabled', async () => {
        await renderModal({ zonesEnabled: true });
        expect(screen.getByTestId('game-map-view')).toBeTruthy();
    });

    // Parity with the web/old isMapAvailable, which hid the map in these
    // same two cases — not just UI tidiness: an eliminated player relaying
    // exposed players' live positions out of band to a still-alive friend
    // is a real meta-gaming risk in an in-person game.
    it('shows a message instead of the map once the game has ended', async () => {
        await renderModal({ isGameActive: false });
        expect(screen.getByText('The game has ended.')).toBeTruthy();
        expect(screen.queryByTestId('game-map-view')).toBeNull();
    });

    it("shows a message instead of the map once the player is eliminated", async () => {
        await renderModal({ isAlive: false });
        expect(screen.getByText("You can't view the map while eliminated.")).toBeTruthy();
        expect(screen.queryByTestId('game-map-view')).toBeNull();
    });
});
