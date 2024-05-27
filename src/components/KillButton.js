import React, {useState} from 'react';
import { Flex, 
        Button, 
        Select,
         } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import {query,  
        updateDoc,
        collection,
        getDocs,
        where
        } from "firebase/firestore"; 

   
const KillButton = (props) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const roomID = props.roomID;
    const playerData = props.arrayOfPlayers;
    const onPlayerKilled = props.onPlayerKilled;
    
   // Define a function to handle changes to the select element
    const handleChange = (event) => {
        setSelectedPlayer(event.target.value);
    };
    
    const handleKillPlayer = async () => {
        if (selectedPlayer === '') { // Check if a player has been selected
            console.log('Please select a player!!!');
            return;
        };
        // Create a reference to the 'players' subcollection in the specified room
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //This takes us to the players folder
        const playerQuery = query(playerCollectionRef, where('name', '==', selectedPlayer)); // get the players with this name

        try {
            const querySnapshot = await getDocs(playerQuery); // Fetch the documents that match the query
            const playerdoc = querySnapshot.docs[0].ref;
            const playerData = querySnapshot.docs[0].data();
            props.killedPlayerPoints(playerData.score);
            await updateDoc(playerdoc, {score: 0});
            await updateDoc(playerdoc, {isAlive: false});
            props.onPlayerKilled(selectedPlayer);
        } catch (error) {
            console.error('Error fetching player documents:', error);
        }
    }

    return (
        
        <form>
                <Flex padding='10px'>
                    <Select placeholder = 'Select player to Kill'
                            value = {selectedPlayer}
                            onChange = {handleChange}>
                        <option key = '' value = ''></option>
                        {playerData.map((player, index) => (
                            <option key = {index} 
                                    value = {player} >
                                        {player}
                            </option>
                        ))}
                    </Select>
                    <Button onClick={handleKillPlayer}
                        colorScheme='red'
                        size = 'lg'>
                    Kill
                    </Button>
                </Flex> 
        </form>
    );
};
export default KillButton;