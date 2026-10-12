import React from 'react';
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Text,
    VStack,
} from '@chakra-ui/react';

// Presentational — GameEndedLeaderboardBubble (the 'gameEndedLeaderboard'
// chat message's rendering) owns isOpen state and hands down the full
// standings array, already sorted by buildLeaderboardStandings. Matches
// KillPhotoModal's Modal structure and dark-theme styling.
const LeaderboardModal = ({ isOpen, onClose, standings }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Leaderboard</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <VStack align="stretch" spacing={1}>
                        {standings.map((player, index) => (
                            <Text key={player.name} color={player.isAlive ? 'white' : '#b3b3b3'}>
                                {index + 1}. {player.name} — {player.score}
                                {!player.isAlive && ' (eliminated)'}
                            </Text>
                        ))}
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default LeaderboardModal;
