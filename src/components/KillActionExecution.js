import React, { useState } from 'react';
import AssassinSelection from "./AssassinsSelection";
import KillButton from "./KillButton";
import TargetSelection from "./TargetSelection";
import { Box, Flex } from '@chakra-ui/react';

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
        <Flex
            direction = 'row'
            justifyContent = 'center'
            alignItems = 'center'
        >
            <Flex
                w = '30%'
            >
                <AssassinSelection
                    roomID = {roomID}
                    getAssassinPlayerName = {getAssassinPlayerName}
                    arrayOfAlivePlayers = {arrayOfAlivePlayers} 
                    getPossibleTargets = {getPossibleTargets}
                />
            </Flex>
            <Flex>
                <KillButton 
                    assassinPlayerNamed = {assassinPlayerNamed}
                    selectedTarget = {selectedTarget}
                    handleKillPlayer = {handleKillPlayer}
                    possibleTargets = {possibleTargets}
                    roomID = {roomID}
                    getPossibleTargets = {getPossibleTargets}
                />
            </Flex>
            <Flex>
                <TargetSelection
                    possibleTargets = {possibleTargets}
                    getSelectedTarget = {getSelectedTarget}
                    selectedTarget = {selectedTarget}
                />
            </Flex>
        </Flex>
    );
}
 
export default KillActionExecution;