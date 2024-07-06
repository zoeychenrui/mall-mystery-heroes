import React, { useState } from 'react';
import AssassinSelection from "./AssassinsSelection";
import KillButton from "./KillButton";
import TargetSelection from "./TargetSelection";
import { Box, HStack } from '@chakra-ui/react';

const KillActionExecution = ({ roomID, arrayOfAlivePlayers, handleKillPlayer }) => {
    const [assassinPlayerNamed, setAssassinPlayerNamed] = useState('');
    const [possibleTargets, setPossibleTargets] = useState([]);
    const [selectedTarget, setSelectedTarget] = useState('');

    const getAssassinPlayerName = (assassinName) => {
        setAssassinPlayerNamed(assassinName);
        console.log('assassin name: ', assassinName);
    };

    const getPossibleTargets = (targets) => {
        setPossibleTargets(targets);
    }

    const getSelectedTarget = (target) => {
        setSelectedTarget(target);
        console.log('selected target: ', target);
    }

    return (  
        <Box
            display = 'flex'
            flexDirection = 'row'
            justifyContent = 'center'
            alignItems = 'center'
        >
            <Box>
                <AssassinSelection
                    roomID = {roomID}
                    getAssassinPlayerName = {getAssassinPlayerName}
                    arrayOfAlivePlayers = {arrayOfAlivePlayers} 
                    getPossibleTargets = {getPossibleTargets}
                />
            </Box>
            <Box>
                <KillButton 
                    assassinPlayerNamed = {assassinPlayerNamed}
                    selectedTarget = {selectedTarget}
                    handleKillPlayer = {handleKillPlayer}
                    possibleTargets = {possibleTargets}
                    roomID = {roomID}
                    getPossibleTargets = {getPossibleTargets}
                />
            </Box>
            <Box>
                <TargetSelection
                    possibleTargets = {possibleTargets}
                    getSelectedTarget = {getSelectedTarget}
                    selectedTargetPlayer = {selectedTarget}
                />
            </Box>
        </Box>
    );
}
 
export default KillActionExecution;