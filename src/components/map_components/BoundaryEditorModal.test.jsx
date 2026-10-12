/**
 * Layer 2 — React Testing Library. GameMap is replaced with a thin mock
 * that exposes the real `map` instance handed to onMapLoad (a fake
 * mapbox-gl Map) and renders its children (the editing handles
 * BoundaryEditorModal passes it), so these tests exercise
 * BoundaryEditorModal's own drawing/move/resize logic, not GameMap's
 * (GameMap.test.jsx already covers that).
 *
 * `fakeMap.on`/`off` deliberately mirror real mapbox-gl's Evented
 * semantics (node_modules/mapbox-gl/dist/mapbox-gl-dev.js): each event
 * type holds an array of listeners in registration order, and `off`
 * only removes a listener matched by reference — `off(type)` with no
 * handler removes nothing. An earlier version of this file's mock kept
 * a single handler per event name instead, which hid a real production
 * bug (switching drawing tools never actually detached the previous
 * tool's listeners, since the real map's `off(event)` with no handler
 * argument is a no-op) — the current architecture (one persistent
 * attachment, read via refs, torn down only on unmount) makes that
 * particular bug class structurally impossible, but the faithful mock
 * stays, since it costs nothing and guards against ever reintroducing
 * per-tool attach/detach.
 *
 * react-map-gl's `Marker` is mocked too: it relies on a real `<Map>`'s
 * React context to position itself, which doesn't exist here. The mock
 * below just registers each marker's onDrag/onDragEnd callbacks by its
 * child's data-testid and renders the child directly, so a test can
 * simulate a handle drag with `simulateMarkerDrag('handle-e', {lat,lng})`.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import BoundaryEditorModal from './BoundaryEditorModal';
import { publishGameBoundary } from '../publishGameBoundary';
import { disableGameBoundary } from '../disableGameBoundary';

let lastProps;
const mapEventHandlers = {};
const fakeMap = {
    on: (event, handler) => {
        if (!mapEventHandlers[event]) mapEventHandlers[event] = [];
        mapEventHandlers[event].push(handler);
    },
    off: (event, handler) => {
        if (!mapEventHandlers[event] || handler === undefined) return;
        mapEventHandlers[event] = mapEventHandlers[event].filter(
            (registered) => registered !== handler
        );
    },
};
// Fires every handler currently registered for `event`, in registration
// order — exactly like the real map's `fire()`. Every real mapbox-gl
// MapMouseEvent carries its own `preventDefault()` (the actual mechanism
// BoundaryEditorModal uses to claim a gesture away from panning — see
// node_modules/mapbox-gl/dist/mapbox-gl.d.ts's MapMouseEvent), so the
// fake payload needs one too.
const triggerMapEvent = (event, payload) => {
    (mapEventHandlers[event] || []).forEach((handler) =>
        handler({ preventDefault: jest.fn(), ...payload })
    );
};

const markerRegistry = {};

jest.mock('react-map-gl', () => ({
    Marker: (props) => {
        const testId = props.children?.props?.['data-testid'];
        if (testId) {
            markerRegistry[testId] = { onDrag: props.onDrag, onDragEnd: props.onDragEnd };
        }
        return props.children;
    },
    Source: ({ id, data }) => (
        <div data-testid={`source-${id}`} data-geojson={JSON.stringify(data)} />
    ),
    Layer: () => null,
}));

const simulateMarkerDrag = (testId, point) => {
    const handlers = markerRegistry[testId];
    const event = { lngLat: point };
    act(() => {
        if (handlers.onDrag) handlers.onDrag(event);
        if (handlers.onDragEnd) handlers.onDragEnd(event);
    });
};

jest.mock('../publishGameBoundary', () => ({ publishGameBoundary: jest.fn() }));
jest.mock('../disableGameBoundary', () => ({ disableGameBoundary: jest.fn() }));

jest.mock('./GameMap', () => (props) => {
    lastProps = props;
    const React = require('react');
    // Mirrors the real GameMap: mapbox-gl's 'load' event (and so
    // onMapLoad) fires exactly once per mount, never again on re-render.
    const onMapLoadRef = React.useRef(props.onMapLoad);
    onMapLoadRef.current = props.onMapLoad;
    React.useEffect(() => {
        if (onMapLoadRef.current) onMapLoadRef.current(fakeMap);
    }, []);
    return <div data-testid="mock-game-map">{props.children}</div>;
});

const renderModal = (props = {}) =>
    render(
        <ChakraProvider>
            <BoundaryEditorModal
                isOpen
                onClose={jest.fn()}
                currentBoundary={undefined}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mapEventHandlers).forEach((key) => delete mapEventHandlers[key]);
    Object.keys(markerRegistry).forEach((key) => delete markerRegistry[key]);
});

// Fake lng/lat -> pixel mapping, just distinct enough per point that
// nothing relying on pixel distance gets confused.
const pointFor = (lat, lng) => ({ x: (lng + 74) * 100000, y: (lat - 40) * 100000 });

const dragMap = (from, to) => {
    act(() => {
        triggerMapEvent('mousedown', { lngLat: from, point: pointFor(from.lat, from.lng) });
        triggerMapEvent('mousemove', { lngLat: to, point: pointFor(to.lat, to.lng) });
        triggerMapEvent('mouseup', { lngLat: to, point: pointFor(to.lat, to.lng) });
    });
};

const click = (lngLat) => {
    act(() => {
        triggerMapEvent('click', { lngLat });
    });
};

// Drops the closing duplicate (vertices is always a closed ring) before
// averaging, or that one point gets double-weighted — negligible for a
// 64-sample circle, but a real, test-breaking bias for a 4-corner
// rectangle (1/5 of the weight landing on one corner).
const centroid = (vertices) => {
    const distinct = vertices.slice(0, -1);
    return {
        lat: distinct.reduce((sum, v) => sum + v.lat, 0) / distinct.length,
        lng: distinct.reduce((sum, v) => sum + v.lng, 0) / distinct.length,
    };
};

const BOX_HANDLE_KEYS = ['sw', 's', 'se', 'e', 'ne', 'n', 'nw', 'w'];

describe('BoundaryEditorModal — always-pannable map, no Move Map mode', () => {
    it('has no Move Map button at all', () => {
        renderModal();
        expect(screen.queryByRole('button', { name: 'Move Map' })).not.toBeInTheDocument();
    });

    it('never overrides dragPan — GameMap keeps panning enabled the whole time', () => {
        renderModal();
        expect(lastProps.dragPan).toBeUndefined();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        expect(lastProps.dragPan).toBeUndefined();
    });
});

describe('BoundaryEditorModal — reopen and cancel', () => {
    it('reopens an existing boundary with its exact shapeType and shapeParameters, fed to GameMap as the current draft', () => {
        const currentBoundary = {
            enabled: true,
            revision: 3,
            shapeType: 'circle',
            shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 500 },
            vertices: [{ lat: 40.001, lng: -74 }],
        };
        renderModal({ currentBoundary });
        expect(lastProps.boundaryVertices).toEqual(currentBoundary.vertices);
    });

    it('Cancel discards the draft and calls onClose without publishing', () => {
        const onClose = jest.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('Cancel after drawing discards the draft; reopening starts from the last published boundary, not the abandoned draft', () => {
        const { rerender } = renderModal({ roomID: 'room-a', isOpen: true, onClose: jest.fn() });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();

        rerender(
            <ChakraProvider>
                <BoundaryEditorModal
                    isOpen={false}
                    onClose={jest.fn()}
                    roomID="room-a"
                    currentBoundary={undefined}
                />
            </ChakraProvider>
        );
        rerender(
            <ChakraProvider>
                <BoundaryEditorModal
                    isOpen
                    onClose={jest.fn()}
                    roomID="room-a"
                    currentBoundary={undefined}
                />
            </ChakraProvider>
        );
        expect(lastProps.boundaryVertices).toBeNull();
    });
});

describe('BoundaryEditorModal — creating a shape', () => {
    it('draws a rectangle by dragging from one corner to the other', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        expect(lastProps.boundaryVertices).not.toBeNull();
        expect(lastProps.boundaryVertices.length).toBeGreaterThan(0);
    });

    it('draws a circle centered on the drag start, sized by the drag distance', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));

        // A very short drag leaves a near-zero radius — not a publishable
        // shape yet (0.000001 deg ~= 0.11m radius, under the 1 sqm
        // minimum area gameBoundary.js enforces).
        dragMap({ lat: 40, lng: -74 }, { lat: 40.000001, lng: -74 });
        expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();

        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();
    });

    it('draws an oval by dragging a bounding box, inscribed within it', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Oval' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        expect(lastProps.boundaryVertices).not.toBeNull();
        expect(lastProps.boundaryVertices.length).toBeGreaterThan(0);
    });

    it('places a freehand vertex on each click while armed, and Finish closes the shape', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        click({ lat: 40, lng: -74 });
        click({ lat: 40.001, lng: -74 });
        click({ lat: 40.001, lng: -73.999 });
        expect(screen.getAllByTestId('freehand-point')).toHaveLength(3);

        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(lastProps.boundaryVertices).toHaveLength(4); // 3 distinct + closing duplicate
    });

    it('connects the in-progress freehand points with a line as each one is placed', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        click({ lat: 40, lng: -74 });
        expect(screen.queryByTestId('source-freehand-in-progress')).not.toBeInTheDocument();

        click({ lat: 40.001, lng: -74 });
        click({ lat: 40.001, lng: -73.999 });
        const source = screen.getByTestId('source-freehand-in-progress');
        const geojson = JSON.parse(source.getAttribute('data-geojson'));
        expect(geojson.geometry.type).toBe('LineString');
        expect(geojson.geometry.coordinates).toEqual([
            [-74, 40],
            [-74, 40.001],
            [-73.999, 40.001],
        ]);
    });

    it('the Finish button only appears once at least 3 freehand points are placed', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();

        click({ lat: 40, lng: -74 });
        click({ lat: 40.001, lng: -74 });
        expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();

        click({ lat: 40.001, lng: -73.999 });
        expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    });

    it('clicking an already-armed tool disarms it, so a subsequent drag does not create a shape', () => {
        renderModal();
        const circleButton = screen.getByRole('button', { name: 'Circle' });
        fireEvent.click(circleButton);
        fireEvent.click(circleButton);
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).toBeNull();
    });

    it('selecting a new tool replaces the current shape once the new drag finishes', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const circleVertices = lastProps.boundaryVertices;

        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 41, lng: -75 }, { lat: 41.01, lng: -74.99 });

        expect(lastProps.boundaryVertices).not.toEqual(circleVertices);
    });
});

describe('BoundaryEditorModal — editing handles', () => {
    it('renders 8 box handles for a rectangle, and hides them while a new-shape tool is armed', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        BOX_HANDLE_KEYS.forEach((key) => {
            expect(screen.getByTestId(`handle-${key}`)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        BOX_HANDLE_KEYS.forEach((key) => {
            expect(screen.queryByTestId(`handle-${key}`)).not.toBeInTheDocument();
        });
    });

    it('dragging a rectangle corner handle resizes it, keeping the opposite corner fixed', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });

        simulateMarkerDrag('handle-ne', { lat: 40.02, lng: -73.98 });

        const vertices = lastProps.boundaryVertices;
        expect(Math.min(...vertices.map((v) => v.lat))).toBeCloseTo(40, 5);
        expect(Math.min(...vertices.map((v) => v.lng))).toBeCloseTo(-74, 5);
        expect(Math.max(...vertices.map((v) => v.lat))).toBeCloseTo(40.02, 5);
        expect(Math.max(...vertices.map((v) => v.lng))).toBeCloseTo(-73.98, 5);
    });

    it('dragging a rectangle edge-midpoint handle resizes only that one edge', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });

        simulateMarkerDrag('handle-n', { lat: 40.05, lng: -73.985 });

        const vertices = lastProps.boundaryVertices;
        expect(Math.max(...vertices.map((v) => v.lat))).toBeCloseTo(40.05, 5);
        expect(Math.min(...vertices.map((v) => v.lng))).toBeCloseTo(-74, 5);
        expect(Math.max(...vertices.map((v) => v.lng))).toBeCloseTo(-73.99, 5);
    });

    it('renders 4 edge handles for a circle, and dragging one resizes the radius while keeping the center fixed', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.005, lng: -74 });
        ['e', 'w', 'n', 's'].forEach((key) => {
            expect(screen.getByTestId(`handle-${key}`)).toBeInTheDocument();
        });

        const before = lastProps.boundaryVertices;
        const beforeCenter = centroid(before);
        const beforeSpread = Math.max(
            ...before.map((v) => Math.hypot(v.lat - beforeCenter.lat, v.lng - beforeCenter.lng))
        );

        simulateMarkerDrag('handle-e', { lat: 40, lng: -73.98 });

        const after = lastProps.boundaryVertices;
        const afterCenter = centroid(after);
        const afterSpread = Math.max(
            ...after.map((v) => Math.hypot(v.lat - afterCenter.lat, v.lng - afterCenter.lng))
        );
        expect(afterCenter.lat).toBeCloseTo(beforeCenter.lat, 3);
        expect(afterCenter.lng).toBeCloseTo(beforeCenter.lng, 3);
        expect(afterSpread).toBeGreaterThan(beforeSpread);
    });

    it('renders 8 box handles for an oval, and dragging an edge-midpoint resizes only that axis', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Oval' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        BOX_HANDLE_KEYS.forEach((key) => {
            expect(screen.getByTestId(`handle-${key}`)).toBeInTheDocument();
        });

        const before = lastProps.boundaryVertices;
        const beforeMaxLat = Math.max(...before.map((v) => v.lat));
        const beforeMinLat = Math.min(...before.map((v) => v.lat));
        const beforeMaxLng = Math.max(...before.map((v) => v.lng));

        simulateMarkerDrag('handle-e', { lat: 40.005, lng: -73.96 });

        const after = lastProps.boundaryVertices;
        expect(Math.max(...after.map((v) => v.lat))).toBeCloseTo(beforeMaxLat, 3);
        expect(Math.min(...after.map((v) => v.lat))).toBeCloseTo(beforeMinLat, 3);
        expect(Math.max(...after.map((v) => v.lng))).toBeGreaterThan(beforeMaxLng);
    });

    it('renders one handle per freehand vertex, excluding the closing duplicate, and dragging one moves just that vertex', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        click({ lat: 40, lng: -74 });
        click({ lat: 40.001, lng: -74 });
        click({ lat: 40.001, lng: -73.999 });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

        expect(screen.getByTestId('handle-vertex-0')).toBeInTheDocument();
        expect(screen.getByTestId('handle-vertex-1')).toBeInTheDocument();
        expect(screen.getByTestId('handle-vertex-2')).toBeInTheDocument();
        expect(screen.queryByTestId('handle-vertex-3')).not.toBeInTheDocument();

        simulateMarkerDrag('handle-vertex-1', { lat: 40.002, lng: -74.001 });

        const vertices = lastProps.boundaryVertices;
        expect(vertices[1]).toEqual({ lat: 40.002, lng: -74.001 });
        expect(vertices[0]).toEqual({ lat: 40, lng: -74 });
    });

    it('dragging the first freehand vertex handle also moves the closing duplicate, so the ring stays closed', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        click({ lat: 40, lng: -74 });
        click({ lat: 40.001, lng: -74 });
        click({ lat: 40.001, lng: -73.999 });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

        simulateMarkerDrag('handle-vertex-0', { lat: 40.0005, lng: -74.0005 });

        const vertices = lastProps.boundaryVertices;
        expect(vertices[0]).toEqual({ lat: 40.0005, lng: -74.0005 });
        expect(vertices[vertices.length - 1]).toEqual({ lat: 40.0005, lng: -74.0005 });
    });
});

describe('BoundaryEditorModal — rotating a shape', () => {
    it('shows a rotation handle with a stem line for a rectangle, but not for a circle', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        expect(screen.getByTestId('handle-rotate')).toBeInTheDocument();
        expect(screen.getByTestId('source-rotation-stem')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 41, lng: -75 }, { lat: 41.01, lng: -75 });
        expect(screen.queryByTestId('handle-rotate')).not.toBeInTheDocument();
    });

    it('hides the rotation handle while a new-shape tool is armed, same as the resize handles', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        expect(screen.getByTestId('handle-rotate')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Oval' }));
        expect(screen.queryByTestId('handle-rotate')).not.toBeInTheDocument();
    });

    it('rotating a rectangle converts it to a Freehand shape, keeping its vertices (and so its on-map position) in place', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        const before = lastProps.boundaryVertices;
        const beforeCenter = centroid(before);

        // Drag the rotation handle to a point roughly 90 degrees around
        // from where it started.
        simulateMarkerDrag('handle-rotate', {
            lat: beforeCenter.lat,
            lng: beforeCenter.lng + 0.02,
        });

        // It's no longer box-edited — the box handles are gone, replaced
        // by one handle per vertex, the same as any other Freehand shape.
        expect(screen.queryByTestId('handle-sw')).not.toBeInTheDocument();
        expect(screen.getByTestId('handle-vertex-0')).toBeInTheDocument();

        const after = lastProps.boundaryVertices;
        expect(after).not.toEqual(before);
        // Rotating around the centroid never moves the centroid itself.
        const afterCenter = centroid(after);
        expect(afterCenter.lat).toBeCloseTo(beforeCenter.lat, 3);
        expect(afterCenter.lng).toBeCloseTo(beforeCenter.lng, 3);
    });

    it('rotating a Freehand shape stays Freehand and rotates around its own centroid', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        click({ lat: 40, lng: -74 });
        click({ lat: 40.001, lng: -74 });
        click({ lat: 40.001, lng: -73.999 });
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        const before = lastProps.boundaryVertices;
        const beforeCenter = centroid(before);

        simulateMarkerDrag('handle-rotate', {
            lat: beforeCenter.lat + 0.001,
            lng: beforeCenter.lng,
        });

        const after = lastProps.boundaryVertices;
        expect(after).not.toEqual(before);
        const afterCenter = centroid(after);
        expect(afterCenter.lat).toBeCloseTo(beforeCenter.lat, 3);
        expect(afterCenter.lng).toBeCloseTo(beforeCenter.lng, 3);
    });

    it('Undo after a rotation restores the pre-rotation shape, box handles included', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        const beforeRotate = lastProps.boundaryVertices;

        simulateMarkerDrag('handle-rotate', { lat: 40.005, lng: -73.97 });
        expect(screen.queryByTestId('handle-sw')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).toEqual(beforeRotate);
        expect(screen.getByTestId('handle-sw')).toBeInTheDocument();
    });
});

describe('BoundaryEditorModal — moving a shape', () => {
    it('clicking and dragging inside an existing shape moves it, without resizing it', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const before = lastProps.boundaryVertices;
        const beforeCenter = centroid(before);
        const beforeSpread = Math.max(
            ...before.map((v) => Math.hypot(v.lat - beforeCenter.lat, v.lng - beforeCenter.lng))
        );

        // The circle's own center is guaranteed to be inside it.
        dragMap({ lat: 40, lng: -74 }, { lat: 40.005, lng: -74.005 });

        const after = lastProps.boundaryVertices;
        const afterCenter = centroid(after);
        const afterSpread = Math.max(
            ...after.map((v) => Math.hypot(v.lat - afterCenter.lat, v.lng - afterCenter.lng))
        );
        expect(afterCenter.lat).toBeCloseTo(beforeCenter.lat + 0.005, 3);
        expect(afterCenter.lng).toBeCloseTo(beforeCenter.lng - 0.005, 3);
        expect(afterSpread).toBeCloseTo(beforeSpread, 3);
    });

    it('a drag starting outside the shape, with no tool armed, leaves it untouched (the map pans natively instead)', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const before = lastProps.boundaryVertices;

        dragMap({ lat: 50, lng: -74 }, { lat: 50.01, lng: -74 });

        expect(lastProps.boundaryVertices).toEqual(before);
    });
});

describe('BoundaryEditorModal — undo, clear draft, and map errors', () => {
    it('Clear Draft removes the shape and any in-progress tool/freehand state', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear Draft' }));
        expect(lastProps.boundaryVertices).toBeNull();
        expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
    });

    it('Undo restores the draft from before the last completed drag', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const afterFirstDrag = lastProps.boundaryVertices;

        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        dragMap({ lat: 41, lng: -75 }, { lat: 41.02, lng: -74.98 });
        expect(lastProps.boundaryVertices).not.toEqual(afterFirstDrag);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).toEqual(afterFirstDrag);
    });

    it('Undo after a handle-drag resize restores the draft from before that resize', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const beforeResize = lastProps.boundaryVertices;

        simulateMarkerDrag('handle-e', { lat: 40, lng: -73.9 });
        expect(lastProps.boundaryVertices).not.toEqual(beforeResize);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).toEqual(beforeResize);
    });

    it('disables every toolbar button when the map reports an error', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        act(() => {
            lastProps.onMapError();
        });

        ['Freehand', 'Rectangle', 'Circle', 'Oval', 'Undo', 'Clear Draft'].forEach((name) => {
            expect(screen.getByRole('button', { name })).toBeDisabled();
        });
    });

    it('re-enables the toolbar once the map reloads after a successful Retry', () => {
        renderModal();
        act(() => {
            lastProps.onMapError();
        });
        expect(screen.getByRole('button', { name: 'Circle' })).toBeDisabled();

        act(() => {
            lastProps.onMapLoad(fakeMap);
        });
        expect(screen.getByRole('button', { name: 'Circle' })).toBeEnabled();
    });
});

describe('BoundaryEditorModal — publish and disable', () => {
    it('Publish Boundary is disabled until the draft is valid, and calls the callable with the draft once it is', async () => {
        publishGameBoundary.mockResolvedValue({ revision: 1 });
        const onClose = jest.fn();
        renderModal({ roomID: 'room-a', onClose });

        expect(screen.queryByRole('button', { name: 'Publish Boundary' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        const publishButton = screen.getByRole('button', { name: 'Publish Boundary' });
        expect(publishButton).toBeEnabled();

        fireEvent.click(publishButton);
        expect(await screen.findByText('Boundary published.')).toBeInTheDocument();
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        expect(publishGameBoundary).toHaveBeenCalledWith(
            expect.objectContaining({ roomId: 'room-a', expectedRevision: 0, shapeType: 'circle' })
        );
    });

    it('labels the button Publish Changes, and uses the current revision, when a boundary already exists', () => {
        renderModal({
            roomID: 'room-a',
            currentBoundary: {
                enabled: true,
                revision: 4,
                shapeType: 'circle',
                shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 100 },
                vertices: [{ lat: 40.001, lng: -74 }],
            },
        });
        expect(screen.getByRole('button', { name: 'Publish Changes' })).toBeEnabled();
    });

    it('shows "Boundary updated." (not "Boundary published.") when republishing an existing boundary', async () => {
        publishGameBoundary.mockResolvedValue({ revision: 5 });
        const onClose = jest.fn();
        renderModal({
            roomID: 'room-a',
            onClose,
            currentBoundary: {
                enabled: true,
                revision: 4,
                shapeType: 'circle',
                shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 100 },
                vertices: [{ lat: 40.001, lng: -74 }],
            },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Publish Changes' }));
        expect(await screen.findByText('Boundary updated.')).toBeInTheDocument();
        expect(screen.queryByText('Boundary published.')).not.toBeInTheDocument();
    });

    it('a revision conflict keeps the draft open and shows the conflict instead of closing', async () => {
        publishGameBoundary.mockRejectedValue(new Error('revision_conflict'));
        const onClose = jest.fn();
        renderModal({ roomID: 'room-a', onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        fireEvent.click(screen.getByRole('button', { name: 'Publish Boundary' }));
        expect(await screen.findByText(/someone else published a change/i)).toBeInTheDocument();

        expect(onClose).not.toHaveBeenCalled();
        expect(lastProps.boundaryVertices).not.toBeNull();
    });

    it('Disable Boundary is shown only when the current boundary is enabled, and calls the callable', async () => {
        disableGameBoundary.mockResolvedValue({ revision: 5 });
        const onClose = jest.fn();
        renderModal({
            roomID: 'room-a',
            onClose,
            currentBoundary: { enabled: true, revision: 4, shapeType: 'circle', vertices: [] },
        });

        const disableButton = screen.getByRole('button', { name: 'Disable Boundary' });
        fireEvent.click(disableButton);
        expect(await screen.findByText('Boundary disabled.')).toBeInTheDocument();
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        expect(disableGameBoundary).toHaveBeenCalledWith({ roomId: 'room-a', expectedRevision: 4 });
    });

    it('a revision conflict on Disable shows the friendly conflict message, not the raw error code', async () => {
        disableGameBoundary.mockRejectedValue(new Error('revision_conflict'));
        const onClose = jest.fn();
        renderModal({
            roomID: 'room-a',
            onClose,
            currentBoundary: { enabled: true, revision: 4, shapeType: 'circle', vertices: [] },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Disable Boundary' }));
        expect(await screen.findByText(/someone else published a change/i)).toBeInTheDocument();

        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByText('revision_conflict')).not.toBeInTheDocument();
    });

    it('a currentBoundary prop update while already open does not reset an in-progress draft', () => {
        const { rerender } = renderModal({ roomID: 'room-a', currentBoundary: undefined });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const drawn = lastProps.boundaryVertices;
        expect(drawn).not.toBeNull();

        rerender(
            <ChakraProvider>
                <BoundaryEditorModal
                    isOpen
                    onClose={jest.fn()}
                    roomID="room-a"
                    currentBoundary={{ enabled: false, revision: 0 }}
                />
            </ChakraProvider>
        );

        expect(lastProps.boundaryVertices).toEqual(drawn);
    });

    it('does not show Disable Boundary when there is no current boundary', () => {
        renderModal({ roomID: 'room-a', currentBoundary: undefined });
        expect(screen.queryByRole('button', { name: 'Disable Boundary' })).not.toBeInTheDocument();
    });

    it('hides Publish once the map fails to load, even with an otherwise-valid draft', () => {
        renderModal({ roomID: 'room-a' });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(screen.getByRole('button', { name: 'Publish Boundary' })).toBeInTheDocument();

        act(() => {
            lastProps.onMapError();
        });
        expect(screen.queryByRole('button', { name: 'Publish Boundary' })).not.toBeInTheDocument();
    });
});
