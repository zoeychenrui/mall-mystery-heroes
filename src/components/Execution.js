import React, { useState } from 'react';
import AssassinSelection from './AssassinsSelection';
import KillButton from './KillButton';
import { Menu, 
        MenuButton,
        MenuList, 
        MenuItem, 
        Button, 
        Image,
        HStack,
        Tooltip,
        Flex,
        Heading,
        VStack
    } from '@chakra-ui/react';
import mission from '../assets/mission.png';
import kill from '../assets/kill.png';
import openseason from '../assets/openseason.png';
import TaskCompletion from './TaskCompletion';
    
const Execution = ({ roomID, arrayOfAlivePlayers, handleKillPlayer }) => {
    const [assassinPlayerNamed, setAssassinPlayerNamed] = useState('');
    const [action, setAction] = useState('completeKill');

    const handleActionChange = (actionType) => {
        setAction(actionType);
    }
    const getAssassinPlayerName = (assassinName) => {
        setAssassinPlayerNamed(assassinName);
    };

    return (
        <VStack>
            <Menu>
                <HStack>
                    <Heading size = 'md'>Action</Heading>
                    <MenuButton as = {Button} >
                        {action === 'completeKill' && 
                            <Image
                                boxSize = '24px'
                                objectFit = 'cover'
                                src = {kill}
                                alt = 'Kill'
                            />
                        }
                        {action === 'completeMission' &&
                            <Image
                                boxSize = '24px'
                                objectFit = 'cover'
                                src = {mission}
                                alt = 'Complete Mission'
                            />
                        }
                        {action === 'openSeason' && 
                            <Image
                                boxSize = '24px'
                                objectFit = 'cover'
                                src = {openseason}
                                alt = 'Open Season'
                            />
                        }
                    </MenuButton>
                </HStack>
                
                <MenuList>
                    <MenuItem onClick = {() => handleActionChange('completeKill')}>
                        <Tooltip label = 'Kill'>
                            <Image boxSize = '24px'
                                   objectFit = 'cover'
                                   src = {kill}
                                   alt = 'Kill'
                            />
                        </Tooltip>
                    </MenuItem>

                    <MenuItem onClick = {() => handleActionChange('completeMission')}>
                        <Tooltip label = 'Complete Mission'>
                            <Image boxSize = '24px'
                                   objectFit = 'cover'
                                   src = {mission}
                                   alt = 'Complete Mission'
                            />
                        </Tooltip>
                    </MenuItem>

                    <MenuItem onClick = {() => handleActionChange('openSeason')}>
                        <Tooltip label = 'OpenSeason'>
                            <Image boxSize = '24px'     
                                   objectFit = 'cover'
                                   src = {openseason}
                                   alt = 'Open Season'
                            />
                        </Tooltip>
                    </MenuItem>
                </MenuList> 
            </Menu> 

            {action === 'completeKill' && 
                <Flex>
                    <AssassinSelection
                        roomID = {roomID}
                        getAssassinPlayerName = {getAssassinPlayerName}
                        arrayOfAlivePlayers = {arrayOfAlivePlayers}
                    />
                    <KillButton
                        roomID = {roomID}
                        onPlayerKilled = {handleKillPlayer}
                        assassinPlayerNamed = {assassinPlayerNamed}
                    />
                </Flex>
            }
            {action === 'completeMission' && 
                <Flex>
                    <TaskCompletion 
                        roomID = {roomID}
                    />
                </Flex>
            }
            {action === 'openSeason' && 
                <Flex></Flex>
            }
        </VStack>
    );
};

export default Execution;