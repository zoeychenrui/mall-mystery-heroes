import React, { useState } from 'react';
import {
    Button,
    Heading,
    Modal,
    ModalBody,
    ModalContent,
    ModalOverlay,
    Select,
    Text,
    VStack,
} from '@chakra-ui/react';

/**
 * The mystery box's result (POWER_UPS_SPEC.md): a full-screen gray display
 * with the reward centered and Close beneath it. When the box rolled an
 * item that needs a player picked (the picked ping or the camera block),
 * it also asks for one and uses the item on them via `onClaim`.
 *
 * Closing without picking leaves that reward waiting on the server
 * (`pendingMysteryItem`); the shop offers it again.
 */
const MysteryBoxReveal = ({ isOpen, label, needsTarget, pickablePlayers, onClaim, onClose }) => {
    const [targetName, setTargetName] = useState('');
    const [isClaiming, setIsClaiming] = useState(false);
    const [error, setError] = useState(null);

    const handleUse = async () => {
        setIsClaiming(true);
        setError(null);
        try {
            await onClaim(targetName);
            setTargetName('');
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsClaiming(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="full">
            <ModalOverlay />
            <ModalContent bg="gray.700" color="white">
                <ModalBody display="flex" alignItems="center" justifyContent="center">
                    <VStack spacing={6} textAlign="center" maxW="sm" w="100%">
                        <Text fontSize="lg" color="gray.300">
                            Mystery box
                        </Text>
                        <Heading size="2xl">{label}</Heading>
                        {needsTarget && (
                            <>
                                <Select
                                    bg="white"
                                    color="gray.800"
                                    placeholder="Pick a player"
                                    aria-label="Pick a player for your reward"
                                    value={targetName}
                                    onChange={(e) => setTargetName(e.target.value)}
                                >
                                    {pickablePlayers.map((player) => (
                                        <option key={player.name} value={player.name}>
                                            {player.name}
                                        </option>
                                    ))}
                                </Select>
                                <Button
                                    colorScheme="orange"
                                    w="100%"
                                    isDisabled={!targetName || isClaiming}
                                    onClick={handleUse}
                                >
                                    Use
                                </Button>
                            </>
                        )}
                        {error && <Text color="red.300">{error}</Text>}
                        <Button variant="outline" colorScheme="whiteAlpha" onClick={onClose}>
                            Close
                        </Button>
                    </VStack>
                </ModalBody>
            </ModalContent>
        </Modal>
    );
};

export default MysteryBoxReveal;
