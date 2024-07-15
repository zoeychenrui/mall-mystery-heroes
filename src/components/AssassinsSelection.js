import React, { useState } from 'react';
import { Flex, Select } from '@chakra-ui/react';
import { fetchTargetsForPlayer } from './dbCalls';
import CreateAlert from './CreateAlert';

const AssassinSelection = (props) => {
    const { roomID, getAssassinPlayerName, arrayOfAlivePlayers, getPossibleTargets } = props;
    const [selectedAssassin, setSelectedAssassin] = useState('');
    const createAlert = CreateAlert();

    const handleChange = async (event) => {
        const newAssassin = event.target.value;
        setSelectedAssassin(newAssassin);
        getAssassinPlayerName(newAssassin);
        const targetList = await fetchTargetsForPlayer(newAssassin, roomID, createAlert);
        getPossibleTargets(targetList);
    };

    return (
        <Flex w = '100%' 
        >
            <Select 
                id='assassin'
                placeholder='Select Assassin'
                value={selectedAssassin}
                onChange={handleChange}
                w = '100%'
            >
                {arrayOfAlivePlayers.map((player, index) => (
                    <option key={index} value={player}>
                        {player}
                    </option>
                ))}
            </Select>
        </Flex>
    );
};

export default AssassinSelection;