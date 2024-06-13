import React, { useState } from 'react';
import { Flex, Button, Select, Box, Alert, AlertIcon, AlertTitle, AlertDescription } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { query, updateDoc, collection, getDocs, where } from "firebase/firestore";
import RemapPlayers from './RemapPlayers';

const KillButton = (props) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const [showAlert, setShowAlert] = useState(false); // State to control the alert visibility

    const roomID = props.roomID;
    const playerData = props.arrayOfPlayers;
    const onPlayerKilled = props.onPlayerKilled;
    const handleRemapping = RemapPlayers();

    // Define a function to handle changes to the select element
    const handleChange = (event) => {
        setSelectedPlayer(event.target.value);
        setShowAlert(false); // Hide alert when a player is selected
    };

    const handleKillPlayer = async () => {
        if (selectedPlayer === '') { // Check if a player has been selected
            setShowAlert(true); // Show alert if no player is selected
            return;
        }

        // Create a reference to the 'players' subcollection in the specified room
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); // This takes us to the players folder
        const playerQuery = query(playerCollectionRef, where('name', '==', selectedPlayer)); // get the players with this name

        try {
            const querySnapshot = await getDocs(playerQuery); // Fetch the documents that match the query
            const playerdoc = querySnapshot.docs[0].ref;
            const playerData = querySnapshot.docs[0].data();
            console.log(`assasins: ${playerData.assassins}`);
            const prevAssassins = playerData.assassins; //stores player's prev assassins
            const prevTargets = playerData.targets; //stores player's prev targets
            console.log(`prevTargets: ${prevTargets}`);
            console.log(`prevAssassins: ${prevAssassins}`);
            
            for (let i = 0; i < playerData.assassins.length; i++) {
                let tempPlayer = playerData.assassins[i];
                console.log(`tempPlayer: ${tempPlayer}`);
                const newQuery = query(playerCollectionRef, where('name', '==', tempPlayer)); // get the players with this name
                const newSnapshot = await getDocs(newQuery); // Fetch the documents that match the query
                const targetArray = [...newSnapshot.docs[0].data().targets];
                const index = targetArray.indexOf(selectedPlayer);
                const spliced = targetArray.slice();
                spliced.splice(index, 1);
                console.log(spliced);
                await updateDoc(newSnapshot.docs[0].ref, {
                    targets: spliced,
                });
            }
            for (let i = 0; i < playerData.targets.length; i++) {
                let tempPlayer = playerData.targets[i];//a
                const newQuery = query(playerCollectionRef, where('name', '==', tempPlayer)); // get the players with this name
                const newSnapshot = await getDocs(newQuery); // Fetch the documents that match the query
                const targetArray = [...newSnapshot.docs[0].data().assassins];
                console.log(`targetArray: ${targetArray}`);
                const index = targetArray.indexOf(selectedPlayer);
                const spliced = targetArray.slice();
                spliced.splice(index, 1);
                console.log(spliced);
                await updateDoc(newSnapshot.docs[0].ref, {
                    assassins: spliced,
                });
            }

            props.killedPlayerPoints(playerData.score);
            await updateDoc(playerdoc, { 
                score: 0,
                isAlive: false,
                targets: [],
                assassins: []
            });
            onPlayerKilled(selectedPlayer);
            console.log(`checkpoint reached 1`);
            await handleRemapping(prevAssassins, prevTargets, props.arrayOfAlivePlayers, roomID); //remaps targets and assassins
        } catch (error) {
            console.error('Error fetching player documents:', error);
        }
    }

    return (
        <form>
            <Flex padding='10px' direction="column" align="center">
                {showAlert && (
                    <Box mb={4} width="100%">
                        <Alert status="error">
                            <AlertIcon />
                            <AlertTitle>Please select a player</AlertTitle>
                            <AlertDescription>You need to choose a player to proceed.</AlertDescription>
                        </Alert>
                    </Box>
                )}
                <Flex width="100%" justifyContent="center">
                    <Select placeholder='Select player to Kill'
                        value={selectedPlayer}
                        onChange={handleChange}>
                        {playerData.map((player, index) => (
                            <option key={index} value={player}>
                                {player}
                            </option>
                        ))}
                    </Select>
                    <Button onClick={handleKillPlayer}
                        colorScheme='red'
                        size='lg'
                        ml={3}>
                        Kill
                    </Button>
                </Flex>
            </Flex>
        </form>
    );
};
export default KillButton;
