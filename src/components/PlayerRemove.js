import React, {useState} from 'react';
import { Flex, 
        Button, 
        Select
    } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, 
        deleteDoc, 
        query, 
        where, 
        getDocs,
        addDoc,
    } from "firebase/firestore"; 
import CreateAlert from './CreateAlert';

//import {playerData} from './PlayerList';
const PlayerRemove = (props) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const roomID = props.roomID;
    const onPlayerRemoved = props.onPlayerRemoved;
    const playerData = props.arrayOfPlayers;
    const createAlert = CreateAlert();

    //allows for pressing enter
    const handleSubmit = () => {
        handleRemovePlayer();
    }

    //updates selected player
    const handleChange = (event) => {
        setSelectedPlayer(event.target.value);
    }
     
    //deletes player in database
    const handleRemovePlayer = async () => {
        //checks if any player is selected
        if (selectedPlayer === '') {
            return createAlert('error', 'Error', 'must select player', 1500);
        }

        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where ('name', '==', selectedPlayer));
        const snapshot = await getDocs(playerQuery);
        
        if (snapshot.empty) {
            return createAlert('error', 'Error', 'player does not exist', 1500);
        }

        const docRef = snapshot.docs[0].ref; //ref to player selected

        try {
            const playerRefSnapshot = await getDocs(playerCollectionRef);
            //adds blank doc if only one player exists. 
            //required so players subcollection can exist after deleting all players. Safety Measure.
            if (playerRefSnapshot === 1) {
                addDoc(playerCollectionRef, {});
            }
            //deletes player's document from database
            await deleteDoc(docRef);
            if (onPlayerRemoved) {
                onPlayerRemoved(selectedPlayer);
            }
            console.log(`selected player removed successfully`);
            
        }
        catch(error) {
            console.error("error removing player: ", error);
            createAlert('error', 'Error', 'error removing player. Check console.', 1500);
        }
    }
     
         
    return (  
        <form onSubmit={handleSubmit}>
            <Flex 
            >
                <Select 
                    placeholder = 'Select player to remove'
                    value = {selectedPlayer}
                    onChange = {handleChange}
                    size = 'lg'
                    mr = '6px'
                    borderRadius = '3xl'
                >
                    <option key = '' value = ''></option>
 
                    {playerData.map((player, index) => (
                        <option 
                            key = {index} 
                            value = {player} 
                        >
                            {player}
                        </option>
                    ))}
                </Select>
                <Button 
                    onClick={handleRemovePlayer} 
                    colorScheme='blue'
                    size = 'lg'
                    borderRadius = '3xl'
                >
                    Remove
                </Button>
            </Flex> 
        </form>
    );
}
 
export default PlayerRemove;