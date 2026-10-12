import React, { useState } from 'react';
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Button,
    Flex,
    Select,
    useDisclosure,
} from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import { removePlayerForRoom } from '../firebase_calls/dbCalls';

//import {playerData} from './PlayerList';
const PlayerRemove = ({ onPlayerRemoved, arrayOfPlayers, roomID }) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const createAlert = CreateAlert();
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = React.useRef();

    //updates selected player
    const handleChange = (event) => {
        setSelectedPlayer(event.target.value);
    };

    // Opens the confirmation dialog instead of removing immediately —
    // removePlayerForRoom is a plain, irreversible deleteDoc
    // (docs/superpowers/specs/2026-08-17-audit-batch-a-fixes-design.md).
    const handleRemoveClick = () => {
        if (selectedPlayer === '') {
            return createAlert('error', 'Error', 'must select player', 1500);
        }
        onOpen();
    };

    //deletes player in database
    const handleConfirmRemove = async () => {
        try {
            await removePlayerForRoom(selectedPlayer, roomID);
        } catch (error) {
            console.error('Error removing player: ', error);
            onClose();
            return createAlert('error', 'Error', 'player not found', 1500);
        }

        if (onPlayerRemoved) {
            onPlayerRemoved(selectedPlayer);
        }
        setSelectedPlayer('');
        onClose();
    };

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                handleRemoveClick();
            }}
        >
            <Flex>
                <Select
                    placeholder="Select player to remove"
                    value={selectedPlayer}
                    onChange={handleChange}
                    size="lg"
                    mr="6px"
                    borderRadius="3xl"
                >
                    {arrayOfPlayers.map((player, index) => (
                        <option key={index} value={player}>
                            {player}
                        </option>
                    ))}
                </Select>
                <Button onClick={handleRemoveClick} colorScheme="blue" size="lg" borderRadius="3xl">
                    Remove
                </Button>
            </Flex>
            <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Remove {selectedPlayer}? This permanently deletes their player document and
                        cannot be undone.
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={handleConfirmRemove}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </form>
    );
};

export default PlayerRemove;
