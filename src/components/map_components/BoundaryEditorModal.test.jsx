/**
 * Layer 2 — React Testing Library. GameMap is replaced with a thin mock
 * that exposes the real `map` instance handed to onMapLoad (a fake
 * mapbox-gl Map), so these tests exercise BoundaryEditorModal's own
 * drawing logic, not GameMap's (GameMap.test.jsx already covers that).
 *
 * `fakeMap.on`/`off` deliberately mirror real mapbox-gl's Evented
 * semantics (node_modules/mapbox-gl/dist/mapbox-gl-dev.js): each event
 * type holds an array of listeners in registration order, and `off`
 * only removes a listener matched by reference — `off(type)` with no
 * handler removes nothing. An earlier version of this mock instead kept
 * a single handler per event name, so a later `on()` call for the same
 * event silently overwrote the key; that hid a real production bug
 * (F1: BoundaryEditorModal called `map.off(event)` with no handler,
 * which is a no-op against a real map, so switching drawing tools never
 * actually detached the previous tool's listeners) because the mock's
 * "overwrite" happened to look the same as a real "remove" from the
 * test's point of view.
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
        mapEventHandlers[event] = mapEventHandlers[event].filter((registered) => {
            return registered !== handler;
        });
    },
};
// Fires every handler currently registered for `event`, in registration
// order — exactly like the real map's `fire()`, including the fact that
// a leaked (never-detached) old handler fires right alongside the
// current one.
const triggerMapEvent = (event, payload) => {
    (mapEventHandlers[event] || []).forEach((handler) => handler(payload));
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
        triggerMapEvent('mousedown', { lngLat: from, point: pointFor(from.lat, from.lng) });
        triggerMapEvent('mousemove', { lngLat: to, point: pointFor(to.lat, to.lng) });
        triggerMapEvent('mouseup', { lngLat: to, point: pointFor(to.lat, to.lng) });
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
            triggerMapEvent('mousedown', {
                lngLat: { lat: 40, lng: -74 },
                point: pointFor(40, -74),
            });
            triggerMapEvent('mousemove', {
                lngLat: { lat: 40.001, lng: -74 },
                point: pointFor(40.001, -74),
            });
            triggerMapEvent('mousemove', {
                lngLat: { lat: 40.001, lng: -73.999 },
                point: pointFor(40.001, -73.999),
            });
            triggerMapEvent('mouseup', {
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
        expect(mapEventHandlers.mousedown).toHaveLength(0);
    });

    it("switching tools tears down the previous tool's listeners before the new one attaches", () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        const [circleMouseDown] = mapEventHandlers.mousedown;

        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));

        // The real regression (F1): a mock that only overwrote a
        // same-named key would show a "new" handler here even if the
        // real map.off(event) (no handler arg) had silently done
        // nothing — so this checks the old handler's *reference* is
        // actually gone, not just that something else is present now.
        expect(mapEventHandlers.mousedown).not.toContain(circleMouseDown);
        expect(mapEventHandlers.mousedown).toHaveLength(1);
    });

    it("a stale tool's listeners genuinely stop firing after switching tools (not just get shadowed)", () => {
        // Regression for F1: BoundaryEditorModal used to call
        // `map.off(event)` with no handler to detach a tool, which is a
        // no-op against mapbox-gl's real Evented.off — every previous
        // tool's listeners stayed attached and kept firing. Undo is the
        // observable symptom: with the leak, the stale Circle handler's
        // own onEnd also calls commitDraft on this same drag, pushing an
        // extra, unwanted history entry — so a single Undo lands on that
        // leftover Circle commit instead of the actual pre-drag (empty)
        // draft, and a second Undo would be needed to get back to it.
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
        fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));

        dragMap({ lat: 40, lng: -74 }, { lat: 40.01, lng: -73.99 });
        expect(lastProps.boundaryVertices).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(lastProps.boundaryVertices).toBeNull();
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
        expect(mapEventHandlers.mousedown).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Move Map' }));
        expect(mapEventHandlers.mousedown).toHaveLength(0);
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

    it('re-enables the toolbar once the map reloads after a successful Retry (F3)', () => {
        renderModal();
        act(() => {
            lastProps.onMapError();
        });
        expect(screen.getByRole('button', { name: 'Circle' })).toBeDisabled();

        // Simulates GameMap's own Retry succeeding: the map reloads and
        // fires onMapLoad again (mapError must clear, or the toolbar
        // stays stuck disabled forever after any one failed load).
        act(() => {
            lastProps.onMapLoad(fakeMap);
        });
        expect(screen.getByRole('button', { name: 'Circle' })).toBeEnabled();
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

    it('a revision conflict on Disable shows the friendly conflict message, not the raw error code (F6)', async () => {
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

    it('a currentBoundary prop update while already open does not reset an in-progress draft (F2)', () => {
        // Lobby/GameMasterView hand currentBoundary down from a live
        // room-doc subscription that re-fires (with a brand-new object
        // identity) on ANY write to the room — a player joining, a chat
        // message — not just an actual boundary change. isOpen never
        // changes here; only currentBoundary's identity does, same as
        // that live subscription would produce while the editor is open.
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
