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
import { db } from '../utils/firebase';
import { collection,
         doc,
         getDoc,
         getDocs,
         query,
         updateDoc,
        } from "firebase/firestore";
import Execution from '../components/Execution';
import TaskExecution from '../components/TaskExecution';
import HeaderExecution from '../components/HeaderExecution';
import Log from '../components/Log';
import UnmapPlayers from '../components/UnmapPlayers';

const GameMasterView = () => {
    const { roomID } = useParams(); 
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //reference to players subcollection
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
            try {
                const playerQuery = query(playerCollectionRef);
                const playerSnapshot = await getDocs(playerQuery);
                const players = playerSnapshot.docs
                                    .filter(doc => doc.data().isAlive === false)
                                    .map(doc => doc.data().name);
                setArrayOfDeadPlayers(players);
                console.log(arrayOfDeadPlayers.length);
            }
            catch (error) {
                console.error("Error updating arrayOfDeadPlayers: ", error);
            }
            try {
                const playerQuery = query(playerCollectionRef);
                const playerSnapshot = await getDocs(playerQuery);
                const players = playerSnapshot.docs
                                    .filter(doc => doc.data().isAlive === true)
                                    .map(doc => doc.data().name);
                setArrayOfAlivePlayers(players);
                console.log(arrayOfDeadPlayers.length);
            }
            catch (error) {
                console.error("Error updating arrayOfAlivePlayers: ", error);
            }
        }
        const fetchTasks = async () => {
            try {
                const taskRef = collection(db, 'rooms', roomID, 'tasks');
                const taskSnapshot = await getDocs(taskRef);
                const tasks = taskSnapshot.docs.map(doc => doc.data());
                setArrayOfTasks(tasks);
            }
            catch (error) {
                console.error("Error updating arrayOfTasks: ", error);
            }
        }

        const fetchLogs = async () => {
            try {
                const docRef = doc(db, 'rooms', roomID);
                const docSnapshot = await getDoc(docRef);
                const logs = docSnapshot.data().logs;
                setLogList(logs);
            }
            catch (error) {
                console.error("Error updating logList: ", error);
            }
        }

        if (roomID) {
            fetchPlayers();
            fetchTasks();
            fetchLogs();
        }
        //eslint-disable-next-line
    }, [roomID]);

    const updateLogs = async (newLog) => {
        try {
            const date = new Date();
            const time = date.toLocaleTimeString();
            const docRef = doc(db, 'rooms', roomID);
            const docSnapshot = await getDoc(docRef);
            const currLogs = docSnapshot.data().logs;
            const newAddition = {
                time: time,
                log: newLog
            }
            const newLogs = [...currLogs, newAddition];
            await updateDoc(docRef, { logs: newLogs });
            setLogList(newLogs);
        }
        catch (error) {
            console.error("Error updating logList: ", error);
        }
    }

    //removes player from alivePlayers and adds them to deadPlayers
    const handleKillPlayer = async (killedPlayerName, assassinName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, killedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== killedPlayerName));
        await updateLogs(killedPlayerName + " was killed by " + assassinName);
    };

    //updates ArrayOfDeadPlayers and adds player to arrayOfAlivePlayers
    const handlePlayerRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers.filter((name) => name !== revivedPlayerName));
        setArrayOfAlivePlayers(arrayOfAlivePlayers => [...arrayOfAlivePlayers, revivedPlayerName]);
        await updateLogs(revivedPlayerName + " was revived");
    };

    //updates arrayOfTasks when new task is added to db
    const handleNewTaskAdded = async (newTask) => {
        setArrayOfTasks(arrayOfTasks => [...arrayOfTasks, newTask]);
        await updateLogs("Added new task: " + newTask.title);
    };

    //updates completedTasks
    const handleTaskCompleted  = async (task) => {
        setCompletedTasks(completedTasks => [...completedTasks, task]);
        await updateLogs("Completed task: " + task);
    }

    //removes player from alivePlayers and adds them to deadPlayers
    const handleUndoRevive = async (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, revivedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== revivedPlayerName));
        if (revivedPlayerName) {
            unmapPlayers(revivedPlayerName, roomID);
        }
        await updateLogs(revivedPlayerName + "'s revive was undone");
    }

    //updates logList with remapped targets
    const handleRemapping = async (log) => {
        await updateLogs(log);
    }

    return (
        <div>
            <HeaderExecution roomID = {roomID}
                             arrayOfAlivePlayers = {arrayOfAlivePlayers}
                             handleRemapping = {handleRemapping}
            />

            <HStack alignItems = 'left'
                    p = '5px'
            >
                <Box width = '23%' 
                     height = '2xl' 
                     borderWidth = '2px' 
                     borderRadius = '2xl' 
                     overflow = 'auto' 
                     pl = '2px' 
                     pr = '2px' 
                     ml = '16px' 
                     mr = '10px'
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
                            DeadPlayers = {arrayOfDeadPlayers}
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