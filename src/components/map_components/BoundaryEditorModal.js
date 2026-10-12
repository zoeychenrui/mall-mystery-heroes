import React, { useRef, useState } from 'react';
import {
    Button,
    HStack,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Text,
} from '@chakra-ui/react';
import { Marker, Source, Layer } from 'react-map-gl';
import GameMap from './GameMap';
import {
    emptyDraft,
    draftFromPublished,
    draftFromFreehand,
    draftFromParameters,
    isDraftPublishable,
} from '../../game/boundaryDraft';
import { publishGameBoundary } from '../publishGameBoundary';
import { disableGameBoundary } from '../disableGameBoundary';
import CreateAlert from '../CreateAlert';

// require(), not a named `import` — gameBoundary.js is CommonJS
// (module.exports) by design, since it's vendored into functions/ for a
// plain Node require() with no build step (see its own header comment).
// A named ES `import` of it isn't statically analyzable the way CRA's
// production webpack build requires, even though Jest's CommonJS-based
// test runner never notices — see boundaryDraft.js's header comment for
// the full story (this hit the exact same wall one import earlier).
const { projectToMeters, offsetPoint, isPointInPolygon } = require('../../game/gameBoundary');

const TOOLS = ['freehand', 'rectangle', 'circle', 'oval'];

// --- box geometry (shared by Rectangle and Oval's handle editing) --------
//
// Rectangle and Oval are both edited as a bounding box with 8 handles (4
// corners + 4 edge-midpoints) — the standard model most drawing tools use
// (PowerPoint, Keynote, Google Drawings' own ellipse tool). They differ
// only in what final shape is rendered inside that box: the box itself
// for Rectangle, an inscribed ellipse for Oval.

const BOX_HANDLE_KEYS = ['sw', 's', 'se', 'e', 'ne', 'n', 'nw', 'w'];
const BOX_CORNER_KEYS = ['sw', 'se', 'nw', 'ne'];

const boxFromCorners = (corners) => {
    const [a, b] = corners;
    return {
        minLat: Math.min(a.lat, b.lat),
        maxLat: Math.max(a.lat, b.lat),
        minLng: Math.min(a.lng, b.lng),
        maxLng: Math.max(a.lng, b.lng),
    };
};

const boxToCorners = (box) => [
    { lat: box.minLat, lng: box.minLng },
    { lat: box.maxLat, lng: box.maxLng },
];

const boxHandlePositions = (box) => {
    const midLat = (box.minLat + box.maxLat) / 2;
    const midLng = (box.minLng + box.maxLng) / 2;
    return {
        sw: { lat: box.minLat, lng: box.minLng },
        se: { lat: box.minLat, lng: box.maxLng },
        nw: { lat: box.maxLat, lng: box.minLng },
        ne: { lat: box.maxLat, lng: box.maxLng },
        s: { lat: box.minLat, lng: midLng },
        n: { lat: box.maxLat, lng: midLng },
        w: { lat: midLat, lng: box.minLng },
        e: { lat: midLat, lng: box.maxLng },
    };
};

// Dragging a corner moves that corner only, keeping the OPPOSITE corner
// fixed — recomputed via boxFromCorners so dragging past the opposite
// corner flips the box the right way instead of going inside-out.
// Dragging a midpoint moves only the one edge it sits on.
const boxFromHandleDrag = (box, key, point) => {
    if (BOX_CORNER_KEYS.includes(key)) {
        const opposite = {
            sw: { lat: box.maxLat, lng: box.maxLng },
            se: { lat: box.maxLat, lng: box.minLng },
            nw: { lat: box.minLat, lng: box.maxLng },
            ne: { lat: box.minLat, lng: box.minLng },
        }[key];
        return boxFromCorners([point, opposite]);
    }
    if (key === 'n')
        return boxFromCorners([
            { lat: point.lat, lng: box.minLng },
            { lat: box.minLat, lng: box.maxLng },
        ]);
    if (key === 's')
        return boxFromCorners([
            { lat: point.lat, lng: box.minLng },
            { lat: box.maxLat, lng: box.maxLng },
        ]);
    if (key === 'e')
        return boxFromCorners([
            { lat: box.minLat, lng: point.lng },
            { lat: box.maxLat, lng: box.minLng },
        ]);
    if (key === 'w')
        return boxFromCorners([
            { lat: box.minLat, lng: point.lng },
            { lat: box.maxLat, lng: box.maxLng },
        ]);
    return box;
};

// Oval's shapeParameters are {center, radiusXMeters, radiusYMeters}, not a
// box — these two convert between that and the same box the handle UI
// shares with Rectangle.
const boxFromOvalParams = (center, radiusXMeters, radiusYMeters) => {
    const east = offsetPoint(center, radiusXMeters, 0);
    const west = offsetPoint(center, -radiusXMeters, 0);
    const north = offsetPoint(center, 0, radiusYMeters);
    const south = offsetPoint(center, 0, -radiusYMeters);
    return { minLat: south.lat, maxLat: north.lat, minLng: west.lng, maxLng: east.lng };
};

const ovalParamsFromBox = (box) => {
    const center = { lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 };
    const east = projectToMeters({ lat: center.lat, lng: box.maxLng }, center);
    const north = projectToMeters({ lat: box.maxLat, lng: center.lng }, center);
    return { center, radiusXMeters: Math.abs(east.x), radiusYMeters: Math.abs(north.y) };
};

// --- per-shape-type creation, move, and handle logic ----------------------

const draftForCreateStart = (tool, point) => {
    if (tool === 'rectangle') return draftFromParameters('rectangle', { corners: [point, point] });
    if (tool === 'circle') return draftFromParameters('circle', { center: point, radiusMeters: 0 });
    if (tool === 'oval') {
        return draftFromParameters('oval', { center: point, radiusXMeters: 0, radiusYMeters: 0 });
    }
    return emptyDraft();
};

const draftForCreateUpdate = (tool, start, current) => {
    if (tool === 'rectangle')
        return draftFromParameters('rectangle', { corners: [start, current] });
    if (tool === 'circle') {
        const { x, y } = projectToMeters(current, start);
        return draftFromParameters('circle', { center: start, radiusMeters: Math.hypot(x, y) });
    }
    if (tool === 'oval') {
        const { x, y } = projectToMeters(current, start);
        return draftFromParameters('oval', {
            center: start,
            radiusXMeters: Math.abs(x),
            radiusYMeters: Math.abs(y),
        });
    }
    return emptyDraft();
};

// Moving a shape translates its defining parameters by the same lat/lng
// delta, keeping its size exactly the same.
const translateDraft = (draft, deltaLat, deltaLng) => {
    const { shapeType, shapeParameters, vertices } = draft;
    const shiftPoint = (p) => ({ lat: p.lat + deltaLat, lng: p.lng + deltaLng });
    if (shapeType === 'rectangle') {
        return draftFromParameters('rectangle', {
            corners: shapeParameters.corners.map(shiftPoint),
        });
    }
    if (shapeType === 'circle') {
        return draftFromParameters('circle', {
            center: shiftPoint(shapeParameters.center),
            radiusMeters: shapeParameters.radiusMeters,
        });
    }
    if (shapeType === 'oval') {
        return draftFromParameters('oval', {
            center: shiftPoint(shapeParameters.center),
            radiusXMeters: shapeParameters.radiusXMeters,
            radiusYMeters: shapeParameters.radiusYMeters,
        });
    }
    if (shapeType === 'freehand') {
        return draftFromFreehand(vertices.map(shiftPoint));
    }
    return draft;
};

// A freehand vertex and its closing duplicate (vertices[0] === the last
// entry) move together — dragging the first point's handle must also
// move the ring's closing point, or the ring would no longer close.
const verticesFromVertexDrag = (vertices, index, point) => {
    const next = vertices.map((p, i) => (i === index ? point : p));
    if (index === 0) next[next.length - 1] = point;
    return next;
};

// A plain open line connecting the in-progress freehand points, so the
// moderator sees the stroke take shape point by point instead of just a
// scatter of dots until Finish closes it. Also doubles as the rotation
// handle's stem line below.
const freehandLineGeoJson = (points) => ({
    type: 'Feature',
    geometry: {
        type: 'LineString',
        coordinates: points.map((point) => [point.lng, point.lat]),
    },
    properties: {},
});

// --- rotation ---------------------------------------------------------
//
// Rectangle and Oval have no rotation concept anywhere in this app's
// shape math (their shapeParameters are axis-aligned corners, or a
// center + radii — the server independently recomputes a shape from its
// stored parameters and rejects anything that doesn't match, so there
// is nowhere to persist "and also rotated N degrees" without extending
// that shared, already-shipped geometry). Rotating converts the shape
// to Freehand instead: the rotated vertices themselves need no new
// parameter at all, since Freehand's shapeParameters is always null —
// it becomes editable with per-vertex handles afterward, the same as
// any other Freehand shape. Circle gets no rotation handle; rotating a
// circle is visually a no-op.

// `vertices` is always a closed ring (first point repeated as the
// last) — averaging it as-is would double-weight that one point,
// biasing the centroid toward it instead of landing on the shape's
// true geometric center, so the closing duplicate is dropped first.
const centroidOf = (vertices) => {
    const distinct = vertices.slice(0, -1);
    return {
        lat: distinct.reduce((sum, v) => sum + v.lat, 0) / distinct.length,
        lng: distinct.reduce((sum, v) => sum + v.lng, 0) / distinct.length,
    };
};

// Compass bearing in radians from `center` to `point`: 0 = north,
// increasing clockwise (so east is +PI/2) — matches how a moderator
// naturally reads "drag the handle around."
const bearingFromCenter = (point, center) => {
    const { x, y } = projectToMeters(point, center);
    return Math.atan2(x, y);
};

const rotatePointAround = (point, center, deltaRadians) => {
    const { x, y } = projectToMeters(point, center);
    const cos = Math.cos(deltaRadians);
    const sin = Math.sin(deltaRadians);
    return offsetPoint(center, x * cos + y * sin, -x * sin + y * cos);
};

// Floats a fixed distance beyond the shape's own edge, in the same
// direction from center as `reference` (one of the shape's real
// vertices) — so the handle rotates together with the shape as
// `reference` moves, with no separate angle tracked anywhere.
const ROTATION_HANDLE_OFFSET_METERS = 30;

const rotationHandlePosition = (reference, center) => {
    const { x, y } = projectToMeters(reference, center);
    const distance = Math.hypot(x, y) || 1;
    const scale = (distance + ROTATION_HANDLE_OFFSET_METERS) / distance;
    return offsetPoint(center, x * scale, y * scale);
};

// Null for Circle (no rotation handle) or when there is nothing to
// rotate yet.
const rotationHandleFor = (draft, { onLiveUpdate, onCommit }) => {
    if (!draft.vertices || draft.shapeType === 'circle') return null;
    const center = centroidOf(draft.vertices);
    const reference = draft.vertices[0];
    const startBearing = bearingFromCenter(reference, center);
    const handlePosition = rotationHandlePosition(reference, center);

    const rotatedTo = (point) => {
        const delta = bearingFromCenter(point, center) - startBearing;
        return draft.vertices.map((v) => rotatePointAround(v, center, delta));
    };

    return {
        ...handlePosition,
        stemFrom: reference,
        onDrag: (point) => onLiveUpdate(draftFromFreehand(rotatedTo(point))),
        onDragEnd: (point) => onCommit(draftFromFreehand(rotatedTo(point))),
    };
};

const handlesForDraft = (draft, { onLiveUpdate, onCommit }) => {
    if (!draft.vertices) return [];
    // Rectangle/circle/oval all need shapeParameters to compute handle
    // positions from; a shape without them (an incomplete fixture, or a
    // legitimately bare {vertices} the modal was handed) has nothing to
    // derive handles from — render none rather than crash. Freehand never
    // has shapeParameters at all (by design, see boundaryDraft.js), so
    // it's excluded from this guard.
    if (draft.shapeType !== 'freehand' && !draft.shapeParameters) return [];

    if (draft.shapeType === 'rectangle') {
        const box = boxFromCorners(draft.shapeParameters.corners);
        const positions = boxHandlePositions(box);
        return BOX_HANDLE_KEYS.map((key) => ({
            key,
            ...positions[key],
            onDrag: (point) =>
                onLiveUpdate(
                    draftFromParameters('rectangle', {
                        corners: boxToCorners(boxFromHandleDrag(box, key, point)),
                    })
                ),
            onDragEnd: (point) =>
                onCommit(
                    draftFromParameters('rectangle', {
                        corners: boxToCorners(boxFromHandleDrag(box, key, point)),
                    })
                ),
        }));
    }

    if (draft.shapeType === 'oval') {
        const { center, radiusXMeters, radiusYMeters } = draft.shapeParameters;
        const box = boxFromOvalParams(center, radiusXMeters, radiusYMeters);
        const positions = boxHandlePositions(box);
        return BOX_HANDLE_KEYS.map((key) => ({
            key,
            ...positions[key],
            onDrag: (point) =>
                onLiveUpdate(
                    draftFromParameters(
                        'oval',
                        ovalParamsFromBox(boxFromHandleDrag(box, key, point))
                    )
                ),
            onDragEnd: (point) =>
                onCommit(
                    draftFromParameters(
                        'oval',
                        ovalParamsFromBox(boxFromHandleDrag(box, key, point))
                    )
                ),
        }));
    }

    if (draft.shapeType === 'circle') {
        const { center, radiusMeters } = draft.shapeParameters;
        const positions = {
            e: offsetPoint(center, radiusMeters, 0),
            w: offsetPoint(center, -radiusMeters, 0),
            n: offsetPoint(center, 0, radiusMeters),
            s: offsetPoint(center, 0, -radiusMeters),
        };
        const radiusTo = (point) => {
            const { x, y } = projectToMeters(point, center);
            return Math.hypot(x, y);
        };
        return ['e', 'w', 'n', 's'].map((key) => ({
            key,
            ...positions[key],
            onDrag: (point) =>
                onLiveUpdate(
                    draftFromParameters('circle', { center, radiusMeters: radiusTo(point) })
                ),
            onDragEnd: (point) =>
                onCommit(draftFromParameters('circle', { center, radiusMeters: radiusTo(point) })),
        }));
    }

    if (draft.shapeType === 'freehand') {
        // The last vertex is the closing duplicate of the first — it gets
        // no handle of its own, since dragging vertex 0's handle already
        // moves it too (see verticesFromVertexDrag).
        return draft.vertices.slice(0, -1).map((point, index) => ({
            key: `vertex-${index}`,
            ...point,
            onDrag: (next) =>
                onLiveUpdate(
                    draftFromFreehand(verticesFromVertexDrag(draft.vertices, index, next))
                ),
            onDragEnd: (next) =>
                onCommit(draftFromFreehand(verticesFromVertexDrag(draft.vertices, index, next))),
        }));
    }

    return [];
};

/**
 * Local drawing surface for the room's game-area boundary, Google
 * Drawings-style: the map is always pannable. Selecting a tool (Freehand,
 * Rectangle, Circle, Oval) arms it for one new shape, drawn by dragging a
 * bounding box (Rectangle/Oval) or a center-to-edge radius (Circle), or by
 * clicking a series of points finished with the Finish button (Freehand).
 * Finishing a one-shot tool disarms it automatically. With no tool armed,
 * clicking and dragging anywhere inside the current shape moves it, and
 * its corner/edge/vertex handles resize or reshape it — no separate "Move
 * Map" mode needed, since the base map stays pannable the whole time
 * (dragging claims the gesture away from panning only when it starts on
 * the shape itself or its handles; see attachPersistentGestures below).
 */
const BoundaryEditorModal = ({ isOpen, onClose, currentBoundary, roomID }) => {
    const createAlert = CreateAlert();
    const [draft, setDraft] = useState(() => draftFromPublished(currentBoundary));
    // Tracks the last *committed* draft outside of React's render cycle —
    // read by the persistent gesture handlers below, which are attached
    // once per map load and so can never rely on a value closed over at
    // attach time (see commitDraft's own comment for the full story,
    // first worked out for the old per-tool-drag design and still true
    // here now that there is only one, longer-lived attachment).
    const draftRef = useRef(draft);
    const [history, setHistory] = useState([]);
    const [activeTool, setActiveTool] = useState(null);
    const activeToolRef = useRef(null);
    const [freehandPoints, setFreehandPoints] = useState([]);
    const freehandPointsRef = useRef([]);
    // GameMap already renders its own full-screen "Map failed to load" /
    // Retry UI internally on error (see GameMap.js), but this modal still
    // needs to know about it: there is nothing to draw on, so every
    // toolbar button (including Undo and Clear Draft) is disabled while
    // an error is active, and Publish is gated on it too.
    const [mapError, setMapError] = useState(false);
    const mapRef = useRef(null);
    const detachPersistentRef = useRef(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isDisabling, setIsDisabling] = useState(false);
    const [conflictMessage, setConflictMessage] = useState(null);
    // Captured once per open, not read live from `currentBoundary` on
    // every render — see the reopen effect below for why.
    const [expectedRevision, setExpectedRevision] = useState(() => currentBoundary?.revision ?? 0);
    // Tracks the isOpen value as of the last time this effect ran, so the
    // effect can tell "just opened" (false -> true) apart from "already
    // open and some unrelated prop changed." Lobby/GameMasterView hand
    // `currentBoundary` down from a live room-doc subscription that fires
    // on ANY write to the room (a player joining, a chat message, not
    // just a boundary change), so `currentBoundary` gets a new object
    // identity constantly while the editor sits open — resetting on every
    // such identity change would wipe an in-progress draft and any shown
    // conflict message out from under the moderator mid-edit.
    const wasOpenRef = useRef(isOpen);

    const resetToolState = () => {
        setActiveTool(null);
        activeToolRef.current = null;
        setFreehandPoints([]);
        freehandPointsRef.current = [];
    };

    // Reopening always starts from the latest published state, never a
    // previously abandoned draft — but only on the actual false -> true
    // open transition, never while already open (see wasOpenRef comment).
    React.useEffect(() => {
        const justOpened = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (justOpened) {
            const reopened = draftFromPublished(currentBoundary);
            setDraft(reopened);
            draftRef.current = reopened;
            setHistory([]);
            resetToolState();
            setMapError(false);
            setConflictMessage(null);
            setExpectedRevision(currentBoundary?.revision ?? 0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, currentBoundary]);

    const commitDraft = (nextDraft) => {
        // Snapshot the previous committed draft into a local *before*
        // mutating draftRef below — setHistory's updater function isn't
        // invoked synchronously here, it's deferred until React processes
        // the batched update, which happens after this function body has
        // already run. Reading `draftRef.current` lazily from inside the
        // updater would then see the mutation on the next line, pushing
        // nextDraft onto history instead of the value before it.
        const previousCommitted = draftRef.current;
        setHistory((prev) => [...prev, previousCommitted]);
        setDraft(nextDraft);
        draftRef.current = nextDraft;
    };

    const handleUndo = () => {
        if (history.length === 0) return;
        const restored = history[history.length - 1];
        setHistory((prev) => prev.slice(0, -1));
        setDraft(restored);
        draftRef.current = restored;
    };

    const handleClearDraft = () => {
        resetToolState();
        commitDraft(emptyDraft());
    };

    // --- persistent map interaction (attached once per map load) --------

    const attachPersistentGestures = (map) => {
        if (detachPersistentRef.current) {
            detachPersistentRef.current();
        }
        // Plain variables, not refs — this whole function is itself only
        // ever invoked once per real map load, so these live exactly as
        // long as the listeners below do, mutated across many gestures
        // over that one lifetime. (Reusing this pattern from the old
        // per-tool attachDragTool, which worked the same way.)
        let gestureMode = null; // 'create' | 'move' | null
        let createTool = null;
        let createStart = null;
        let moveStart = null; // { lat, lng, draft } snapshot at gesture start

        const toPoint = (lngLat) => ({ lat: lngLat.lat, lng: lngLat.lng });

        const handleDown = (event) => {
            const tool = activeToolRef.current;
            if (tool === 'freehand') {
                // Freehand places points on click, not drag — handled in
                // handleClick below. Still claim the gesture so an
                // imprecise tap can never nudge the map underneath.
                event.preventDefault();
                return;
            }
            if (tool) {
                event.preventDefault();
                gestureMode = 'create';
                createTool = tool;
                createStart = toPoint(event.lngLat);
                setDraft(draftForCreateStart(tool, createStart));
                return;
            }
            const current = draftRef.current;
            if (current.vertices && isPointInPolygon(toPoint(event.lngLat), current.vertices)) {
                event.preventDefault();
                gestureMode = 'move';
                moveStart = { ...toPoint(event.lngLat), draft: current };
            }
        };

        const handleMove = (event) => {
            if (gestureMode === 'create') {
                setDraft(draftForCreateUpdate(createTool, createStart, toPoint(event.lngLat)));
            } else if (gestureMode === 'move') {
                const point = toPoint(event.lngLat);
                setDraft(
                    translateDraft(
                        moveStart.draft,
                        point.lat - moveStart.lat,
                        point.lng - moveStart.lng
                    )
                );
            }
        };

        const handleUp = (event) => {
            if (gestureMode === 'create') {
                commitDraft(draftForCreateUpdate(createTool, createStart, toPoint(event.lngLat)));
                setActiveTool(null);
                activeToolRef.current = null;
            } else if (gestureMode === 'move') {
                const point = toPoint(event.lngLat);
                commitDraft(
                    translateDraft(
                        moveStart.draft,
                        point.lat - moveStart.lat,
                        point.lng - moveStart.lng
                    )
                );
            }
            gestureMode = null;
            createTool = null;
            createStart = null;
            moveStart = null;
        };

        const handleClick = (event) => {
            if (activeToolRef.current !== 'freehand') return;
            const nextPoints = [...freehandPointsRef.current, toPoint(event.lngLat)];
            freehandPointsRef.current = nextPoints;
            setFreehandPoints(nextPoints);
        };

        map.on('mousedown', handleDown);
        map.on('mousemove', handleMove);
        map.on('mouseup', handleUp);
        map.on('click', handleClick);
        detachPersistentRef.current = () => {
            map.off('mousedown', handleDown);
            map.off('mousemove', handleMove);
            map.off('mouseup', handleUp);
            map.off('click', handleClick);
        };
    };

    React.useEffect(() => {
        return () => {
            if (detachPersistentRef.current) detachPersistentRef.current();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleToolChange = (tool) => {
        // Clicking the already-armed tool disarms it, letting the
        // moderator back out of a tool without drawing anything.
        const next = activeTool === tool ? null : tool;
        setActiveTool(next);
        activeToolRef.current = next;
        setFreehandPoints([]);
        freehandPointsRef.current = [];
    };

    const handleFinishFreehand = () => {
        const points = freehandPointsRef.current;
        if (points.length < 3) return;
        commitDraft(draftFromFreehand(points));
        resetToolState();
    };

    const handleMapLoad = (map) => {
        mapRef.current = map;
        // A successful (re)load — including GameMap's own Retry, which
        // re-fires this same callback — means there is a map to draw on
        // again, even if a previous load had failed.
        setMapError(false);
        attachPersistentGestures(map);
    };

    const handleCancel = () => {
        onClose();
    };

    // Shared by handlePublish/handleDisable: a revision conflict gets a
    // moderator-facing explanation instead of the raw callable error
    // code ('revision_conflict').
    const describeBoundaryError = (error) =>
        error.message === 'revision_conflict'
            ? 'Someone else published a change to this game area. Close and reopen to see the current one before trying again.'
            : error.message;

    const handlePublish = async () => {
        setConflictMessage(null);
        setIsPublishing(true);
        try {
            await publishGameBoundary({
                roomId: roomID,
                expectedRevision,
                shapeType: draft.shapeType,
                vertices: draft.vertices,
                shapeParameters: draft.shapeParameters,
            });
            createAlert(
                'success',
                currentBoundary ? 'Boundary updated.' : 'Boundary published.',
                '',
                1500
            );
            onClose();
        } catch (error) {
            setConflictMessage(describeBoundaryError(error));
        } finally {
            setIsPublishing(false);
        }
    };

    const handleDisable = async () => {
        setIsDisabling(true);
        try {
            await disableGameBoundary({ roomId: roomID, expectedRevision });
            createAlert('success', 'Boundary disabled.', '', 1500);
            onClose();
        } catch (error) {
            setConflictMessage(describeBoundaryError(error));
        } finally {
            setIsDisabling(false);
        }
    };

    const handles =
        activeTool === null
            ? handlesForDraft(draft, { onLiveUpdate: setDraft, onCommit: commitDraft })
            : [];
    const rotationHandle =
        activeTool === null
            ? rotationHandleFor(draft, { onLiveUpdate: setDraft, onCommit: commitDraft })
            : null;

    return (
        <Modal isOpen={isOpen} onClose={handleCancel} size={{ base: 'full', md: '6xl' }}>
            <ModalOverlay />
            <ModalContent bg="#202030" h={{ base: '100%', md: '85vh' }}>
                <ModalHeader color="#ffffff">Game Area</ModalHeader>
                <ModalBody display="flex" flexDirection="column" gap="8px">
                    <HStack wrap="wrap">
                        {TOOLS.map((tool) => (
                            <Button
                                key={tool}
                                size="sm"
                                colorScheme={activeTool === tool ? 'teal' : 'gray'}
                                onClick={() => handleToolChange(tool)}
                                isDisabled={mapError}
                            >
                                {tool.charAt(0).toUpperCase() + tool.slice(1)}
                            </Button>
                        ))}
                        {activeTool === 'freehand' && freehandPoints.length >= 3 && (
                            <Button size="sm" colorScheme="teal" onClick={handleFinishFreehand}>
                                Finish
                            </Button>
                        )}
                        <Button
                            size="sm"
                            onClick={handleUndo}
                            isDisabled={history.length === 0 || mapError}
                        >
                            Undo
                        </Button>
                        <Button size="sm" onClick={handleClearDraft} isDisabled={mapError}>
                            Clear Draft
                        </Button>
                        {isDraftPublishable(draft) && !mapError && (
                            <Button
                                colorScheme="teal"
                                isLoading={isPublishing}
                                onClick={handlePublish}
                            >
                                {currentBoundary ? 'Publish Changes' : 'Publish Boundary'}
                            </Button>
                        )}
                    </HStack>
                    {conflictMessage && (
                        <Text color="red.300" fontSize="sm">
                            {conflictMessage}
                        </Text>
                    )}
                    {!draft.validation.ok && draft.vertices && (
                        <Text color="orange.300" fontSize="sm">
                            {draft.validation.reason}
                        </Text>
                    )}
                    <GameMap
                        boundaryVertices={draft.vertices}
                        fitTo={null}
                        onMapLoad={handleMapLoad}
                        onMapError={() => setMapError(true)}
                    >
                        {handles.map((handle) => (
                            <Marker
                                key={handle.key}
                                longitude={handle.lng}
                                latitude={handle.lat}
                                draggable
                                onDrag={(e) =>
                                    handle.onDrag({ lat: e.lngLat.lat, lng: e.lngLat.lng })
                                }
                                onDragEnd={(e) =>
                                    handle.onDragEnd({ lat: e.lngLat.lat, lng: e.lngLat.lng })
                                }
                            >
                                <div
                                    data-testid={`handle-${handle.key}`}
                                    style={{
                                        width: '14px',
                                        height: '14px',
                                        borderRadius: '50%',
                                        background: 'white',
                                        border: '2px solid teal',
                                        cursor: 'pointer',
                                    }}
                                />
                            </Marker>
                        ))}
                        {rotationHandle && (
                            <Source
                                id="rotation-stem"
                                type="geojson"
                                data={freehandLineGeoJson([
                                    rotationHandle.stemFrom,
                                    rotationHandle,
                                ])}
                            >
                                <Layer
                                    id="rotation-stem-line"
                                    type="line"
                                    paint={{ 'line-color': 'green', 'line-width': 1 }}
                                />
                            </Source>
                        )}
                        {rotationHandle && (
                            <Marker
                                longitude={rotationHandle.lng}
                                latitude={rotationHandle.lat}
                                draggable
                                onDrag={(e) =>
                                    rotationHandle.onDrag({ lat: e.lngLat.lat, lng: e.lngLat.lng })
                                }
                                onDragEnd={(e) =>
                                    rotationHandle.onDragEnd({
                                        lat: e.lngLat.lat,
                                        lng: e.lngLat.lng,
                                    })
                                }
                            >
                                <div
                                    data-testid="handle-rotate"
                                    style={{
                                        width: '14px',
                                        height: '14px',
                                        borderRadius: '50%',
                                        background: 'white',
                                        border: '2px solid green',
                                        cursor: 'grab',
                                    }}
                                />
                            </Marker>
                        )}
                        {activeTool === 'freehand' && freehandPoints.length >= 2 && (
                            <Source
                                id="freehand-in-progress"
                                type="geojson"
                                data={freehandLineGeoJson(freehandPoints)}
                            >
                                <Layer
                                    id="freehand-in-progress-line"
                                    type="line"
                                    paint={{ 'line-color': 'orange', 'line-width': 2 }}
                                />
                            </Source>
                        )}
                        {activeTool === 'freehand' &&
                            freehandPoints.map((point, index) => (
                                <Marker
                                    key={`in-progress-${index}`}
                                    longitude={point.lng}
                                    latitude={point.lat}
                                >
                                    <div
                                        data-testid="freehand-point"
                                        style={{
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            background: 'orange',
                                        }}
                                    />
                                </Marker>
                            ))}
                    </GameMap>
                </ModalBody>
                <ModalFooter>
                    {currentBoundary?.enabled && (
                        <Button
                            colorScheme="red"
                            isLoading={isDisabling}
                            onClick={handleDisable}
                            mr="8px"
                        >
                            Disable Boundary
                        </Button>
                    )}
                    <Button onClick={handleCancel}>Cancel</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default BoundaryEditorModal;
