import React from 'react';
import { useState, useEffect } from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, 
         useLocation } from 'react-router-dom';
import TargetGenerator from '../components/TargetGenerator';
import DeadPlayersList from '../components/DeadPlayersList';
import { HStack,   
         Flex, 
         Heading,
         VStack,
         Box,
         Image,
         Divider
    } from '@chakra-ui/react';
import PlayerRevive from '../components/PlayerRevive';
import { db } from '../utils/firebase';
import { collection,
         getDocs,
         getPersistentCacheIndexManager,
         query
        } from "firebase/firestore";
import RegenerateTargets from '../components/RegenerateTargets';
import TaskCreation from '../components/TaskCreation';
import TaskList from '../components/TaskList';
import Execution from '../components/Execution';
import whiteLogo from '../assets/mall-logo-white-2.png';

const GameMasterView = () => {
    const { roomID } = useParams(); 
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //reference to players subcollection
    const [arrayOfDeadPlayers, setArrayOfDeadPlayers] = useState([]);
    const [arrayOfAlivePlayers, setArrayOfAlivePlayers] = useState([]);
    const [arrayOfTasks, setArrayOfTasks] = useState([]);

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

    return (
        <div>
            <HStack justifyContent = 'left' p = '5px' ml = '16px' size = ''>
                <Image objectFit = 'cover'
                       src = {whiteLogo}
                       alt = 'Logo'
                       boxSize = '36px'
                />
                <Heading>Lobby #: {roomID}</Heading>
                <Flex>
                    <TargetGenerator 
                        arrayOfPlayers={arrayOfPlayers} 
                        roomID={roomID} 
                        
                    />

                    <RegenerateTargets
                        arrayOfAlivePlayers={arrayOfAlivePlayers}
                        roomID = {roomID}
                    />
                </Flex>
            </HStack>

            <HStack alignItems = 'left' p = '5px'>
                <Box width = '23%' height = '2xl' borderWidth = '2px' borderRadius = '2xl' 
                     overflow = 'auto' pl = '2px' pr = '2px' ml = '16px' mr = '10px'
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

                    <Box borderWidth = '2px' borderRadius = '2xl' p = '4px' width = 'xl' height = '208px'>
                        <Execution
                            roomID={roomID}
                            arrayOfAlivePlayers={arrayOfAlivePlayers}
                            handleKillPlayer={handleKillPlayer}
                        />
                    </Box>
                </VStack>

                <VStack ml = '10px' mr = '16px'>
                    <Box width = 'md' height = '274px' borderWidth = '2px' borderRadius = '2xl'
                         overflow = 'auto' p = '4px' mb = '10px'
                    >
                        <Heading size = 'lg' textAlign = 'center'>Dead Players</Heading>
                        <DeadPlayersList roomID = {roomID} handlePlayerRevive={handlePlayerRevive} arrayOfAlivePlayers={arrayOfAlivePlayers}/>
                    </Box>

                    <Box width = 'md' height = 'sm' borderWidth = '2px' borderRadius = '2xl'
                         overflow = 'auto' p = '4px' display = 'flex' flexDirection = 'column'
                    >
                        <Box flex = '1' overflow = 'auto'>
                            <Heading size = 'lg' textAlign = 'center'>Missions</Heading>
                            <TaskList 
                                arrayOfTasks = {arrayOfTasks}
                                roomID = {roomID}
                                arrayOfPlayers = {arrayOfPlayers}
                                arrayO
                                DeadPlayers = {arrayOfDeadPlayers}
                            />
                        </Box>
                        <Box >
                            <TaskCreation
                                roomID = {roomID}
                                onNewTaskAdded = {handleNewTaskAdded}
                                arrayOfPlayers = {arrayOfPlayers}
                            />       
                        </Box>
                    </Box>
                </VStack>
            </HStack>
        </div>
    );
}

export default GameMasterView;