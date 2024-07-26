import React from 'react';
import { useState, useEffect } from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, 
         useLocation } from 'react-router-dom';
import DeadPlayersList from '../components/DeadPlayersList';
import { HStack,   
         Heading,
         VStack,
         Box,
         Divider,
    } from '@chakra-ui/react';
import Execution from '../components/Execution';
import TaskExecution from '../components/TaskExecution';
import HeaderExecution from '../components/HeaderExecution';
import Log from '../components/Log';
import UnmapPlayers from '../components/UnmapPlayers';
import { fetchPlayersByStatusForRoom, 
         fetchAllTasksForRoom, 
         fetchAllLogsForRoom, 
         updateLogsForRoom,
    } from '../components/dbCalls';
import RemapPlayerModal from '../components/RemapPlayerModal';

const GameMasterView = () => {
    const { roomID } = useParams(); 
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const [arrayOfDeadPlayers, setArrayOfDeadPlayers] = useState([]);
    const [arrayOfAlivePlayers, setArrayOfAlivePlayers] = useState([]);
    const [arrayOfTasks, setArrayOfTasks] = useState([]);    
    const [completedTasks, setCompletedTasks] = useState([]);
    const [logList, setLogList] = useState([]);
    const unmapPlayers = UnmapPlayers();
    const [newTargets, setNewTargets] = useState({});
    const [newAssassins, setNewAssassins] = useState({});
    const [showRemapModal, setShowRemapModal] = useState(false);

    //updates arrayOfAlivePlayers, arrayOfDeadPlayers, logs, and arrayOfTasks when roomID is updated
    useEffect (() => {
        const fetchPlayers = async () => {
            console.log(`fetching players and tasks in useEffect: ${roomID}`);
            const deadPlayers = await fetchPlayersByStatusForRoom(false, roomID);
            setArrayOfDeadPlayers(deadPlayers);
            const alivePlayers = await fetchPlayersByStatusForRoom(true, roomID);
            setArrayOfAlivePlayers(alivePlayers);
        }
        const fetchTaskForRooms = async () => {
            const allTasks = await fetchAllTasksForRoom(roomID);
            setArrayOfTasks(allTasks);
        }

        const fetchLogs = async () => {
            const allLogs = await fetchAllLogsForRoom(roomID);
            setLogList(allLogs);
        }

        if (roomID) {
            fetchPlayers();
            fetchTaskForRooms();
            fetchLogs();
        }
        //eslint-disable-next-line
    }, [roomID]);
    
    //updates loglist with new log
    const addLog = async (newLog) => {
        const newLogs = await updateLogsForRoom(newLog, roomID);
        setLogList(newLogs);
        return;
    }

    //removes player from alivePlayers and adds them to deadPlayers
    const handleKillPlayer = async (killedPlayerName, assassinName, openSznstatus) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, killedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== killedPlayerName));
        if (openSznstatus === true) {
            console.log('checkpoint 2');
            handleOpenSznended(killedPlayerName);
            await addLog("open season has ended for " + killedPlayerName); 
        }
        await addLog(killedPlayerName + " was killed by " + assassinName);
    };

    const handleOpenSznstarted = async (openSznplayer) => {
        await addLog(openSznplayer + " has open season on them");
    }

    const handleOpenSznended = async (openSznplayer) => {
        await addLog("open season has ended for " + openSznplayer);
    }

    //updates ArrayOfDeadPlayers and adds player to arrayOfAlivePlayers
    const handlePlayerRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers((prevArrayOfDeadPlayers) => 
            prevArrayOfDeadPlayers.filter((name) => name !== revivedPlayerName)
        );
        setArrayOfAlivePlayers(arrayOfAlivePlayers => 
            [...arrayOfAlivePlayers, revivedPlayerName]
        );
        await addLog(revivedPlayerName + " was revived");
    };

    //updates arrayOfTasks when new task is added to db
    const handleNewTaskAdded = async (newTask) => {
        setArrayOfTasks(arrayOfTasks => [...arrayOfTasks, newTask]);
        await addLog("Added new task: " + newTask.title);
    };

    //updates completedTasks
    const handleTaskCompleted  = async (task) => {
        setCompletedTasks(completedTasks => [...completedTasks, task]);
        await addLog("Completed task: " + task);
    }

    //removes player from alivePlayers and adds them to deadPlayers
    const handleUndoRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, revivedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== revivedPlayerName));
        if (revivedPlayerName) {
            unmapPlayers(revivedPlayerName, roomID);
        }
        await addLog(revivedPlayerName + "'s revive was undone");
    }

    //updates logList with remapped targets
    const handleRemapping = async (log) => {
        await addLog(log);
    }

    //updates newTargets and newAssassins, and shows RemapPlayerModal
    const handleAddNewTargets = (targets) => {
        setNewTargets(targets);
    }
    const handleAddNewAssassins = (assassins) => {
        setNewAssassins(assassins);
    }
    const handleSetShowMessageToTrue = () => {
        setShowRemapModal(true);
        console.log('set show message to true');
    }

    return (
        <Box h = '100vh' 
             display = 'flex' 
             flexDirection = 'column'
        >
            <RemapPlayerModal 
                showRemapModal = {showRemapModal}
                newTargets = {newTargets}
                newAssassins = {newAssassins}
                onClose = {() => setShowRemapModal(false)}
            />

            <Box h = '6%'>
                <HeaderExecution 
                    addLog = {addLog}
                    roomID = {roomID}
                    arrayOfAlivePlayers = {arrayOfAlivePlayers}
                />
            </Box>

            <HStack alignItems = 'left'
                    p = '5px'
                    flex = '1'
                    overflow = 'hidden'
            >
                <Box w = {{base: '100%', md: '25%'}}
                     h = {{base: '94%', md: '95%'}}
                     borderWidth = '2px' 
                     borderRadius = '2xl' 
                     overflow = 'auto' 
                     px = '2px'
                     mx = '16px' 
                >
                    <Heading 
                        size = 'lg' 
                        textAlign = 'center'
                        m = '4px'
                    >
                        Alive Players ({arrayOfAlivePlayers.length})
                    </Heading>
                    <AlivePlayersList roomID = {roomID}/>
                </Box>

                <VStack ml = '10px' 
                        mr = '10px' 
                        w = {{base: '100%', md: '46%'}}  
                        h = {{base: '95%', md: '95%'}}
                >
                    <Box borderWidth = '2px' 
                         borderRadius = '2xl' 
                         p = '4px' 
                         w = '100%' 
                         h = {{base: '34%', md: '100%'}} 
                         mb = '10px'
                         overflow = 'hidden'
                    >
                        <Heading 
                            size = 'lg' 
                            textAlign = 'center'
                            mb = '4px'
                        >
                            History Log
                        </Heading>
                        <Divider/>
                        <Box
                            overflow = 'auto'
                            h = 'calc(100% - 50px)'
                            maxH = 'calc(100% - 50px)'
                        >
                            <Log 
                                logList = {logList}
                            />
                        </Box>

                    </Box>

                    <Box borderWidth = '2px' 
                         borderRadius = '2xl' 
                         p = '4px' 
                         w = '100%' 
                         h = {{base: '40%', md: '40%'}}
                    >
                        <Execution
                            roomID={roomID}
                            arrayOfAlivePlayers={arrayOfAlivePlayers}
                            handleKillPlayer={handleKillPlayer}
                            handlePlayerRevive = {handlePlayerRevive}
                            arrayOfTasks = {arrayOfTasks}
                            handleTaskCompleted = {handleTaskCompleted}
                            completedTasks = {completedTasks}
                            handleUndoRevive = {handleUndoRevive}
                            handleRemapping = {handleRemapping}
                            handleAddNewAssassins = {handleAddNewAssassins}
                            handleAddNewTargets = {handleAddNewTargets}
                            handleSetShowMessageToTrue = {handleSetShowMessageToTrue}
                            handleOpenSznstarted = {handleOpenSznstarted}
                            handleOpenSznended = {handleOpenSznended}
           />
                    </Box>
                </VStack>

                <VStack ml = '10px' 
                        mr = '16px' 
                        w = {{ base: '100%', md: '29%' }}
                        h = {{base: '95%', md: '95%'}}
                >
                    <Box w = {{base: '100%', md: '100%'}}
                         h = {{base: '34%', md: '70%'}} 
                         borderWidth = '2px' 
                         borderRadius = '2xl'
                         overflow = 'auto' 
                         p = '4px' 
                         mb = '10px'
                    >
                        <Heading size = 'lg' textAlign = 'center'>Dead Players ({arrayOfDeadPlayers.length})</Heading>
                        <DeadPlayersList roomID = {roomID} 
                                         handlePlayerRevive={handlePlayerRevive} 
                                         arrayOfAlivePlayers={arrayOfAlivePlayers}
                                         handleRemapping = {handleRemapping}
                                         arrayOfDeadPlayers = {arrayOfDeadPlayers}
                                         handleAddNewAssassins = {handleAddNewAssassins}
                                         handleAddNewTargets = {handleAddNewTargets}
                                         handleSetShowMessageToTrue = {handleSetShowMessageToTrue}

                        />
                    </Box>

                    <Box w = {{base: '100%', md: '100%'}}
                         h = {{base: '34%', md: '100%'}} 
                         borderWidth = '2px' 
                         borderRadius = '2xl'
                         overflow = 'auto' 
                         p = '4px' 
                         display = 'flex' 
                         flexDirection = 'column'
                    >
                        <TaskExecution
                            roomID = {roomID}
                            arrayOfTasks = {arrayOfTasks}
                            handleNewTaskAdded = {handleNewTaskAdded}
                            arrayOfPlayers = {arrayOfPlayers}
                            completedTasks = {completedTasks}
                        />
                    </Box>
                </VStack>
            </HStack>
        </Box>
    );
}

export default GameMasterView;