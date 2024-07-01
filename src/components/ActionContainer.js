import React, { useState } from 'react';
import { Box,
        Image,
        Menu,
        MenuButton,
        MenuList,
        MenuItem,
        Button,
        Tooltip,
        Flex
    } from '@chakra-ui/react';
import mission from './assets/mission.png';
import kill from './assets/kill.png';
import openseason from './assets/openseason.png';


const ActionContainer = () => {
    const [action, setAction] = useState('completeKill');

    const handleActionChange = (actionType) => {
        setAction(actionType);
    }

    return (  
        <Box
            mawW = 'lg'
            borderWidth = '1px'
            borderRadius = 'lg'
            overflow = 'hidden'
        >   
            {action === 'completeKill' && <Flex></Flex>}
            {action === 'completeMission' && <Flex></Flex>}
            {action === 'openSeason' && <Flex></Flex>}
            
            <Menu>
                <MenuButton as = {Button}>
                    {action === 'completeKill' && <Image
                        boxSize = '24px'
                        objectFit = 'cover'
                        src = {kill}
                        alt = 'Kill'
                    />}
                    {action === 'completeMission' && <Image
                        boxSize = '24px'
                        objectFit = 'cover'
                        src = {mission}
                        alt = 'Mission Completion'
                    />}
                    {action === 'openSeason' && <Image
                        boxSize = '24px'
                        objectFit = 'cover'
                        src = {openseason}
                        alt = 'Open Season'
                    />}
                </MenuButton>

                <MenuList>
                    <MenuItem onClick = {() => handleActionChange('completeKill')}>
                        <Tooltip label = 'Kill'>
                            <Image
                                boxSize = '24px'
                                objectFit = 'cover'
                                src = {kill}
                                alt = 'Kill'
                            />
                        </Tooltip>
                    </MenuItem>
                    <MenuItem onClick = {() => handleActionChange('completeMission')}>
                        <Tooltip label = 'Complete Mission'>
                            <Image
                                boxSize = '24px'
                                objectFit = 'cover'
                                src = {mission}
                                alt = 'Complete Mission'
                            />
                        </Tooltip>
                    </MenuItem>
                    <MenuItem onClick = {() => handleActionChange('openSeason')}>
                        <Tooltip label = 'OpenSeason'>
                            <Image
                                boxSize = '24px'
                                objectFit = 'cover'
                                src = {openseason}
                                alt = 'Open Season'
                            />
                        </Tooltip>
                    </MenuItem>
                </MenuList>
            </Menu>
        </Box>
    );
}
 
export default ActionContainer;