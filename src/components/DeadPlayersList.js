import React, { useContext } from 'react';
import {
    ListItem,
    Box,
    List,
} from '@chakra-ui/react';

import DeadPlayerReviveButton from './DeadPlayerReviveButton';
import { deadPlayerListContext } from './Contexts';


const DeadPlayersList = () => {
    const { arrayOfDeadPlayers } = useContext(deadPlayerListContext);
    if (arrayOfDeadPlayers.length === 0) return null;

    return (
        <Box background = 'transparent' width = '100%' display = 'flex' flexDirection = 'column'>
            <List styleType = 'none' fontSize = '25px' width = '90%'>
                    {arrayOfDeadPlayers.map((player, index) => (
                    <ListItem key = {index}>
                        <Box display = 'flex' flexDirection = 'row' alignItems = 'center'>
                            <Box mt = '2px' mb = '2px' flex = '1' textAlign = 'center'>
                                {player}
                            </Box>

                            <DeadPlayerReviveButton player = {player} />
                        </Box>
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

export default DeadPlayersList;
