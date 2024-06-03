import React, { useState } from 'react';
import {Button,
        Select,
        Flex,
        Box,
        Alert,
        AlertIcon,
        AlertTitle,
        AlertDescription,
    } from '@chakra-ui/react';
import { updateDoc } from 'firebase/firestore';
import {db} from '../utils/firebase';
import {collection, 
        query,  
        where, 
        getDocs 
    } from "firebase/firestore";
const PlayerRevive = (props) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const [showAlert, setShowAlert] = useState(false); // State to control the alert visibility
    const roomID = props.roomID;
    const [ErrorMessage, setErrorMessage] = useState('');
    const arrayOfDeadPlayers = props.arrayOfDeadPlayers;

    const handleChange = (event) => {
        setSelectedPlayer(event.target.value);
    }

    const handleRevivePlayer = async () => {   
        if (selectedPlayer === '') {
            setShowAlert(true);
            setErrorMessage("Please select a player to revive.");
            return;
        }
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', selectedPlayer));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { isAlive: true });
        props.onPlayerRevived(selectedPlayer);
    }

    return (  
        <Flex>
            {showAlert && (
                <Box mb={4} width="100%">
                    <Alert status="error">
                        <AlertIcon />
                        <AlertTitle>Error: </AlertTitle>
                        <AlertDescription>{ErrorMessage}</AlertDescription>
                    </Alert>
                </Box>
            )}
            <Select placeholder='Select player to revive'
                    onChange={handleChange}
                    value={selectedPlayer}>
                {arrayOfDeadPlayers.map((player, index) => (
                    <option key={index} value={player}>{player}</option>
                ))}
            </Select>
            <Button onClick={handleRevivePlayer}
                    colorScheme='green'
                    size='lg'
                    ml={3}>
                Revive
            </Button>
        </Flex>
    );
}
 
export default PlayerRevive;