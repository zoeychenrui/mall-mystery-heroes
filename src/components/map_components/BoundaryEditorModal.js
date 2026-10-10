import React, { useEffect, useRef, useState } from 'react';
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
const { projectToMeters } = require('../../game/gameBoundary');

const TOOLS = ['move', 'freehand', 'rectangle', 'circle', 'oval'];

// Minimum pixel movement between accepted mousemove samples, so a fast
// drag doesn't flood the draft with near-duplicate points (freehand) or
// near-identical radius recomputations (circle/oval/rectangle).
const MIN_DRAG_PIXEL_DISTANCE = 6;

/**
 * Attaches one drag gesture (mousedown -> decimated mousemove* ->
 * mouseup) to the map, shared by all four drawing tools — each tool
 * only supplies what a start/move/end lngLat means for its own shape.
 *
 * Returns a detach function that removes exactly these three listeners
 * by reference. mapbox-gl's real `Map.off(type)` called with no handler
 * argument searches for an `undefined` handler and removes nothing — so
 * the caller MUST keep and later call this returned function (by
 * reference) rather than trying to blind-`off()` the event type, or the
 * listeners leak onto the map and keep firing after the tool switches
 * (worse, GameMap mounts with `reuseMaps`, so the same underlying map
 * instance — and so the leaked listeners — can outlive this component).
 */
const attachDragTool = (map, { onStart, onMove, onEnd }) => {
    let isDragging = false;
    let lastPoint = null;
    const handleDown = (event) => {
        isDragging = true;
        lastPoint = event.point;
        onStart(event.lngLat);
    };
    const handleMove = (event) => {
        if (!isDragging) return;
        if (
            lastPoint &&
            Math.hypot(event.point.x - lastPoint.x, event.point.y - lastPoint.y) <
                MIN_DRAG_PIXEL_DISTANCE
        ) {
            return;
        }
        lastPoint = event.point;
        onMove(event.lngLat);
    };
    const handleUp = (event) => {
        if (!isDragging) return;
        isDragging = false;
        onEnd(event.lngLat);
    };
    map.on('mousedown', handleDown);
    map.on('mousemove', handleMove);
    map.on('mouseup', handleUp);
    return () => {
        map.off('mousedown', handleDown);
        map.off('mousemove', handleMove);
        map.off('mouseup', handleUp);
    };
};

/**
 * Local drawing surface for the room's game-area boundary. Draws with
 * four tools against GameMap's boundary overlay, keeps an undo history
 * of drafts, and lets the moderator Clear Draft, Cancel, Publish the
 * draft (host-only, revision-checked), or Disable the current boundary.
 */
const BoundaryEditorModal = ({ isOpen, onClose, currentBoundary, roomID }) => {
    const createAlert = CreateAlert();
    const [draft, setDraft] = useState(() => draftFromPublished(currentBoundary));
    // Tracks the last *committed* draft outside of React's render cycle.
    // onMapLoad (and so each tool's attach) fires once per mount in the
    // real GameMap, so every drag after the first reuses that one
    // attach-time closure — commitDraft must read the live committed
    // value through this ref rather than close over `draft` from the
    // render where the listeners were attached, or every drag after the
    // first pushes that stale, pre-attach draft onto history instead of
    // the previous drag's result. Updated only inside commitDraft itself
    // (and on reopen) — never from in-progress onStart/onMove previews,
    // which must not count as "committed" for Undo purposes.
    const draftRef = useRef(draft);
    const [history, setHistory] = useState([]);
    const [activeTool, setActiveTool] = useState('move');
    // GameMap already renders its own full-screen "Map failed to load" /
    // Retry UI internally on error (see GameMap.js), but this modal still
    // needs to know about it: there is nothing to draw on, so every
    // toolbar button (including Undo and Clear Draft) is disabled while
    // an error is active. Task 6 also reads this to gate Publish.
    const [mapError, setMapError] = useState(false);
    const mapRef = useRef(null);
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

    // Reopening always starts from the latest published state, never a
    // previously abandoned draft (Review Focus: reopen fidelity) — but
    // only on the actual false -> true open transition, never while
    // already open (see wasOpenRef comment above).
    useEffect(() => {
        const justOpened = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (justOpened) {
            const reopened = draftFromPublished(currentBoundary);
            setDraft(reopened);
            draftRef.current = reopened;
            setHistory([]);
            setActiveTool('move');
            setMapError(false);
            setConflictMessage(null);
            setExpectedRevision(currentBoundary?.revision ?? 0);
        }
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
        // Reads `history` directly rather than nesting setDraft inside the
        // setHistory updater — an updater function may be re-invoked by
        // React when reconciling queued state, and calling another
        // setState as a side effect from inside it is unreliable. `history`
        // itself is safe to read fresh here: handleUndo is rebound to the
        // button's onClick on every render, so the handler that actually
        // runs always closes over the latest render's `history`.
        if (history.length === 0) return;
        const restored = history[history.length - 1];
        setHistory((prev) => prev.slice(0, -1));
        setDraft(restored);
        // Keep draftRef in sync with what Undo just restored, so a drag
        // started right after this Undo (before any further commit)
        // treats the restored draft — not the stale pre-Undo value — as
        // the "last committed" state.
        draftRef.current = restored;
    };

    // Also detaches the active tool's listeners and resets to Move Map,
    // so the toolbar never shows a tool "active" with no listeners
    // attached behind it (a real gap in the original brief: the test
    // "Clear Draft ... detaches the active tool's listeners" fails
    // without this — commitDraft alone never touches the map listeners).
    const handleClearDraft = () => {
        detachToolListeners();
        setActiveTool('move');
        commitDraft(emptyDraft());
    };

    // --- tool-specific drag interaction -------------------------------

    // Holds the detach function for whichever tool is currently attached
    // (null for Move Map, which attaches nothing). Reference-based, not
    // keyed by event type — see attachDragTool's comment.
    const detachCurrentToolRef = useRef(null);

    const detachToolListeners = () => {
        if (detachCurrentToolRef.current) {
            detachCurrentToolRef.current();
            detachCurrentToolRef.current = null;
        }
    };

    const attachRectangleTool = (map) => {
        let cornerA = null;
        return attachDragTool(map, {
            onStart: (lngLat) => {
                cornerA = lngLat;
                setDraft(draftFromParameters('rectangle', { corners: [cornerA, lngLat] }));
            },
            onMove: (lngLat) => {
                setDraft(draftFromParameters('rectangle', { corners: [cornerA, lngLat] }));
            },
            onEnd: (lngLat) => {
                commitDraft(draftFromParameters('rectangle', { corners: [cornerA, lngLat] }));
            },
        });
    };

    const attachCircleTool = (map) => {
        let center = null;
        const radiusMetersTo = (lngLat) => {
            const { x, y } = projectToMeters(lngLat, center);
            return Math.hypot(x, y);
        };
        return attachDragTool(map, {
            onStart: (lngLat) => {
                center = lngLat;
                setDraft(draftFromParameters('circle', { center, radiusMeters: 0 }));
            },
            onMove: (lngLat) => {
                setDraft(
                    draftFromParameters('circle', { center, radiusMeters: radiusMetersTo(lngLat) })
                );
            },
            onEnd: (lngLat) => {
                commitDraft(
                    draftFromParameters('circle', { center, radiusMeters: radiusMetersTo(lngLat) })
                );
            },
        });
    };

    const attachOvalTool = (map) => {
        let center = null;
        const radiiMetersTo = (lngLat) => {
            const { x, y } = projectToMeters(lngLat, center);
            return { radiusXMeters: Math.abs(x), radiusYMeters: Math.abs(y) };
        };
        return attachDragTool(map, {
            onStart: (lngLat) => {
                center = lngLat;
                setDraft(
                    draftFromParameters('oval', { center, radiusXMeters: 0, radiusYMeters: 0 })
                );
            },
            onMove: (lngLat) => {
                setDraft(draftFromParameters('oval', { center, ...radiiMetersTo(lngLat) }));
            },
            onEnd: (lngLat) => {
                commitDraft(draftFromParameters('oval', { center, ...radiiMetersTo(lngLat) }));
            },
        });
    };

    const attachFreehandTool = (map) => {
        let points = [];
        return attachDragTool(map, {
            onStart: (lngLat) => {
                points = [lngLat];
                setDraft(draftFromFreehand(points));
            },
            onMove: (lngLat) => {
                points = [...points, lngLat];
                setDraft(draftFromFreehand(points));
            },
            onEnd: (lngLat) => {
                points = [...points, lngLat];
                commitDraft(draftFromFreehand(points));
            },
        });
    };

    const applyTool = (tool, map) => {
        detachToolListeners();
        if (!map) return;
        if (tool === 'rectangle') detachCurrentToolRef.current = attachRectangleTool(map);
        else if (tool === 'circle') detachCurrentToolRef.current = attachCircleTool(map);
        else if (tool === 'oval') detachCurrentToolRef.current = attachOvalTool(map);
        else if (tool === 'freehand') detachCurrentToolRef.current = attachFreehandTool(map);
        // 'move': no listeners — normal map navigation.
    };

    const handleToolChange = (tool) => {
        setActiveTool(tool);
        applyTool(tool, mapRef.current);
    };

    const handleMapLoad = (map) => {
        mapRef.current = map;
        // A successful (re)load — including GameMap's own Retry, which
        // re-fires this same callback — means there is a map to draw on
        // again, even if a previous load had failed.
        setMapError(false);
        applyTool(activeTool, map);
    };

    const handleCancel = () => {
        detachToolListeners();
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
            detachToolListeners();
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
            detachToolListeners();
            onClose();
        } catch (error) {
            setConflictMessage(describeBoundaryError(error));
        } finally {
            setIsDisabling(false);
        }
    };

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
                                {tool === 'move'
                                    ? 'Move Map'
                                    : tool.charAt(0).toUpperCase() + tool.slice(1)}
                            </Button>
                        ))}
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
                        dragPan={activeTool === 'move'}
                        onMapLoad={handleMapLoad}
                        onMapError={() => setMapError(true)}
                    />
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
