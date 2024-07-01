import React, { useState } from 'react';
import { Image, Box} from '@chakra-ui/react';
import revive from '../assets/revive-gray.png';
import reviveHover from '../assets/revive-white.png';
import PlayerRevive from './PlayerRevive';

const DeadPlayerReviveButton = ({player, roomID, arrayOfAlivePlayers, handlePlayerRevive}) => {
    const [isHovering, setIsHovering] = useState(false);
    const revivePlayer = PlayerRevive();

    const handleReviveClicked = async (player) => {
        await revivePlayer(player, roomID, arrayOfAlivePlayers);
        handlePlayerRevive(player);
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