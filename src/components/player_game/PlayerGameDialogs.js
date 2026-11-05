import React, { useRef } from 'react';
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Text,
} from '@chakra-ui/react';

const PlayerGameDialogs = ({
    isLeaveOpen,
    onLeaveClose,
    onConfirmLeave,
    isGameEndedOpen,
    onGameEndedClose,
}) => {
    const cancelRef = useRef(null);

    return (
        <>
            <AlertDialog
                isOpen={isLeaveOpen}
                leastDestructiveRef={cancelRef}
                onClose={onLeaveClose}
            >
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Leave the game? You&apos;ll be removed, and won&apos;t be able to rejoin
                        once the game has started.
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onLeaveClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={onConfirmLeave}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Modal isOpen={isGameEndedOpen} onClose={onGameEndedClose} size="xl" isCentered>
                <ModalOverlay />
                <ModalContent bg="red.900" color="white">
                    <ModalHeader textAlign="center" fontSize="2xl" fontWeight="bold">
                        GAME ENDED
                    </ModalHeader>
                    <ModalCloseButton aria-label="Close modal" />
                    <ModalBody textAlign="center">
                        <Text fontSize="lg" fontWeight="bold">
                            PLEASE HEAD BACK TO THE STARTING AREA.
                        </Text>
                    </ModalBody>
                    <ModalFooter justifyContent="center">
                        <Button onClick={onGameEndedClose}>Close</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
};

export default PlayerGameDialogs;
