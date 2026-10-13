import React, { useEffect, useState } from 'react';
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import GameMap from './GameMap';
import { fetchBoundaryStatusesQueryForRoom } from '../firebase_calls/dbCalls';
import { resolvePlayerDisplayName } from '../../game/playerNames';
// require(), not a named import — gameBoundary.js is CommonJS by design
// (see GameMap.js for the same pattern and why).
const { isPositionFresh } = require('../../game/gameBoundary');

/**
 * The GM's live map of every player's current location — every player,
 * at all times, not just outside ones (docs/superpowers/specs/
 * 2026-10-12-live-location-visibility-design.md). Subscribes to the whole
 * boundaryStatuses subcollection; only the host's Firestore read grant
 * makes this succeed at all (firestore.rules is unchanged for the host's
 * side of this — it already had no restriction).
 */
const LivePlayerMapButton = ({ roomID, players, boundaryVertices = null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [positions, setPositions] = useState([]);

    useEffect(() => {
        if (!isOpen || !roomID) return undefined;
        const statusesQuery = fetchBoundaryStatusesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(statusesQuery, (snapshot) => {
            const nowMs = Date.now();
            const next = [];
            snapshot.docs.forEach((doc) => {
                const data = doc.data();
                const lastUsableMs = data.lastUsableReceivedAt?.toMillis?.() ?? null;
                if (!isPositionFresh(lastUsableMs, nowMs)) return;
                next.push({
                    id: doc.id,
                    lat: data.lat,
                    lng: data.lng,
                    // doc.id is the normalized trimmedNameLowerCase key
                    // (docs/data-model.md), not the display name — resolve
                    // it back to the player's actual casing the same way
                    // ChatInput/PhotosDisplay do. Falls back to the raw id
                    // unchanged if no player matches.
                    label: resolvePlayerDisplayName(doc.id, players),
                });
            });
            setPositions(next);
        });
        return () => unsubscribe();
    }, [isOpen, roomID, players]);

    return (
        <>
            <Button
                colorScheme="teal"
                variant="outline"
                borderRadius="3xl"
                onClick={() => setIsOpen(true)}
            >
                Live Player Map
            </Button>
            <Modal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                size={{ base: 'full', md: '6xl' }}
            >
                <ModalOverlay />
                <ModalContent bg="#202030" h={{ base: '100%', md: '85vh' }}>
                    <ModalHeader color="#ffffff">Live Player Map</ModalHeader>
                    <ModalCloseButton aria-label="Close modal" />
                    <ModalBody>
                        <GameMap
                            boundaryVertices={boundaryVertices}
                            fitTo={null}
                            otherPositions={positions}
                            dragPan
                            onMapLoad={() => {}}
                            onMapError={() => {}}
                        />
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
};

export default LivePlayerMapButton;
