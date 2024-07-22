import React, { useState } from 'react';
import { Image, Box} from '@chakra-ui/react';
import revive from '../assets/revive-gray.png';
import reviveHover from '../assets/revive-white.png';
import CreateAlert from './CreateAlert';
import { updateIsAliveForPlayer } from './dbCalls';
import RemapPlayers from './RemapPlayers';

const DeadPlayerReviveButton = (props) => {
    const {player, 
           roomID, 
           arrayOfAlivePlayers, 
           handlePlayerRevive, 
           handleRemapping,
           handleAddNewTargets,
           handleAddNewAssassins,
           handleSetShowMessageToTrue
        } = props;
    const [isHovering, setIsHovering] = useState(false);
    const createAlert = CreateAlert();
    const handleRegeneration = RemapPlayers(handleRemapping, createAlert);

    //handling for when revive image for player is clicked
    const handleReviveClicked = async () => {
        if (player === '' || !player) {
            return createAlert('error', 'Error', 'Error: player undefined', 1500);
        }
        console.log('Reviving player: ', player);
        //revives and remaps player
        await updateIsAliveForPlayer(player, true, roomID);
        const [target, assassin] = await handleRegeneration(player, player, arrayOfAlivePlayers, roomID);
        handleAddNewAssassins(assassin);
        handleAddNewTargets(target);
        handleSetShowMessageToTrue();
        handlePlayerRevive(player, createAlert);
    }


    return (
        <Box mt = '2px' mb = '2px' onMouseEnter = {() => setIsHovering(true)} 
             onMouseLeave = {() => setIsHovering(false)}
        >            
            <Image 
                src = {isHovering ? reviveHover : revive}
                alt = 'Revive Player'
                cursor = 'pointer'
                onClick = {() => handleReviveClicked(player.name)}
                width = '30px'
                height = '30px'
            />  
        </Box>
    );
}
 
export default DeadPlayerReviveButton;