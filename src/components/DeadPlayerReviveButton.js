import React, { useContext, useState } from 'react';
import { Image, Box} from '@chakra-ui/react';
import revive from '../assets/revive-gray.png';
import reviveHover from '../assets/revive-white.png';
import CreateAlert from './CreateAlert';
import { updateIsAliveForPlayer } from './dbCalls';
import RemapPlayers from './RemapPlayers';
import { deadPlayerListContext, gameContext } from './Contexts';

const DeadPlayerReviveButton = ({ player }) => {
    const { roomID } = useContext(gameContext);
    const { handlePlayerRevive,
            arrayOfAlivePlayers,
            handleRemapping,
            handleAddNewTargets,
            handleAddNewAssassins,
            handleSetShowMessageToTrue
        } = useContext(deadPlayerListContext);

    const [isHovering, setIsHovering] = useState(false);
    const createAlert = CreateAlert();
    const handleRegeneration = RemapPlayers(handleRemapping, createAlert);

    //handling for when revive image for player is clicked
    const handleReviveClicked = async () => {
        if (player === '' || !player) {
            return createAlert('error', 'Error', 'player undefined', 1500);
        }
        console.log('Reviving player: ', player);
        //revives and remaps player
        await updateIsAliveForPlayer(player, true, roomID);
        const activePlayers = [...arrayOfAlivePlayers, player];
        const [target, assassin] = await handleRegeneration([player], [player], activePlayers, roomID);
        handleAddNewAssassins(assassin);
        handleAddNewTargets(target);
        handleSetShowMessageToTrue();
        handlePlayerRevive(player, createAlert);
    }


    return (
        <Box mt = '2px' 
             mb = '2px'
             onMouseEnter = {() => setIsHovering(true)} 
             onMouseLeave = {() => setIsHovering(false)}
        >            
            <Image 
                src = {isHovering ? reviveHover : revive}
                alt = 'Revive Player'
                cursor = 'pointer'
                onClick = {handleReviveClicked}
                width = '30px'
                height = '30px'
            />  
        </Box>
    );
}
 
export default DeadPlayerReviveButton;