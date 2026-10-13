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
    // Stored RAW (unfiltered by freshness) — a disconnected player's status
    // doc can sit at whatever it last read forever, with no new snapshot
    // ever arriving, so filtering once here and freezing the result in
    // state would leave a stale dot on the map indefinitely (Finding 1).
    // The freshness check instead runs at render time, below, against the
    // `nowMs` ticker, so a dot disappears on its own once freshnessMs
    // passes with no update.
    const [positions, setPositions] = useState([]);
    const [nowMs, setNowMs] = useState(Date.now());

    // A local ticker, matching PlayerGame.js's own existing one — this
    // component has no other re-render source to re-evaluate freshness
    // against once a document stops being updated.
    useEffect(() => {
        const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        if (!isOpen || !roomID) return undefined;
        const statusesQuery = fetchBoundaryStatusesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            statusesQuery,
            (snapshot) => {
                const next = snapshot.docs.map((doc) => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        lat: data.lat,
                        lng: data.lng,
                        lastUsableMs: data.lastUsableReceivedAt?.toMillis?.() ?? null,
                        // doc.id is the normalized trimmedNameLowerCase key
                        // (docs/data-model.md), not the display name —
                        // resolve it back to the player's actual casing the
                        // same way ChatInput/PhotosDisplay do. Falls back
                        // to the raw id unchanged if no player matches.
                        label: resolvePlayerDisplayName(doc.id, players),
                    };
                });
                setPositions(next);
            },
            () => setPositions([])
        );
        return () => unsubscribe();
    }, [isOpen, roomID, players]);

    // Derived at render time from the raw snapshot data and the ticker
    // above — not stored state of its own — so a position goes stale and
    // disappears purely from time passing, even with no new Firestore
    // snapshot. Also guards against a legacy/malformed doc whose lat/lng
    // are missing or not finite numbers.
    const freshPositions = positions
        .filter(
            (position) =>
                isPositionFresh(position.lastUsableMs, nowMs) &&
                Number.isFinite(position.lat) &&
                Number.isFinite(position.lng)
        )
        .map((position) => ({
            id: position.id,
            lat: position.lat,
            lng: position.lng,
            label: position.label,
        }));

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
                            otherPositions={freshPositions}
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
