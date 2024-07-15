import React, {useState} from 'react';
import { Flex, 
        Button, 
        Select
    } from '@chakra-ui/react';
import CreateAlert from './CreateAlert';
import { removePlayerForRoom } from './dbCalls';

//import {playerData} from './PlayerList';
const PlayerRemove = ({onPlayerRemoved, arrayOfPlayers, roomID}) => {
    const [selectedPlayer, setSelectedPlayer] = useState('');
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
        removePlayerForRoom(selectedPlayer, createAlert, roomID);
        if (onPlayerRemoved) {
            onPlayerRemoved(selectedPlayer);
        }
        console.log(`selected player removed successfully`);
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
                    {arrayOfPlayers.map((player, index) => (
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