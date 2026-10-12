import React, { useEffect, useState } from 'react';
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Flex,
    Image,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Select,
    Spinner,
    Text,
} from '@chakra-ui/react';
import { buildPhotoClaimOptions } from '../../game/photoClaimOptions';

// A player submits a kill-photo or mission-photo claim. Presentational,
// but now owns the player's own claim picker
// (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md)
// — mirrors PhotosDisplay.js's old moderator-side dropdown exactly
// (single option auto-resolves and is shown as plain text; multiple
// options show a grouped <Select>; zero options disables Submit with a
// plain message), just computed for the submitting player instead of a
// resolved photo's assassin.
// MessageComposer.js owns capturing, compressing, and uploading/writing
// the photo (its camera button triggers a hidden file input directly,
// always mounted so it can be triggered before this modal has ever
// opened); this modal renders whatever MessageComposer hands it and
// reports back the player's resolved claim
// (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
const KillPhotoModal = ({
    isOpen,
    onClose,
    previewUrl,
    error,
    onSubmit,
    players,
    missions,
    playerName,
}) => {
    const [selectedOption, setSelectedOption] = useState('');

    // A pick made before the modal was last opened must never carry over
    // into the next photo's default.
    useEffect(() => {
        if (isOpen) setSelectedOption('');
    }, [isOpen]);

    const combinedOptions = buildPhotoClaimOptions(players, missions, playerName);
    const killTargetOptions = combinedOptions.filter((option) => option.group === 'Kill Target');
    const missionOptions = combinedOptions.filter((option) => option.group === 'Mission');

    const effectiveSelection =
        combinedOptions.length === 1
            ? combinedOptions[0].value
            : combinedOptions.some((option) => option.value === selectedOption)
              ? selectedOption
              : '';

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {previewUrl && (
                        <Box mb={4}>
                            <Image src={previewUrl} alt="Kill photo preview" maxH="200px" />
                        </Box>
                    )}
                    {error && (
                        <Alert status="error" mb={4}>
                            <AlertIcon />
                            {error}
                        </Alert>
                    )}
                    {!previewUrl && !error && (
                        <Flex align="center" mb={4}>
                            <Spinner size="sm" mr={2} />
                            <Text>Processing photo…</Text>
                        </Flex>
                    )}
                    {combinedOptions.length > 1 ? (
                        <Select
                            aria-label="Select target or mission"
                            placeholder="Choose target or mission"
                            value={effectiveSelection}
                            onChange={(event) => setSelectedOption(event.target.value)}
                        >
                            {killTargetOptions.length > 0 && (
                                <optgroup label="Kill Target">
                                    {killTargetOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {missionOptions.length > 0 && (
                                <optgroup label="Mission">
                                    {missionOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </Select>
                    ) : combinedOptions.length === 0 ? (
                        <Text color="gray.400">No open targets or missions for this player.</Text>
                    ) : (
                        effectiveSelection &&
                        (effectiveSelection.startsWith('mission:') ? (
                            <Text>Mission: {missionOptions[0]?.label}</Text>
                        ) : (
                            <Text>Target: {killTargetOptions[0]?.label}</Text>
                        ))
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    <Button
                        colorScheme="teal"
                        onClick={() => onSubmit(effectiveSelection)}
                        isDisabled={!previewUrl || !effectiveSelection}
                    >
                        Submit
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default KillPhotoModal;
