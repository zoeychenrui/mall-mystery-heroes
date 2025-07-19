import React from 'react';
import { useState, useEffect } from 'react';
import PlayersList from '../components/player_listing/PlayersList';
import { useParams, 
         useLocation } from 'react-router-dom';
import { HStack, Heading, VStack, Box, Divider} from '@chakra-ui/react';
import TaskExecution from '../components/task_components/TaskExecution';
import HeaderExecution from '../components/header_components/HeaderExecution';
import Log from '../components/logs_components/Log';
import UnmapPlayers from '../components/UnmapPlayers';
import { fetchPlayersByStatusForRoom, fetchAllTasksForRoom, fetchAllLogsForRoom, updateLogsForRoom } from '../components/firebase_calls/dbCalls';
import RemapPlayerModal from '../components/RemapPlayerModal';
import { gameContext, taskContext, executionContext } from '../components/Contexts';
import ChatInput from '../components/logs_components/ChatInput';
import PhotosDisplay from '../components/photos_display_component/PhotosDisplay';

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
    const addLog = async (newLog, color) => {
        const newLogs = await updateLogsForRoom(newLog, color, roomID);
        setLogList(newLogs);
        return;
    }

    //removes player from alivePlayers and adds them to deadPlayers
    const handleKillPlayer = async (killedPlayerName, assassinName, openSznstatus) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, killedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== killedPlayerName));
        if (openSznstatus === true) {
            handleOpenSznended(killedPlayerName);
            await addLog("open season has ended for " + killedPlayerName, 'pink.400'); 
        }
        await addLog(killedPlayerName + " was killed by " + assassinName, 'red.400');
    };

    const handleOpenSznstarted = async (openSznplayer) => {
        await addLog(openSznplayer + " has open season on them", 'lightblue');
    }

    const handleOpenSznended = async (openSznplayer) => {
        await addLog("open season has ended for " + openSznplayer, 'pink.400');
    }

    //updates ArrayOfDeadPlayers and adds player to arrayOfAlivePlayers
    const handlePlayerRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers((prevArrayOfDeadPlayers) => 
            prevArrayOfDeadPlayers.filter((name) => name !== revivedPlayerName)
        );
        setArrayOfAlivePlayers(arrayOfAlivePlayers => 
            [...arrayOfAlivePlayers, revivedPlayerName]
        );
        await addLog(revivedPlayerName + " was revived", 'blue.300');
    };

    //updates arrayOfTasks when new task is added to db
    const handleNewTaskAdded = async (newTask) => {
        setArrayOfTasks(arrayOfTasks => [...arrayOfTasks, newTask]);
        await addLog("Added new task: " + newTask.title, 'yellow.400');
    };

    //updates completedTasks
    const handleTaskCompleted  = async (task) => {
        setCompletedTasks(completedTasks => [...completedTasks, task]);
        await addLog("Completed task: " + task, 'green.400');
    }

    //removes player from alivePlayers and adds them to deadPlayers
    const handleUndoRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, revivedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== revivedPlayerName));
        if (revivedPlayerName) {
            unmapPlayers(revivedPlayerName, roomID);
        }
        await addLog(revivedPlayerName + "'s revive was undone", 'gray');
    }

    //updates logList with remapped targets
    const handleRemapping = async (log) => {
        await addLog(log, 'blue.500');
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

    // values for executionContext Provider
    const executionContextProviderValues = {
        handleKillPlayer, 
        handleAddNewAssassins, 
        handleAddNewTargets,
        handleRemapping,
        handlePlayerRevive,
        handleTaskCompleted,
        handleSetShowMessageToTrue,
        handleOpenSznstarted,
        handleOpenSznended
    }

    return (
        <gameContext.Provider value = {{roomID}}>
            <Box sx = {styles.container}>
                <RemapPlayerModal 
                    showRemapModal = {showRemapModal}
                    newTargets = {newTargets}
                    newAssassins = {newAssassins}
                    onClose = {() => setShowRemapModal(false)}
                />

                <Box h = '6%' m = '2px' marginX = '4px'>
                    <HeaderExecution 
                        addLog = {addLog}
                        arrayOfAlivePlayers = {arrayOfAlivePlayers}
                    />
                </Box>

                <HStack sx = {styles.gameDisplayWrapper}>
                    <Box sx = {styles.playersListWrapper}>
                        <Heading sx = {styles.playerListHeader}>
                            Players ({arrayOfPlayers.length})
                        </Heading>
                        <Divider />
                        <PlayersList />
                    </Box>

                    <Box sx = {styles.logsWrapper}>
                        <Heading sx = {styles.chatHeaderText}>Logs</Heading>
                        <Divider/>
                        <Box sx = {styles.logsBox}>
                            <Log logList = {logList}/>
                        </Box>
                        <Divider/>
                        <executionContext.Provider
                            value = {executionContextProviderValues}
                        >
                            <Box sx = {styles.logInput}>
                                <ChatInput />
                            </Box>
                        </executionContext.Provider>
                    </Box>

                    <VStack sx = {styles.rightHandStack}>
                        <Box sx = {styles.photosBox}>
                            <PhotosDisplay />
                        </Box>

                        {/*<Box sx = {styles.taskBox}>
                            <taskContext.Provider value = {{handleNewTaskAdded}}>
                                <TaskExecution />
                            </taskContext.Provider>
                        </Box>*/}
                    </VStack>
                </HStack>
            </Box>
        </gameContext.Provider>
    );
}

export default GameMasterView;

const styles = {
    gameDisplayWrapper: {
        alignItems: 'left',
        p: '5px',
        flex: '1',
        m: '2px',
        overflow: 'hidden'
    },
    container: {
        h: '100vh',
        display: 'flex', 
        flexDirection:'column'
    },
    playersListWrapper: {
        w: '20%',
        minW: '20%',
        h: '95%',
        borderWidth: '2px', 
        borderRadius: '1.5rem',
        px: '2px',
        mx: '8px'
    },
    playerListHeader: {
        fontSize: '26px',
        textAlign: 'center',
        m: '4px',
    },
    chatHeaderText: {
        size: 'lg' ,
        textAlign: 'center',
        mb: '4px'
    },
    logsWrapper: {
        borderWidth: '2px' ,
        borderRadius: '2xl' ,
        p: '4px',
        w: '55%',
        h: '95%',
        mx: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
    },
    logsBox: {
        overflow: 'auto',
        h: '85%',
        minH: '85%'
    },
    logInput: {
        flex: '1',
    },
    taskBox: {
        w: {base: '100%', md: '100%'},
        h: '60%',
        borderWidth: '2px',
        borderRadius: '2xl',
        overflow: 'auto',
        p: '4px', 
        display: 'flex', 
        flexDirection: 'column'
    },
    rightHandStack: {
        ml: '10px',
        mr: '16px',
        w: '25%',
        minW: '25%',
        h: {base: '100%', md: '100%'}
    },
    photosBox: {
        w: {base: '100%', md: '100%'},
        h : '95%'
    }
}