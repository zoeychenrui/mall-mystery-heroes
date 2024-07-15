import React, { useState} from 'react';
import { Box, Tooltip } from '@chakra-ui/react';
import CreateAlert from './CreateAlert';
import kill from '../assets/kill-white.png';
import killHover from '../assets/kill-hover.png';
import { fetchPlayerForRoom, killPlayerForRoom, updatePointsForPlayer } from './dbCalls';

const KillButton = (props) => {
    const { roomID, assassinPlayerNamed, handleKillPlayer, selectedTarget, possibleTargets, getPossibleTargets } = props;
    const [isHovering, setIsHovering] = useState(false);
    const createAlert = CreateAlert();

    const handleKill = async () => {
        if (selectedTarget === '') {
            return createAlert('error', 'Error', 'Must Select Target', 1500);
        }

        console.log("The following player will be killed: ", selectedTarget);
        const targetDoc = await fetchPlayerForRoom(selectedTarget, roomID, createAlert);
        const targetData = targetDoc.data();
        await updatePointsForPlayer(assassinPlayerNamed, targetData.score, roomID);
        await killPlayerForRoom(selectedTarget, roomID);
        const targets = possibleTargets.filter(target => target !== selectedTarget);
        getPossibleTargets(targets);
        handleKillPlayer(selectedTarget, assassinPlayerNamed);
    };

    return (  
        <Box onMouseEnter = {() => setIsHovering(true)} 
             onMouseLeave = {() => setIsHovering(false)}
             w = '54px'
             h = '50px'
             display = 'flex'
             justifyContent = 'center'
             alignItems = 'center'
             ml = '16px'
             mr = '16px'
        >
            <Tooltip label = 'Kill Player'>
            <img 
                        src={isHovering ? killHover : kill} 
                        alt="Kill Button" 
                        onClick={handleKill} 
                        style={{ cursor: 'pointer', width: '54px', height: '50px' }}
                />
            </Tooltip>
        </Box>
    );
}
 
export default KillButton;