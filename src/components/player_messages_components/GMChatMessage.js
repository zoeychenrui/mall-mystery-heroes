import React, { useState } from 'react';
import {
    Box,
    Button,
    Image,
    ListItem,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalOverlay,
    Text,
} from '@chakra-ui/react';
import { formatMessageTime } from '../../utils/formatMessageTime';

// One player chat message's rendering, extracted from GMChatPanel.js and
// wrapped in React.memo so an unchanged message (same object reference,
// preserved by applyMessageChanges) is skipped entirely on re-render — the
// whole point of this split
// (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
const GMChatMessage = ({ message }) => {
    const [isPhotoOpen, setIsPhotoOpen] = useState(false);
    const time = formatMessageTime(message.timestamp);

    if (message.type === 'powerUpPing') {
        return (
            <ListItem mb={2}>
                <Box
                    bg="orange.900"
                    border="1px solid"
                    borderColor="orange.400"
                    borderRadius="md"
                    p={2}
                    display="inline-block"
                >
                    <Text as="span" fontWeight="bold" color="orange.300">
                        {message.source === 'boundaryExposure' ? 'Zone alert' : 'Ping'}
                    </Text>{' '}
                    <Text as="span">{message.text}</Text>
                    {(message.pings ?? []).map((ping) => (
                        <Text key={ping.name} fontSize="sm" color="gray.300">
                            {ping.name}:{' '}
                            {ping.lat == null
                                ? 'no location'
                                : `located at ${
                                      ping.capturedAtMs == null
                                          ? 'an unknown time'
                                          : new Date(ping.capturedAtMs).toLocaleTimeString([], {
                                                hour: 'numeric',
                                                minute: '2-digit',
                                            })
                                  }${ping.isStale ? ' (old)' : ''}`}
                        </Text>
                    ))}
                    {time && (
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                </Box>
            </ListItem>
        );
    }

    if (message.type === 'broadcast') {
        return (
            <ListItem mb={2}>
                <Box
                    bg="purple.900"
                    border="1px solid"
                    borderColor="purple.400"
                    borderRadius="md"
                    p={2}
                >
                    <Text as="span" fontWeight="bold" color="yellow.300">
                        GM:
                    </Text>{' '}
                    <Text as="span">{message.text}</Text>
                    {time && (
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                </Box>
            </ListItem>
        );
    }

    if (message.type === 'killPhoto') {
        return (
            <ListItem mb={2}>
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        {message.assassin} · {message.isFunPhoto ? 'Fun photo' : 'Photo submission'}
                    </Text>
                    <Button
                        variant="unstyled"
                        display="block"
                        height="auto"
                        minW="0"
                        onClick={() => setIsPhotoOpen(true)}
                        aria-label={
                            message.isFunPhoto ? 'View larger fun photo' : 'View larger photo'
                        }
                    >
                        <Image
                            src={message.photoUrl}
                            alt={message.isFunPhoto ? 'Fun photo' : 'Photo submission'}
                            borderRadius="md"
                            maxH="200px"
                            cursor="zoom-in"
                        />
                    </Button>
                    <Modal
                        isOpen={isPhotoOpen}
                        onClose={() => setIsPhotoOpen(false)}
                        size="6xl"
                        isCentered
                    >
                        <ModalOverlay />
                        <ModalContent bg="gray.900" maxW="90vw">
                            <ModalCloseButton aria-label="Close enlarged photo" zIndex={1} />
                            <ModalBody p={2} display="flex" justifyContent="center">
                                <Image
                                    src={message.photoUrl}
                                    alt={
                                        message.isFunPhoto
                                            ? 'Enlarged fun photo'
                                            : 'Enlarged photo submission'
                                    }
                                    maxH="85vh"
                                    maxW="100%"
                                    objectFit="contain"
                                />
                            </ModalBody>
                        </ModalContent>
                    </Modal>
                    {time && (
                        <Text fontSize="xs" color="gray.400" mt={1}>
                            {time}
                        </Text>
                    )}
                </Box>
            </ListItem>
        );
    }

    return (
        <ListItem mb={1}>
            <Text as="span" fontWeight="bold">
                {message.sender}:
            </Text>{' '}
            <Text as="span">{message.text}</Text>
            {time && (
                <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                    {time}
                </Text>
            )}
        </ListItem>
    );
};

export default React.memo(GMChatMessage);
