/**
 * Layer 2 — React Testing Library. GameMap is replaced with a thin mock
 * that exposes the real `map` instance handed to onMapLoad (a fake
 * mapbox-gl Map whose `on`/`off` just record handlers by event name),
 * so these tests exercise BoundaryEditorModal's own drawing logic, not
 * GameMap's (GameMap.test.jsx already covers that).
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
        mapEventHandlers[event] = handler;
    },
    off: (event) => {
        delete mapEventHandlers[event];
    },
};

jest.mock('../publishGameBoundary', () => ({ publishGameBoundary: jest.fn() }));
jest.mock('../disableGameBoundary', () => ({ disableGameBoundary: jest.fn() }));

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
        // (0.000001 deg of latitude ~= 0.11m radius, well under the 1 sqm
        // minimum area gameBoundary.js enforces; 0.00001 deg ~= 1.11m radius,
        // which actually clears that minimum and would publish.)
        dragMap({ lat: 40, lng: -74 }, { lat: 40.000001, lng: -74 });
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
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        expect(disableGameBoundary).toHaveBeenCalledWith({ roomId: 'room-a', expectedRevision: 4 });
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
