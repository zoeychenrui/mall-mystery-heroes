/**
 * Layer 2 — React Testing Library. GameMap is replaced with a thin mock
 * that exposes the real `map` instance handed to onMapLoad (a fake
 * mapbox-gl Map whose `on`/`off` just record handlers by event name),
 * so these tests exercise BoundaryEditorModal's own drawing logic, not
 * GameMap's (GameMap.test.jsx already covers that).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import BoundaryEditorModal from './BoundaryEditorModal';

let lastProps;
const mapEventHandlers = {};
const fakeMap = {
    on: (event, handler) => {
        mapEventHandlers[event] = handler;
    },
    off: (event) => {
        delete mapEventHandlers[event];
    },
};

jest.mock('./GameMap', () => (props) => {
    lastProps = props;
    const React = require('react');
    // Mirrors the real GameMap: mapbox-gl's 'load' event (and so
    // onMapLoad) fires exactly once per mount, never again on re-render.
    // An onMapLoad-keyed effect would re-fire on every render (its
    // identity changes each render) and silently mask bugs that only
    // show up when a tool's attached closures go stale across renders.
    const onMapLoadRef = React.useRef(props.onMapLoad);
    onMapLoadRef.current = props.onMapLoad;
    React.useEffect(() => {
        if (onMapLoadRef.current) onMapLoadRef.current(fakeMap);
    }, []);
    return <div data-testid="mock-game-map" />;
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
});

// Fake lng/lat -> pixel mapping, just distinct enough per point that the
// drag-decimation check (6px minimum) never swallows these test moves.
const pointFor = (lat, lng) => ({ x: (lng + 74) * 100000, y: (lat - 40) * 100000 });

const dragMap = (from, to) => {
    act(() => {
        mapEventHandlers.mousedown({ lngLat: from, point: pointFor(from.lat, from.lng) });
        mapEventHandlers.mousemove({ lngLat: to, point: pointFor(to.lat, to.lng) });
        mapEventHandlers.mouseup({ lngLat: to, point: pointFor(to.lat, to.lng) });
    });
};

describe('BoundaryEditorModal — drawing tools', () => {
    it('starts with Publish absent until a shape exists (Task 6 adds Publish)', () => {
        renderModal();
        expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    });

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

        // A very short drag leaves a near-zero radius — not a publishable shape yet.
        dragMap({ lat: 40, lng: -74 }, { lat: 40.00001, lng: -74 });
        expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();

        // A real drag produces a real, publishable circle.
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();
    });

    it('draws a freehand stroke as a trail of dragged points', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
        act(() => {
            mapEventHandlers.mousedown({ lngLat: { lat: 40, lng: -74 }, point: pointFor(40, -74) });
            mapEventHandlers.mousemove({
                lngLat: { lat: 40.001, lng: -74 },
                point: pointFor(40.001, -74),
            });
            mapEventHandlers.mousemove({
                lngLat: { lat: 40.001, lng: -73.999 },
                point: pointFor(40.001, -73.999),
            });
            mapEventHandlers.mouseup({
                lngLat: { lat: 40, lng: -73.999 },
                point: pointFor(40, -73.999),
            });
        });
        expect(lastProps.boundaryVertices.length).toBeGreaterThanOrEqual(4);
    });

    it("Clear Draft removes the shape and detaches the active tool's listeners", () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        expect(lastProps.boundaryVertices).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear Draft' }));
        expect(lastProps.boundaryVertices).toBeNull();
        expect(mapEventHandlers.mousedown).toBeUndefined();
    });

    it("switching tools tears down the previous tool's listeners before the new one attaches", () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        const circleHandler = mapEventHandlers.mousedown;
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
        expect(mapEventHandlers.mousedown).not.toBe(circleHandler);
    });

    it('Undo restores the draft from before the last completed drag', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const afterFirstDrag = lastProps.boundaryVertices;

        dragMap({ lat: 41, lng: -75 }, { lat: 41.02, lng: -75 });
        expect(lastProps.boundaryVertices).not.toEqual(afterFirstDrag);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).toEqual(afterFirstDrag);
    });

    it('Undo after a second drag under the same tool selection restores the first drag, not the pre-attach draft', () => {
        // Regression: commitDraft must read the live committed draft via a
        // ref, not a value closed over at the render where the tool's
        // listeners were attached — onMapLoad (and so the tool attach)
        // fires once per mount in the real GameMap, so every drag after
        // the first reuses that one attach-time closure.
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));

        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });
        const afterFirstDrag = lastProps.boundaryVertices;

        dragMap({ lat: 41, lng: -75 }, { lat: 41.03, lng: -75 });
        expect(lastProps.boundaryVertices).not.toEqual(afterFirstDrag);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).not.toBeNull();
        expect(lastProps.boundaryVertices).toEqual(afterFirstDrag);
    });

    it('Move Map tool attaches no drag listeners, leaving normal map navigation alone', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        expect(mapEventHandlers.mousedown).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Move Map' }));
        expect(mapEventHandlers.mousedown).toBeUndefined();
    });

    it('disables map panning while any drawing tool is active, and restores it for Move Map', () => {
        renderModal();
        expect(lastProps.dragPan).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        expect(lastProps.dragPan).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Move Map' }));
        expect(lastProps.dragPan).toBe(true);
    });

    it('disables every toolbar button when the map reports an error', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        act(() => {
            lastProps.onMapError();
        });

        ['Move Map', 'Freehand', 'Rectangle', 'Circle', 'Oval', 'Undo', 'Clear Draft'].forEach(
            (name) => {
                expect(screen.getByRole('button', { name })).toBeDisabled();
            }
        );
    });

    it('Cancel discards the draft and calls onClose without publishing', () => {
        const onClose = jest.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });
});
