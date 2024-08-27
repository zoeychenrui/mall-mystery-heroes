import React, { useContext } from 'react';
import { Flex, Select } from '@chakra-ui/react';
import { fetchTargetsForPlayer } from './dbCalls';
import CreateAlert from './CreateAlert';
import { executionContext, gameContext } from './Contexts';

const AssassinSelection = (props) => {
    const { getAssassinPlayerName, 
            getPossibleTargets, 
            assassinPlayerNamed, 
            getSelectedTarget 
        } = props;
    const { arrayOfAlivePlayers } = useContext(executionContext);
    const { roomID } = useContext(gameContext);
    const createAlert = CreateAlert();

    const handleChange = async (event) => {
        const newAssassin = event.target.value;
        if (newAssassin === '') {
            getAssassinPlayerName('');
            getPossibleTargets([]);
            return;
        }
        getAssassinPlayerName(newAssassin);
        getSelectedTarget('');
        const targetList = await fetchTargetsForPlayer(newAssassin, roomID, createAlert);
        getPossibleTargets(targetList);
    };

    return (
        <Flex w = '100%' 
        >
            <Select 
                id='assassin'
                placeholder='Select Assassin'
                value={assassinPlayerNamed}
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