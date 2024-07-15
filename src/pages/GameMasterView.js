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
    } from '@chakra-ui/react';
import Execution from '../components/Execution';
import TaskExecution from '../components/TaskExecution';
import HeaderExecution from '../components/HeaderExecution';
import Log from '../components/Log';
import UnmapPlayers from '../components/UnmapPlayers';
import { fetchDeadPlayersForRoom, 
         fetchAlivePlayersForRoom, 
         fetchAllTasksForRoom, 
         fetchallLogsForRoom, 
         updateLogsForRoom 
    } from '../components/dbCalls';

const GameMasterView = () => {
    const { roomID } = useParams(); 
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const [arrayOfDeadPlayers, setArrayOfDeadPlayers] = useState([]);
    const [arrayOfAlivePlayers, setArrayOfAlivePlayers] = useState([]);
    const [arrayOfTasks, setArrayOfTasks] = useState([]);    
    const [completedTasks, setCompletedTasks] = useState([]);
    const [logList, setLogList] = useState([]);
    const unmapPlayers = UnmapPlayers();

    //updates arrayOfAlivePlayers, arrayOfDeadPlayers, logs, and arrayOfTasks when roomID is updated
    useEffect (() => {
        const fetchPlayers = async () => {
            console.log(`fetching players and tasks in useEffect: ${roomID}`);
            const deadPlayers = await fetchDeadPlayersForRoom(roomID);
            setArrayOfDeadPlayers(deadPlayers);
            const alivePlayers = await fetchAlivePlayersForRoom(roomID);
            setArrayOfAlivePlayers(alivePlayers);
        }
        const fetchTaskForRooms = async () => {
            const allTasks = await fetchAllTasksForRoom(roomID);
            setArrayOfTasks(allTasks);
        }

        const fetchLogs = async () => {
            const allLogs = await fetchallLogsForRoom(roomID);
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
    const handleKillPlayer = async (killedPlayerName, assassinName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, killedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== killedPlayerName));
        await addLog(killedPlayerName + " was killed by " + assassinName);
    };

    //updates ArrayOfDeadPlayers and adds player to arrayOfAlivePlayers
    const handlePlayerRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers.filter((name) => name !== revivedPlayerName));
        setArrayOfAlivePlayers(arrayOfAlivePlayers => [...arrayOfAlivePlayers, revivedPlayerName]);
        await addLog(revivedPlayerName + " was revived");
    };

    //updates arrayOfTasks when new task is added to db
    const handleNewTaskAdded = async (newTask) => {
        setArrayOfTasks(arrayOfTasks => [...arrayOfTasks, newTask]);
        await addLog("Added new task: ", newTask.title);
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

    return (
        <div>
            <HeaderExecution roomID = {roomID}/>

            <HStack alignItems = 'left'
                    p = '5px'
            >
                <Box width = '23%' 
                     height = '2xl' 
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

                <VStack ml = '10px' mr = '10px'>
                    <Box borderWidth = '2px' 
                         borderRadius = '2xl' 
                         p = '4px' 
                         width = 'xl' 
                         height = 'md' 
                         mb = '10px'
                         overflow = 'auto'
                    >
                        <Heading size = 'lg' textAlign = 'center'>History Log</Heading>
                        <Log 
                            logList = {logList}
                        />
                    </Box>

                    <Box borderWidth = '2px' 
                         borderRadius = '2xl' 
                         p = '4px' 
                         width = 'xl' 
                         height = '34%'
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
                        />
                    </Box>
                </VStack>

                <VStack ml = '10px' mr = '16px'>
                    <Box width = 'md' 
                         height = '274px' 
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
                        />
                    </Box>

                    <Box width = 'md' 
                         height = 'sm' 
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
        </div>
    );
}

export default GameMasterView;