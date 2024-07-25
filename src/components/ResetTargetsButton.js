import React, { useState } from 'react';
import {AlertDialog, 
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
        Thead
    } from '@chakra-ui/react';
import { updateAssassinsForPlayer, updateTargetsForPlayer } from './dbCalls';
const ResetTargetsButton = ({arrayOfPlayers, addLog, roomID}) => {
    //store player's data for three things: 
    //1. number of assassins (hits on a person)
    //2. index of last target
    //3. array of previous targets
    //can be used later for assigning new targets
    const [playerData, setPlayerData] = useState({});

    //reference to players subcollection
    const { isOpen, onOpen, onClose } = useDisclosure();
    const cancelRef = React.useRef();
    const [targetMap, setTargetMap] = useState(new Map());

    //randomizes order of array
    const randomizeArray = (array) => {
        for (let i = 0; i < array.length - 1; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
    //actions that occur when clicking generate button
    const handleClick = () => {
        onOpen();
        InitializeTargets();
    }
    //actions that occur when clicking yes
    const onYesClose = async () => {
        await UpdateDatabase(arrayOfPlayers, targetMap);
        await addLog("Reseting Targets");
        for (const player of arrayOfPlayers) {
            await addLog('New Target(s) for ' + player + ': ' + targetMap.get(player).join(', '));
            console.log('looping for ' + player);
        }
        onClose();
    }
    //updates targets in database
    const UpdateDatabase = async (players, map) => {
        try {
            console.log(playerData);
            for (const player of players) {
                const playerAssassins = playerData[player]?.assassins || [];
                await updateTargetsForPlayer(player, map.get(player), roomID);
                await updateAssassinsForPlayer(player, playerAssassins, roomID);
                console.log(`Targets updated for ${player} in database: ${map.get(player)}`);
            }
        } 
        catch(error) {
            console.error("Error adding targets to database: ", error);
        }
    }
     
    //creates adjacency list with initial targets
    const InitializeTargets = () => {
        const playerList = randomizeArray([...arrayOfPlayers]);
        console.log("playerList created: ", playerList);
        const MAXTARGETS = arrayOfPlayers.length > 15 ? 3 : (arrayOfPlayers.length > 5 ? 2 : 1);
        const newTargetMap = new Map();
        const newPlayerData = {};
        for (let i = 0; i < arrayOfPlayers.length; i++) {
            const data = {
                numOfAssassins: 0, 
                lastTargetIndex: playerList.indexOf(arrayOfPlayers[i]), 
                prevTargets: [],
                assassins: []
            };
            newPlayerData[arrayOfPlayers[i]] = data;
        }
        console.log("newPlayerData initiated: ", newPlayerData);

        //loops through every player to assign targets
        for (let playerDex = 0; playerDex < arrayOfPlayers.length; playerDex++) {
            const currPlayer = playerList[playerDex];
            newTargetMap.set(currPlayer, []);
            
            //assigns MAXTARGETS targets to each player
            for (let targetCount = 0; targetCount < MAXTARGETS; targetCount++) {
                let targetIndex = (newPlayerData[currPlayer].lastTargetIndex + 1) % arrayOfPlayers.length;
                let target = playerList[targetIndex];
                const originalDex = targetIndex;
                //skips player if they already have MAXTARGETS targgets 
                //or if they are targeting themself
                while (newPlayerData[target].numOfAssassins === MAXTARGETS 
                       || target === currPlayer 
                       || newPlayerData[currPlayer].assassins.includes(target)) {
                    targetIndex = (targetIndex + 1) % arrayOfPlayers.length;
                    target = playerList[targetIndex];
                    console.log(`looping for ${currPlayer}`);
                    //stops loop if it loops through the full array
                    if (targetIndex === originalDex) {
                        console.log(`had to break for ${currPlayer}`);
                        break;
                    }
                }
                //assigns target to currPlayer
                newTargetMap.get(currPlayer).push(target);
                //assigns index of target to lastTargetIndex of currPlayer
                newPlayerData[currPlayer].lastTargetIndex = targetIndex;
                //assigns target to prevTargets list of currPlayer
                newPlayerData[currPlayer].prevTargets.push(target);
                //updates numOfAssassins by 1
                newPlayerData[target].numOfAssassins += 1;
                //assigns currPlayer as assassin to target
                newPlayerData[target].assassins.push(currPlayer);
                console.log(`assassins for ${target}: `,newPlayerData[target].assassins);
            }
        }
        console.log("newTargetMap created: ", newTargetMap);
        console.log("newPlayerData finalized: ", newPlayerData);
        setPlayerData(newPlayerData);
        setTargetMap(newTargetMap);
    }

    const tableOfPlayers = arrayOfPlayers.map(eachName => 
        <Tr key = {eachName}>
            <Td>{eachName}</Td>
            <Td>{targetMap.get(eachName)?.join(", ") || "no targets"}</Td>
        </Tr>
    );

    return (
        <div>
            <Button bg = 'red.500'
                    color = 'white'
                    variant = 'solid'
                    size = 'md'
                    borderRadius = '3xl'
                    _hover = {{bg: 'white', color: 'black'}}
                    onClick = {handleClick}
                    mr = '12px'

            >
                Reset Targets
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose = {onClose}
                size = '3xl'
            >

                <AlertDialogOverlay/>
                    <AlertDialogContent 
                        bg = '#202030'
                    >

                        <AlertDialogHeader color = 'red'>
                            WARNING
                        </AlertDialogHeader>

                        <AlertDialogBody>
                            This will hard reset the targets for alive players. 
                            The following will be the targets for each player:
                            <TableContainer>
                                <Table>
                                    <Thead>
                                        <Tr>
                                            <Th color = '#FFFFFF'>Player</Th>
                                            <Th color = '#FFFFFF'>Targets</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {tableOfPlayers}
                                    </Tbody>
                                </Table>
                            </TableContainer>
                        </AlertDialogBody>

                        <AlertDialogFooter>
                            <Button ref={cancelRef} onClick={onClose} colorScheme='red'>
                                Go Back
                            </Button>
                            <Button colorScheme='green' onClick= {onYesClose}>
                                Confirm
                            </Button>
                        </AlertDialogFooter>

                    </AlertDialogContent>
            </AlertDialog>

        </div>
    );
}
 
export default ResetTargetsButton;