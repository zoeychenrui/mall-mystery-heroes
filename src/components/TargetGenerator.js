import React, { useState } from 'react';
import {
    AlertDialog,
    Button,
    AlertDialogBody,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    AlertDialogContent,
    useDisclosure,
    TableContainer,
    Tr,
    Td,
    Th,
    Tbody,
    Table,
    Thead,
} from '@chakra-ui/react';
import {
    addLogForRoom,
    markGameAsStarted,
    updateAssassinsForPlayer,
    updateTargetsForPlayer,
} from './firebase_calls/dbCalls';
import { buildTargetGraph } from '../game/targetGraph';
import CreateAlert from './CreateAlert';
const TargetGenerator = ({ arrayOfPlayers, roomID, handleLobbyRoom }) => {
    // The target/assassin adjacency lists for the round, built on open.
    const [graph, setGraph] = useState({ targets: {}, assassins: {} });
    const createAlert = CreateAlert();

    //reference to players subcollection
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = React.useRef();

    //actions that occur when clicking generate button
    const handleClick = () => {
        // Checked here too, not just in onYesClose below — a moderator
        // should see this error the moment they click Begin Game with too
        // few players, not after they've already reviewed a target preview
        // and clicked Confirm. onYesClose keeps its own copy of this check
        // as a safety net for the roster shrinking below 2 while the
        // dialog is still open (e.g. a player gets removed mid-preview).
        if (arrayOfPlayers.length < 2) {
            createAlert('error', 'Error', 'Not enough players (must have at least 2)', 1500);
            return;
        }
        onOpen();
        setGraph(buildTargetGraph(arrayOfPlayers));
    };
    //actions that occur when clicking yes
    const onYesClose = async () => {
        // The 2-player minimum used to be checked only in handleLobbyRoom,
        // the very last step of this flow — after gameStarted was already
        // flipped true below. That flag is the exact one joinRoom checks to
        // reject self-registration, so a moderator who confirmed with too
        // few players got stuck: the handoff aborted with an error, but the
        // room was already permanently marked as started, locking out every
        // new player with "This game has already started." Checking here,
        // before any write happens, means an under-strength confirmation
        // does nothing at all instead of doing it halfway.
        if (arrayOfPlayers.length < 2) {
            createAlert('error', 'Error', 'Not enough players (must have at least 2)', 1500);
            return;
        }

        // gameStarted is the security gate joinRoom checks before letting a
        // player self-register (docs/superpowers/specs/2026-08-06-player-
        // access-and-room-lifecycle-design.md) — it must flip before the
        // target graph goes live, not after, or there is a window where
        // targets/assassins are fully written but the room still reads as
        // joinable. A failure here is treated the same way a failed target
        // write already is (see UpdateDatabase's catch below): alert and
        // abort the handoff rather than silently continuing into a room
        // that permanently under-reports its own state.
        try {
            await markGameAsStarted(roomID);
        } catch (error) {
            console.error('Error marking game as started: ', error);
            createAlert('error', 'Error starting game', error.message, 1500);
            return;
        }
        await UpdateDatabase(arrayOfPlayers, graph);
        // A real log entry, not the phantom `<ListItem>Game has begun!</ListItem>`
        // Log.js used to hardcode above every real entry (docs/improvements.md
        // item 23) — nothing in Firestore ever actually contained that text.
        // Seeded here, at the moment the game actually begins, rather than at
        // room creation, when no players exist yet.
        try {
            await addLogForRoom('Game has begun!', 'gray.400', roomID);
        } catch (error) {
            console.error('Error adding log: ', error);
        }
        onClose();
        handleLobbyRoom();
    };
    //updates targets in database
    const UpdateDatabase = async (players, { targets, assassins }) => {
        try {
            for (const player of players) {
                await updateTargetsForPlayer(player, targets[player] ?? [], roomID);
                await updateAssassinsForPlayer(player, assassins[player] ?? [], roomID);
            }
        } catch (error) {
            // dbCalls functions throw on failure rather than swallowing
            // errors (docs/improvements.md item 10) — this catch previously
            // only logged, with no UI feedback.
            console.error('Error adding targets to database: ', error);
            createAlert('error', 'Error generating targets', error.message, 1500);
        }
    };

    const tableOfPlayers = arrayOfPlayers.map((eachName) => (
        <Tr key={eachName}>
            <Td>{eachName}</Td>
            <Td>{graph.targets[eachName]?.join(', ') || 'no targets'}</Td>
        </Tr>
    ));

    return (
        <div>
            <Button
                bg="black"
                color="white"
                variant="solid"
                size="lg"
                borderRadius="3xl"
                _hover={{ bg: 'white', color: 'black' }}
                mt="8px"
                onClick={handleClick}
            >
                Begin Game
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose={onClose}
                size="3xl"
            >
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader>Generate Targets</AlertDialogHeader>

                    <AlertDialogBody>
                        The following will be the initial targets for the the round:
                        <TableContainer>
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th color="#FFFFFF">Player</Th>
                                        <Th color="#FFFFFF">Targets</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>{tableOfPlayers}</Tbody>
                            </Table>
                        </TableContainer>
                    </AlertDialogBody>

                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={onYesClose}>
                            Confirm and Begin Game
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default TargetGenerator;
