import React, { useState } from 'react';
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
        VStack,
        Divider,
        Text
    } from '@chakra-ui/react';
import mission from '../assets/mission.png';
import kill from '../assets/kill.png';
import openseason from '../assets/openseason.png';
import TaskCompletion from './TaskCompletion';
import KillActionExecution from './KillActionExecution';
    
const Execution = (props) => {
    const { roomID, 
            arrayOfAlivePlayers, 
            handleKillPlayer, 
            handlePlayerRevive, 
            arrayOfTasks, 
            handleTaskCompleted, 
            completedTasks, 
            handleUndoRevive,
            handleRemapping
        } = props;
    const [action, setAction] = useState('completeKill');

    const handleActionChange = (actionType) => {
        setAction(actionType);
    }

    return (
        <VStack  h = '100%'>
            <Menu>
                <HStack>
                    <Heading    
                        size = 'md'
                        mr = '10px'
                    >
                        {action === 'completeKill' ? 'Kill' : 
                         action === 'completeMission' ? 'Complete Mission' : 
                         'Open Season'
                        }
                    </Heading>
                    <MenuButton 
                        as = {Button} 
                    >
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
                <Divider />
                
                <MenuList
                    color = 'black'
                >
                    <MenuItem 
                        onClick = {() => handleActionChange('completeKill')}
                    >
                        <Tooltip label = 'Kill'>
                            <Image boxSize = '24px'
                                   objectFit = 'cover'
                                   src = {kill}
                                   alt = 'Kill'
                                   mr = '16px'
                            />
                        </Tooltip> 
                        <Text fontSize = 'md'>
                            Assassinate
                        </Text>
                    </MenuItem>

                    <MenuItem onClick = {() => handleActionChange('completeMission')}>
                        <Tooltip label = 'Complete Mission'>
                            <Image boxSize = '24px'
                                   objectFit = 'cover'
                                   src = {mission}
                                   alt = 'Complete Mission'
                                   mr = '16px'
                            />
                        </Tooltip>
                        <Text fontSize = 'md'>
                            Complete Mission
                        </Text>
                    </MenuItem>

                    <MenuItem onClick = {() => handleActionChange('openSeason')}>
                        <Tooltip label = 'OpenSeason'>
                            <Image boxSize = '24px'     
                                   objectFit = 'cover'
                                   src = {openseason}
                                   alt = 'Open Season'
                                   mr = '16px'
                            />
                        </Tooltip>
                        <Text fontSize = 'md'>
                            Open Season
                        </Text>
                    </MenuItem>
                </MenuList> 
            </Menu> 

            {action === 'completeKill' && 
                <Flex
                    justifyContent = 'center'
                    alignItems = 'center'
                    h = '100%'
                >
                    <KillActionExecution 
                        roomID = {roomID}
                        arrayOfAlivePlayers = {arrayOfAlivePlayers}
                        handleKillPlayer = {handleKillPlayer}
                    />
                </Flex>
            }
            {action === 'completeMission' && 
                <Flex 
                    h = '100%'
                >
                    <TaskCompletion 
                        roomID = {roomID}
                        handlePlayerRevive = {handlePlayerRevive}
                        handleUndoRevive = {handleUndoRevive}
                        arrayOfAlivePlayers = {arrayOfAlivePlayers}
                        arrayOfTasks = {arrayOfTasks}
                        handleTaskCompleted = {handleTaskCompleted}
                        completedTasks = {completedTasks}
                        handleRemapping = {handleRemapping}
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