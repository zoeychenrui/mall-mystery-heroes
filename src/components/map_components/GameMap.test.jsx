/**
 * Layer 2 — React Testing Library, the map library fully mocked.
 * mapbox-gl needs a real WebGL canvas, which jsdom has no analog for;
 * see docs/testing.md's device-testing note for this feature. Every
 * test here exercises GameMap's own logic (token gating, style toggle,
 * boundary overlay shape, fit/jump-on-load, error fallback) against a
 * mock Map/Source/Layer, never a real map.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import GameMap from './GameMap';

const styleLoadHandlers = [];
const mockMapInstance = {
    fitBounds: jest.fn(),
    jumpTo: jest.fn(),
    setProjection: jest.fn(),
    on: jest.fn((event, handler) => {
        if (event === 'style.load') styleLoadHandlers.push(handler);
    }),
};
const mockShouldError = { current: false };

jest.mock('react-map-gl', () => {
    const ReactForMock = require('react');
    return {
        Map: (props) => {
            ReactForMock.useEffect(() => {
                if (mockShouldError.current) {
                    props.onError();
                } else {
                    props.onLoad({ target: mockMapInstance });
                }
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            return (
                <div
                    data-testid="mock-map"
                    data-style={props.mapStyle}
                    data-drag-pan={String(props.dragPan)}
                >
                    {props.children}
                </div>
            );
        },
        Source: ({ children, data, id }) => (
            <div
                data-testid={
                    id === 'own-position-accuracy' ? 'own-position-accuracy-source' : 'mock-source'
                }
                data-geojson={JSON.stringify(data)}
            >
                {children}
            </div>
        ),
        Marker: ({ longitude, latitude, children, 'data-testid': testId }) => (
            <div data-testid={testId ?? 'mock-marker'} data-lng={longitude} data-lat={latitude}>
                {children}
            </div>
        ),
        Layer: () => null,
    };
});
jest.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}), { virtual: true });

const RING = [
    { lat: 10, lng: 20 },
    { lat: 10, lng: 21 },
    { lat: 11, lng: 21 },
    { lat: 10, lng: 20 },
];

const renderMap = (props = {}) =>
    render(
        <ChakraProvider>
            <GameMap boundaryVertices={null} fitTo={null} {...props} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    mockShouldError.current = false;
    styleLoadHandlers.length = 0;
    process.env.REACT_APP_MAPBOX_TOKEN = 'test-token';
});

afterEach(() => {
    delete process.env.REACT_APP_MAPBOX_TOKEN;
});

describe('GameMap', () => {
    it('shows an unconfigured message instead of a map when no token is set', () => {
        delete process.env.REACT_APP_MAPBOX_TOKEN;
        renderMap();
        expect(screen.getByTestId('game-map-unconfigured')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-map')).not.toBeInTheDocument();
    });

    it('renders no boundary overlay when boundaryVertices is null', () => {
        renderMap({ boundaryVertices: null });
        expect(screen.queryByTestId('mock-source')).not.toBeInTheDocument();
    });

    it('renders the boundary as a GeoJSON polygon with coordinate order flipped to [lng, lat]', () => {
        renderMap({ boundaryVertices: RING });
        const geojson = JSON.parse(screen.getByTestId('mock-source').getAttribute('data-geojson'));
        expect(geojson.geometry.coordinates[0][0]).toEqual([20, 10]);
    });

    it('fits the map to the boundary bounds on load when a boundary is given', () => {
        renderMap({ boundaryVertices: RING });
        expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
            [
                [20, 10],
                [21, 11],
            ],
            expect.objectContaining({ padding: 48 })
        );
    });

    it('jumps to fitTo on load when there is no boundary', () => {
        renderMap({ boundaryVertices: null, fitTo: { lat: 6, lng: 5 } });
        expect(mockMapInstance.jumpTo).toHaveBeenCalledWith(
            expect.objectContaining({ center: [5, 6] })
        );
    });

    it("jumps to the moderator's own location when there is no boundary and no fitTo", () => {
        const getCurrentPosition = jest.fn((onSuccess) => {
            onSuccess({ coords: { latitude: 9, longitude: 8 } });
        });
        Object.defineProperty(global.navigator, 'geolocation', {
            value: { getCurrentPosition },
            configurable: true,
        });
        renderMap({ boundaryVertices: null, fitTo: null });
        expect(mockMapInstance.jumpTo).toHaveBeenCalledWith(
            expect.objectContaining({ center: [8, 9], zoom: 15 })
        );
        delete global.navigator.geolocation;
    });

    it('stays at the fallback view when geolocation is denied, unavailable, or times out', () => {
        const getCurrentPosition = jest.fn((_onSuccess, onError) => {
            onError(new Error('denied'));
        });
        Object.defineProperty(global.navigator, 'geolocation', {
            value: { getCurrentPosition },
            configurable: true,
        });
        renderMap({ boundaryVertices: null, fitTo: null });
        expect(mockMapInstance.jumpTo).not.toHaveBeenCalled();
        delete global.navigator.geolocation;
    });

    it('does not attempt to locate the moderator when the browser has no geolocation API at all', () => {
        renderMap({ boundaryVertices: null, fitTo: null });
        expect(mockMapInstance.jumpTo).not.toHaveBeenCalled();
    });

    it('calls onMapLoad with the underlying map instance', () => {
        const onMapLoad = jest.fn();
        renderMap({ onMapLoad });
        expect(onMapLoad).toHaveBeenCalledWith(mockMapInstance);
    });

    it('forces the flat 2D projection on load, never the 3D globe', () => {
        renderMap();
        expect(mockMapInstance.setProjection).toHaveBeenCalledWith('mercator');
    });

    it('reasserts the flat projection on every later style load too, not just the first', () => {
        renderMap();
        mockMapInstance.setProjection.mockClear();

        // Simulates Mapbox reloading its own style (e.g. the
        // satellite/standard toggle, or a reused map instance getting a
        // fresh style) — each one bakes its own projection default back
        // in unless we reassert mercator every time.
        styleLoadHandlers.forEach((handler) => handler());

        expect(mockMapInstance.setProjection).toHaveBeenCalledWith('mercator');
    });

    it('defaults to the non-satellite Standard style, then toggles to satellite and back', () => {
        renderMap();
        expect(screen.getByTestId('mock-map')).toHaveAttribute(
            'data-style',
            'mapbox://styles/mapbox/streets-v11'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
        expect(screen.getByTestId('mock-map')).toHaveAttribute(
            'data-style',
            'mapbox://styles/mapbox/standard-satellite'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Standard map' }));
        expect(screen.getByTestId('mock-map')).toHaveAttribute(
            'data-style',
            'mapbox://styles/mapbox/streets-v11'
        );
    });

    it('shows Retry and calls onMapError when the map fails to load, and Retry clears the error', () => {
        mockShouldError.current = true;
        const onMapError = jest.fn();
        renderMap({ onMapError });
        expect(onMapError).toHaveBeenCalled();
        expect(screen.getByTestId('game-map-error')).toBeInTheDocument();

        mockShouldError.current = false;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(screen.getByTestId('mock-map')).toBeInTheDocument();
    });

    it('defaults dragPan to true, and passes false through once the caller sets it', () => {
        const { rerender } = renderMap();
        expect(screen.getByTestId('mock-map')).toHaveAttribute('data-drag-pan', 'true');

        rerender(
            <ChakraProvider>
                <GameMap boundaryVertices={null} fitTo={null} dragPan={false} />
            </ChakraProvider>
        );
        expect(screen.getByTestId('mock-map')).toHaveAttribute('data-drag-pan', 'false');
    });

    it('renders children inside the map, alongside the boundary overlay', () => {
        renderMap({ children: <div data-testid="child-marker" /> });
        expect(screen.getByTestId('child-marker')).toBeInTheDocument();
    });
});

describe('GameMap — own position', () => {
    it('renders no marker and no accuracy source when ownPosition is null', () => {
        renderMap({ ownPosition: null });
        expect(screen.queryByTestId('mock-marker')).not.toBeInTheDocument();
        expect(screen.queryByTestId('own-position-accuracy-source')).not.toBeInTheDocument();
    });

    it('renders a marker at the given position', () => {
        renderMap({ ownPosition: { lat: 10, lng: 20, accuracyM: 15 } });
        const marker = screen.getByTestId('mock-marker');
        expect(marker).toHaveAttribute('data-lng', '20');
        expect(marker).toHaveAttribute('data-lat', '10');
    });

    it('renders the accuracy circle as a sampled polygon centered on the position', () => {
        renderMap({ ownPosition: { lat: 10, lng: 20, accuracyM: 15 } });
        const source = screen.getByTestId('own-position-accuracy-source');
        const geojson = JSON.parse(source.getAttribute('data-geojson'));
        const ring = geojson.geometry.coordinates[0];
        // A circle's own center is the average of its ring's points —
        // close enough to 20/10 to confirm this used the position, not
        // some other default.
        const avgLng = ring.reduce((sum, [lng]) => sum + lng, 0) / ring.length;
        const avgLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
        expect(avgLng).toBeCloseTo(20, 3);
        expect(avgLat).toBeCloseTo(10, 3);
    });

    it('renders the marker but no accuracy circle when accuracyM is zero or invalid', () => {
        renderMap({ ownPosition: { lat: 10, lng: 20, accuracyM: 0 } });
        expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
        expect(screen.queryByTestId('own-position-accuracy-source')).not.toBeInTheDocument();
    });
});

describe("GameMap — other players' positions", () => {
    it('renders no markers when otherPositions is empty or omitted', () => {
        renderMap({ otherPositions: [] });
        expect(screen.queryAllByTestId('other-position-marker')).toHaveLength(0);
    });

    it('renders one marker per entry in otherPositions, at the right coordinates', () => {
        renderMap({
            otherPositions: [
                { id: 'alice', lat: 10, lng: 20 },
                { id: 'bob', lat: 30, lng: 40 },
            ],
        });
        const markers = screen.getAllByTestId('other-position-marker');
        expect(markers).toHaveLength(2);
        expect(markers[0]).toHaveAttribute('data-lng', '20');
        expect(markers[0]).toHaveAttribute('data-lat', '10');
        expect(markers[1]).toHaveAttribute('data-lng', '40');
        expect(markers[1]).toHaveAttribute('data-lat', '30');
    });

    it('shows a hover tooltip (not a native title attribute) for a position with a label and no alwaysShowLabel', () => {
        renderMap({
            otherPositions: [{ id: 'alice', lat: 10, lng: 20, label: 'Alice' }],
        });
        const marker = screen.getByTestId('other-position-marker');
        // No native title attribute at all — the tooltip is a separate
        // rendered element now, not an HTML attribute. Queried via
        // Testing Library's own getByTitle/queryByTitle (not direct DOM
        // access) to satisfy this repo's testing-library/no-node-access
        // lint rule, same as the within(...).queryByTitle usage this
        // file's own now-superseded hover test used to rely on.
        expect(within(marker).queryByTitle(/./)).not.toBeInTheDocument();
        // The strengthened half of this test: not just "no native title",
        // but the always-visible label truly never renders without
        // alwaysShowLabel — this would still have passed the assertion
        // above even if the always-visible label rendered unconditionally.
        expect(screen.queryByTestId('always-visible-label')).not.toBeInTheDocument();
        expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });

    it('always renders a visible label (no hover needed) when alwaysShowLabel is true', () => {
        renderMap({
            otherPositions: [
                { id: 'alice', lat: 10, lng: 20, label: 'Alice', alwaysShowLabel: true },
            ],
        });
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('does not render a visible label at all for a position with no label', () => {
        renderMap({ otherPositions: [{ id: 'alice', lat: 10, lng: 20 }] });
        expect(
            screen.queryByText(/./, { selector: '[data-testid="always-visible-label"]' })
        ).not.toBeInTheDocument();
    });
});
