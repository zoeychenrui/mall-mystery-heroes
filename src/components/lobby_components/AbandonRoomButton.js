import React from 'react';
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Button,
    useDisclosure,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import CreateAlert from '../CreateAlert';
import { endGame } from '../firebase_calls/dbCalls';

// Abandons a room that hasn't started yet — the only way to leave a
// Lobby-phase room used to be Start Game then End Game, since
// Endgamebutton.js (HeaderExecution.js) only renders once the game has
// actually started. Reuses the exact same generic endGame write
// Endgamebutton uses, but skips its player-facing "please head back"/
// leaderboard announcements entirely — nobody has actually played
// anything yet, so those would be nonsensical here. Navigates to
// /dashboard afterward, same as Endgamebutton — that re-runs its own
// "does this host have an active room" check, finds none (since this
// room is now ended), and generates a fresh room right away
// (docs/superpowers/specs/2026-08-08-dashboard-removal-design.md).
const AbandonRoomButton = ({ roomID }) => {
    const navigate = useNavigate();
    const createAlert = CreateAlert();
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = React.useRef();

    const handleConfirmAbandon = async () => {
        try {
            await endGame(roomID);
        } catch (error) {
            console.error('Error abandoning room: ', error);
            onClose();
            createAlert('error', 'Error abandoning room', error.message, 1500);
            return;
        }
        onClose();
        navigate('/dashboard');
    };

    return (
        <>
            <Button colorScheme="red" variant="outline" borderRadius="3xl" onClick={onOpen}>
                Abandon Room
            </Button>
            <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Abandon this room? Nobody will be able to join it anymore, and this cannot
                        be undone.
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={handleConfirmAbandon}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default AbandonRoomButton;
