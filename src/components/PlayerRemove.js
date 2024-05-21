import React, {useState, useEffect} from 'react';
import { Flex, 
        Button, 
        Select,
        Box,
        Alert,
        AlertIcon,
        AlertTitle,
        AlertDescription,
        CloseButton,
        option } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, 
        deleteDoc, 
        query, 
        where, 
        getDocs,
        addDoc,
        onSnapshot} from "firebase/firestore"; 

//import {playerData} from './PlayerList';
const PlayerRemove = (props) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const roomID = props.roomID;
    const [showAlert, setShowAlert] = useState(false); //defines state of alert showing
    const [error, setError] = useState(''); //defines the message for error
    const onPlayerRemoved = props.onPlayerRemoved;
    const playerData = props.arrayOfPlayers;

    //closes Alert
    const onClose = () => {
        setShowAlert(false);
    }
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
            setError('must select player');
            setShowAlert(true);
            return;
        }

        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where ('name', '==', selectedPlayer));
        const snapshot = await getDocs(playerQuery);
        
        if (snapshot.empty) {
            console.error("Player not found");
            setError('Player not found');
            setShowAlert(true);
            return;
        }

        const docRef = snapshot.docs[0].ref; //ref to player selected

        try {
            const playerRefSnapshot = await getDocs(playerCollectionRef);
            //adds blank doc if only one player exists. 
            //required so players subcollection can exist after deleting all players. Safety Measure.
            if (playerRefSnapshot == 1) {
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
            setError('error removing player. Check console for more details.');
            setShowAlert(true);
        }
    }
     
         
    return (  
        <div>    
            {showAlert && (
            <Alert status='error'>
                <Box>
                    <AlertIcon/>
                    <AlertTitle>Error: </AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Box>
                <CloseButton alignSelf='flex-start'
                            position='relative'
                            right={-1}
                            top={-1}
                            onClick={onClose}/>
            </Alert>
            )}
            <form onSubmit={handleSubmit}>
                <Flex padding='10px'>
                    <Select playceholder = 'Select player to remove'
                            value = {selectedPlayer}
                            onChange = {handleChange}
                            size = 'lg'>
                        <option key = '' value = ''></option>

                        {playerData.map((player, index) => (
                            <option key = {index} 
                                    value = {player} >
                                        {player}
                            </option>
                        ))}
                    </Select>
                    <Button onClick={handleRemovePlayer} 
                            colorScheme='blue'
                            size = 'lg'>
                        Remove
                    </Button>
                </Flex> 
            </form>
        </div>
    );
}
 
export default PlayerRemove;