import {
    Flex,
    Button,
    AlertDialog,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    AlertDialogContent,
    useDisclosure,
} from '@chakra-ui/react';
import React, { useContext } from 'react';
import {
    addPlayerMessageForRoom,
    endGame,
    fetchAllPlayersDataForRoom,
} from '../firebase_calls/dbCalls';
import { buildLeaderboardStandings } from '../../game/leaderboard';
import { useNavigate } from 'react-router-dom';
import CreateAlert from '../CreateAlert';
import { gameContext } from '../Contexts';

const Endgamebutton = () => {
    const { roomID } = useContext(gameContext);
    const cancelRef = React.useRef();
    const navigate = useNavigate();
    const createAlert = CreateAlert();

    const { isOpen, onOpen, onClose } = useDisclosure();

    // endGame throws on failure rather than swallowing (docs/improvements.md
    // item 10) — previously this fired-and-forgot the write and navigated
    // away immediately regardless, so a failure was invisible and the GM
    // would land on /dashboard believing the game had ended when it hadn't.
    const onYesEnd = async () => {
        onClose();
        try {
            await endGame(roomID);
        } catch (error) {
            console.error('Error ending game: ', error);
            createAlert('error', 'Error ending game', error.message, 1500);
            return;
        }

        // The game has genuinely ended at this point — a failure below
        // (fetching the roster, posting either broadcast) shouldn't block
        // navigation or make it look like ending the game itself failed.
        // The GM still sees an alert so they know the broadcast may not
        // have gone out.
        try {
            const players = await fetchAllPlayersDataForRoom(roomID);
            const standings = buildLeaderboardStandings(players);
            await addPlayerMessageForRoom(
                {
                    type: 'gameEnded',
                    recipient: null,
                    text: 'Please head back to the starting area.',
                    standings: null,
                },
                roomID
            );
            await addPlayerMessageForRoom(
                {
                    type: 'gameEndedLeaderboard',
                    recipient: null,
                    text: null,
                    standings,
                },
                roomID
            );
        } catch (error) {
            console.error('Error posting game-end broadcasts: ', error);
            createAlert(
                'error',
                'Game ended, but the broadcast to players may not have gone out',
                error.message,
                1500
            );
        }

        navigate('/dashboard');
    };

    const handleClick = () => {
        onOpen();
    };

    return (
        <Flex>
            <Button
                bg="red.500"
                color="white"
                variant="solid"
                size="md"
                borderRadius="3xl"
                _hover={{ bg: 'white', color: 'black' }}
                onClick={handleClick}
                mr="12px"
            >
                End Game
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose={onClose}
                size="3xl"
            >
                <AlertDialogOverlay alignItems="center" justifyContent="center" />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader
                        alignItems="center"
                        justifyContent="center"
                        textAlign="center"
                    >
                        Are you sure you want to end the Game?
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={onYesEnd}>
                            Confirm End Game
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Flex>
    );
};
export default Endgamebutton;
