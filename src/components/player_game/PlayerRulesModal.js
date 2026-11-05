import React from 'react';
import {
    Heading,
    ListItem,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
    Text,
    UnorderedList,
} from '@chakra-ui/react';

const PlayerRulesModal = ({ isOpen, onClose }) => (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
        <ModalOverlay />
        <ModalContent bg="gray.800" color="white" maxH="85vh" overflow="hidden">
            <ModalHeader>Game Rules</ModalHeader>
            <ModalCloseButton aria-label="Close game rules" />
            <ModalBody overflowY="auto" pb={6}>
                <Text mb={5} color="whiteAlpha.800">
                    You have been contracted to eliminate your targets. Follow these rules, plus any
                    instructions from your game host.
                </Text>

                <Heading size="sm" mb={2} color="teal.200">
                    Targets
                </Heading>
                <UnorderedList spacing={2} mb={5} pl={2}>
                    <ListItem>
                        To make a kill attempt, take a photo of the person and submit it for the
                        host to review. An elimination only counts when the host approves it.
                    </ListItem>
                    <ListItem>
                        If you eliminate a target, you will take all of their points.
                    </ListItem>
                    <ListItem>
                        Your targets may change throughout the game, so check your target list
                        regularly. You can press their avatar to see a closer view of them.
                    </ListItem>
                </UnorderedList>

                <Heading size="sm" mb={2} color="teal.200">
                    Missions &amp; Points
                </Heading>
                <UnorderedList spacing={2} mb={5} pl={2}>
                    <ListItem>
                        Complete missions to earn points or revive. To keep track of scores, check
                        the leaderboard.
                    </ListItem>
                </UnorderedList>

                <Heading size="sm" mb={2} color="teal.200">
                    Avatars
                </Heading>
                <UnorderedList spacing={2} mb={5} pl={2}>
                    <ListItem>
                        Change your avatar to be a picture of yourself so other players know who you
                        are.
                    </ListItem>
                </UnorderedList>

                <Heading size="sm" mb={2} color="teal.200">
                    Zones
                </Heading>
                <UnorderedList spacing={2} mb={5} pl={2}>
                    <ListItem>
                        The host can decide to enable zones in the game. Users must accept location
                        permissions to submit photos.
                    </ListItem>
                    <ListItem>
                        If these zones are enabled, use the map to locate individuals who are
                        outside of the zone.
                    </ListItem>
                </UnorderedList>

                <Heading size="sm" mb={2} color="teal.200">
                    Shop
                </Heading>
                <UnorderedList spacing={2} mb={5} pl={2}>
                    <ListItem>
                        Use the shop to purchase items that can help you in the game.
                    </ListItem>
                </UnorderedList>

                <Heading size="sm" mb={2} color="teal.200">
                    Safety
                </Heading>
                <UnorderedList spacing={2} mb={5} pl={2}>
                    <ListItem>
                        Follow all venue rules. Stay in public areas; never enter restricted spaces
                        or run indoors.
                    </ListItem>
                    <ListItem>
                        Keep play friendly and safe. No real weapons, physical contact, or actions
                        that could alarm or endanger anyone.
                    </ListItem>
                    <ListItem>
                        If rules are broken, the host may issue warnings or penalties, including
                        removal from the game.
                    </ListItem>
                </UnorderedList>

                <Heading size="sm" mb={2} color="teal.200">
                    If you are eliminated
                </Heading>
                <Text color="whiteAlpha.800">
                    Stay in the game and watch for revival missions. The host controls eliminations,
                    revivals, and when the game ends. Check the chat for updates and announcements.
                </Text>
            </ModalBody>
        </ModalContent>
    </Modal>
);

export default PlayerRulesModal;
