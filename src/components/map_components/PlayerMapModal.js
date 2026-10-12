import React, { useRef } from 'react';
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import GameMap from './GameMap';

/**
 * Read-only boundary map for players: shows the published game area and
 * the player's own position/accuracy, with a Recenter on Me control.
 * Closing this modal does not touch location tracking — that lives in
 * useBoundaryLocation.js, mounted at the PlayerGame.js level, not here
 * (spec: "Closing the map does not stop location updates").
 */
const PlayerMapModal = ({ isOpen, onClose, boundaryVertices, ownPosition }) => {
    const mapRef = useRef(null);

    const handleMapLoad = (map) => {
        mapRef.current = map;
    };

    const handleRecenter = () => {
        if (mapRef.current && ownPosition) {
            mapRef.current.flyTo({ center: [ownPosition.lng, ownPosition.lat], zoom: 17 });
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size={{ base: 'full', md: '6xl' }}>
            <ModalOverlay />
            <ModalContent bg="#202030" h={{ base: '100%', md: '85vh' }}>
                <ModalHeader color="#ffffff">Game Area</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody display="flex" flexDirection="column" gap="8px">
                    <Button
                        alignSelf="flex-start"
                        size="sm"
                        onClick={handleRecenter}
                        isDisabled={!ownPosition}
                    >
                        Recenter on Me
                    </Button>
                    <GameMap
                        boundaryVertices={boundaryVertices}
                        fitTo={null}
                        ownPosition={ownPosition}
                        dragPan
                        onMapLoad={handleMapLoad}
                        onMapError={() => {}}
                    />
                </ModalBody>
            </ModalContent>
        </Modal>
    );
};

export default PlayerMapModal;
