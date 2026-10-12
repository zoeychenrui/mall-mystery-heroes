import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import React from 'react';
import PlayerTaskList from './PlayerTaskList';

// Read-only sibling of TaskListModal.js, opened from PlayerGame.js's
// "View Missions" button instead of the GM's `/mission view` command.
// Takes roomID as a prop for the same reason PlayerTaskList does.
const PlayerTaskListModal = ({ isOpen, onClose, roomID }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl">
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Missions</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <PlayerTaskList roomID={roomID} />
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default PlayerTaskListModal;
