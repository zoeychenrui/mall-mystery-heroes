import React, { useContext, useState } from 'react';
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
import { updateAssassinsForPlayer, updateTargetsForPlayer } from '../firebase_calls/dbCalls';
import { gameContext } from '../Contexts';
import { buildTargetGraph } from '../../game/targetGraph';
import CreateAlert from '../CreateAlert';
const ResetTargetsButton = ({ arrayOfPlayers, addLog }) => {
    const { roomID } = useContext(gameContext);
    // The target/assassin adjacency lists for the reset, built on open.
    const [graph, setGraph] = useState({ targets: {}, assassins: {} });
    const createAlert = CreateAlert();

    //reference to players subcollection
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = React.useRef();

    //actions that occur when clicking generate button
    const handleClick = () => {
        onOpen();
        setGraph(buildTargetGraph(arrayOfPlayers));
    };
    //actions that occur when clicking yes
    const onYesClose = async () => {
        await UpdateDatabase(arrayOfPlayers, graph);
        await addLog('Resetting Targets', 'red.400');
        for (const player of arrayOfPlayers) {
            await addLog(
                'New Target(s) for ' + player + ': ' + (graph.targets[player] ?? []).join(', '),
                'blue.400'
            );
        }
        onClose();
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
            createAlert('error', 'Error resetting targets', error.message, 1500);
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
                bg="red.500"
                color="white"
                variant="solid"
                size="md"
                borderRadius="3xl"
                _hover={{ bg: 'white', color: 'black' }}
                onClick={handleClick}
                mr="12px"
            >
                Reset Targets
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose={onClose}
                size="3xl"
            >
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>

                    <AlertDialogBody>
                        This will hard reset the targets for alive players. The following will be
                        the targets for each player:
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
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ResetTargetsButton;
