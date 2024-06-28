import React, { useState, useEffect } from 'react';
import {
    ListItem,
    Box,
    VStack,
    List,
    Image
} from '@chakra-ui/react';
import { db } from '../utils/firebase';
import {
    orderBy,
    query,
    collection,
    where,
    onSnapshot,
} from "firebase/firestore";
import revive from '../assets/revive-gray.png';
import reviveHover from '../assets/revive-white.png';
import PlayerRevive from './PlayerRevive';
import DeadPlayerReviveButton from './DeadPlayerReviveButton';


const DeadPlayersList = ({roomID, handlePlayerRevive, arrayOfAlivePlayers}) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); // This takes us to the players folder

    // Construct a query that gets all players in the room that are still alive
    const playerAlivePlayersQuery = query(
        playerCollectionRef,
        where("isAlive", "==", false),
    );

    const [players, setPlayers] = useState([]); // array of player objects

    useEffect(() => {

        const unsubscribe = onSnapshot(playerAlivePlayersQuery, (snapshot) => {

            // Get the updated list of players from the snapshot
            const updatedPlayers = snapshot.docs.map((doc) => ({
                name: doc.data().name,
            }));

            console.log("updatedPlayers: ", updatedPlayers);

            setPlayers(updatedPlayers);
        });

        return () => unsubscribe();
    }, []); 

    if (players.length === 0) {
        return null;
    }
    
    return (
        <Box background = 'transparent' width = '100%' display = 'flex' flexDirection = 'column'>
            <List styleType = 'none' fontSize = '25px' width = '90%'>
                    {players.map((player) => (
                    <ListItem>
                        <Box display = 'flex' flexDirection = 'row' alignItems = 'center'>
                            <Box mt = '2px' mb = '2px' flex = '1' textAlign = 'center'>
                                {player.name}
                            </Box>

                            <DeadPlayerReviveButton
                                player = {player}
                                roomID = {roomID}
                                handlePlayerRevive = {handlePlayerRevive}
                                arrayOfAlivePlayers = {arrayOfAlivePlayers}
                            />
                        </Box>
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

export default DeadPlayersList;
