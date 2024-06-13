import React, { useState } from 'react';
import {Button,
        Select,
        Flex
    } from '@chakra-ui/react';
import {db} from '../utils/firebase';
import {collection, 
        query,  
        where, 
        getDocs,
        updateDoc
    } from "firebase/firestore";
import CreateAlert from './CreateAlert';
import RemapPlayers from './RemapPlayers';

const PlayerRevive = (props) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
    const roomID = props.roomID;
    const arrayOfDeadPlayers = props.arrayOfDeadPlayers;
    const createAlert = CreateAlert();

    const handleChange = (event) => {
        setSelectedPlayer(event.target.value);
    }

    const handleRevivePlayer = async () => {   
        if (selectedPlayer === '') {
            return createAlert('error', 'Error', 'Please select a player to revive', 1500);
        }
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', selectedPlayer));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { isAlive: true });
        await props.onPlayerRevived(selectedPlayer);
        const handleRegeneration = RemapPlayers();
        await handleRegeneration(selectedPlayer, selectedPlayer, props.arrayOfAlivePlayers, roomID);
        setSelectedPlayer('');
    }

    

    return (  
        <Flex>
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