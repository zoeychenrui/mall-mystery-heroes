import React, { useState } from 'react';
import { Button } from '@chakra-ui/react';
import BoundaryEditorModal from './BoundaryEditorModal';

/**
 * Entry point for the moderator's game-area editor — self-contained,
 * same shape as AbandonRoomButton.js: owns its own open/closed state,
 * takes just the props it needs.
 */
const GameBoundaryButton = ({ roomID, gameBoundary }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button
                colorScheme="teal"
                size="md"
                onClick={() => setIsOpen(true)}
                mx={0}
                borderRadius="3xl"
                _hover={{ opacity: 0.8 }}
            >
                {gameBoundary ? 'Edit Game Area' : 'Set Game Area'}
            </Button>
            <BoundaryEditorModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                roomID={roomID}
                currentBoundary={gameBoundary}
            />
        </>
    );
};

export default GameBoundaryButton;
