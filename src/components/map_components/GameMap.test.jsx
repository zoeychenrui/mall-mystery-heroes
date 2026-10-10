/**
 * Layer 2 — React Testing Library, the map library fully mocked.
 * mapbox-gl needs a real WebGL canvas, which jsdom has no analog for;
 * see docs/testing.md's device-testing note for this feature. Every
 * test here exercises GameMap's own logic (token gating, style toggle,
 * boundary overlay shape, fit/jump-on-load, error fallback) against a
 * mock Map/Source/Layer, never a real map.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
        Source: ({ children, data }) => (
            <div data-testid="mock-source" data-geojson={JSON.stringify(data)}>
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

    it('toggles between satellite and standard styles', () => {
        renderMap();
        expect(screen.getByTestId('mock-map')).toHaveAttribute(
            'data-style',
            'mapbox://styles/mapbox/satellite-v9'
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
});
