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
} from '../../game/boundaryDraft';
import { projectToMeters } from '../../game/gameBoundary';

const TOOLS = ['move', 'freehand', 'rectangle', 'circle', 'oval'];

// Minimum pixel movement between accepted mousemove samples, so a fast
// drag doesn't flood the draft with near-duplicate points (freehand) or
// near-identical radius recomputations (circle/oval/rectangle).
const MIN_DRAG_PIXEL_DISTANCE = 6;

/**
 * Attaches one drag gesture (mousedown -> decimated mousemove* ->
 * mouseup) to the map, shared by all four drawing tools — each tool
 * only supplies what a start/move/end lngLat means for its own shape.
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
};

/**
 * Local drawing surface for the room's game-area boundary. Draws with
 * four tools against GameMap's boundary overlay, keeps an undo history
 * of drafts, and lets the moderator Clear Draft or Cancel. Does not
 * publish anything yet (see Task 6, which adds Publish/Disable to this
 * same component).
 */
const BoundaryEditorModal = ({ isOpen, onClose, currentBoundary }) => {
    const [draft, setDraft] = useState(() => draftFromPublished(currentBoundary));
    const [history, setHistory] = useState([]);
    const [activeTool, setActiveTool] = useState('move');
    // GameMap already renders its own full-screen "Map failed to load" /
    // Retry UI internally on error (see GameMap.js); this modal has
    // nothing further to show, so only the setter is kept.
    const [, setMapError] = useState(false);
    const mapRef = useRef(null);

    // Reopening always starts from the latest published state, never a
    // previously abandoned draft (Review Focus: reopen fidelity).
    useEffect(() => {
        if (isOpen) {
            setDraft(draftFromPublished(currentBoundary));
            setHistory([]);
            setActiveTool('move');
            setMapError(false);
        }
    }, [isOpen, currentBoundary]);

    const commitDraft = (nextDraft) => {
        setHistory((prev) => [...prev, draft]);
        setDraft(nextDraft);
    };

    const handleUndo = () => {
        setHistory((prev) => {
            if (prev.length === 0) return prev;
            setDraft(prev[prev.length - 1]);
            return prev.slice(0, -1);
        });
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

    const detachToolListeners = () => {
        const map = mapRef.current;
        if (!map) return;
        map.off('mousedown');
        map.off('mousemove');
        map.off('mouseup');
    };

    const attachRectangleTool = (map) => {
        let cornerA = null;
        attachDragTool(map, {
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
        attachDragTool(map, {
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
        attachDragTool(map, {
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
        attachDragTool(map, {
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
        if (tool === 'rectangle') attachRectangleTool(map);
        else if (tool === 'circle') attachCircleTool(map);
        else if (tool === 'oval') attachOvalTool(map);
        else if (tool === 'freehand') attachFreehandTool(map);
        // 'move': no listeners — normal map navigation.
    };

    const handleToolChange = (tool) => {
        setActiveTool(tool);
        applyTool(tool, mapRef.current);
    };

    const handleMapLoad = (map) => {
        mapRef.current = map;
        applyTool(activeTool, map);
    };

    const handleCancel = () => {
        detachToolListeners();
        onClose();
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
                            >
                                {tool === 'move'
                                    ? 'Move Map'
                                    : tool.charAt(0).toUpperCase() + tool.slice(1)}
                            </Button>
                        ))}
                        <Button size="sm" onClick={handleUndo} isDisabled={history.length === 0}>
                            Undo
                        </Button>
                        <Button size="sm" onClick={handleClearDraft}>
                            Clear Draft
                        </Button>
                    </HStack>
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
                    <Button onClick={handleCancel}>Cancel</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default BoundaryEditorModal;
