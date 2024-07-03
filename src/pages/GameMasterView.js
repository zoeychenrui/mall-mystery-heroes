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
         getDocs,
         query
        } from "firebase/firestore";
import Execution from '../components/Execution';
import TaskExecution from '../components/TaskExecution';
import HeaderExecution from '../components/HeaderExecution';

const GameMasterView = () => {
    const { roomID } = useParams(); 
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //reference to players subcollection
    const [arrayOfDeadPlayers, setArrayOfDeadPlayers] = useState([]);
    const [arrayOfAlivePlayers, setArrayOfAlivePlayers] = useState([]);
    const [arrayOfTasks, setArrayOfTasks] = useState([]);    
    const [completedTasks, setCompletedTasks] = useState([]);

    //updates arrayOfAlivePlayers, arrayOfDeadPlayers, and arrayOfTasks when roomID is updated
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

        if (roomID) {
            fetchPlayers();
            fetchTasks();
        }
        //eslint-disable-next-line
    }, [roomID]);

    const handleKillPlayer = (killedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, killedPlayerName]);
        setArrayOfAlivePlayers(arrayOfAlivePlayers.filter((name) => name !== killedPlayerName));
    };

    //updates ArrayOfDeadPlayers and adds player to arrayOfAlivePlayers
    const handlePlayerRevive = (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers.filter((name) => name !== revivedPlayerName));
        setArrayOfAlivePlayers(arrayOfAlivePlayers => [...arrayOfAlivePlayers, revivedPlayerName]);
    };

    //updates arrayOfTasks when new task is added to db
    const handleNewTaskAdded = (newTask) => {
        setArrayOfTasks(arrayOfTasks => [...arrayOfTasks, newTask]);
    };

    const handleTaskCompleted  = (task) => {
        setCompletedTasks(completedTasks => [...completedTasks, task]);
    }

    return (
        <div>
            <HeaderExecution roomID = {roomID}
                             arrayOfPlayers = {arrayOfPlayers}
                             arrayOfAlivePlayers = {arrayOfAlivePlayers}
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
                    <Heading size = 'lg' textAlign = 'center' m = '4px'>Alive Players</Heading>
                    <AlivePlayersList roomID = {roomID}/>
                </Box>

                <VStack ml = '10px' mr = '10px'>
                    <Box borderWidth = '2px' borderRadius = '2xl' p = '4px' width = 'xl' 
                         height = 'md' mb = '10px'
                    >
                        Chat Box goes Here!
                    </Box>

                    <Box borderWidth = '2px' 
                         borderRadius = '2xl' 
                         p = '4px' 
                         width = 'xl' 
                         height = '208px'
                    >
                        <Execution
                            roomID={roomID}
                            arrayOfAlivePlayers={arrayOfAlivePlayers}
                            handleKillPlayer={handleKillPlayer}
                            handlePlayerRevive = {handlePlayerRevive}
                            arrayOfTasks = {arrayOfTasks}
                            handleTaskCompleted = {handleTaskCompleted}
                            completedTasks = {completedTasks}
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
                        <Heading size = 'lg' textAlign = 'center'>Dead Players</Heading>
                        <DeadPlayersList roomID = {roomID} 
                                         handlePlayerRevive={handlePlayerRevive} 
                                         arrayOfAlivePlayers={arrayOfAlivePlayers}/>
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