import React, { useContext, useState} from 'react';
import { Box, Tooltip } from '@chakra-ui/react';
import CreateAlert from './CreateAlert';
import kill from '../assets/kill-white.png';
import killHover from '../assets/kill-hover.png';
import { fetchPlayerForRoom, 
         killPlayerForRoom, 
         updatePointsForPlayer,
         checkOpenSzn
    } from './dbCalls';
import RemapPlayers from './RemapPlayers';
import { executionContext, gameContext } from './Contexts';

const KillButton = (props) => {
    const { assassinPlayerNamed, 
            selectedTarget, 
            possibleTargets, 
            getPossibleTargets, 
            handleChoiceReset
        } = props;
    const { roomID } = useContext(gameContext);
    const { arrayOfAlivePlayers, 
            handleKillPlayer,
            handleAddNewAssassins,
            handleAddNewTargets,
            handleRemapping,
            handleSetShowMessageToTrue
        } = useContext(executionContext);
    const [isHovering, setIsHovering] = useState(false);
    const createAlert = CreateAlert();
    const handleRegeneration = RemapPlayers(handleRemapping, createAlert);

    const handleRemap = async (playersNeedingTargets, playersNeedingAssassins) => {
        const alivePlayersWithoutSelected = arrayOfAlivePlayers.filter(player => player !== selectedTarget);
        const [targets, assassins] = await handleRegeneration(playersNeedingTargets, playersNeedingAssassins, alivePlayersWithoutSelected, roomID);
        handleAddNewAssassins(assassins);
        handleAddNewTargets(targets);
        handleSetShowMessageToTrue();
    }

    const handleKill = async () => {
        try {
            if (selectedTarget === '') {
                return createAlert('error', 'Error', 'Must Select Target', 1500);
            }

            console.log("The following player will be killed: ", selectedTarget);
            const targetDoc = await fetchPlayerForRoom(selectedTarget, roomID);
            const targetData = targetDoc.data();
            const playersNeedingTarget = targetData.assassins;
            const playersNeedingAssassins = targetData.targets;
            await updatePointsForPlayer(assassinPlayerNamed, targetData.score, roomID);
            const openSznstatus = await checkOpenSzn(roomID, selectedTarget);
            await killPlayerForRoom(selectedTarget, roomID);
            const targets = possibleTargets.filter(target => target !== selectedTarget);
            getPossibleTargets(targets);
            handleChoiceReset();
            handleKillPlayer(selectedTarget, assassinPlayerNamed, openSznstatus);
            handleRemap(playersNeedingTarget, playersNeedingAssassins);
        }
        catch (error) {
            console.log(error);
            createAlert('error', 'Error killing player', 'Check console', 1500);
        }
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