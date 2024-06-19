import React from 'react';
import { useState, useEffect } from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, 
         useLocation } from 'react-router-dom';
import TargetGenerator from '../components/TargetGenerator';
import DeadPlayersList from '../components/DeadPlayersList';
import { HStack,   
         Flex, 
         Heading,} from '@chakra-ui/react';
import PlayerRevive from '../components/PlayerRevive';
import { db } from '../utils/firebase';
import { collection,
         getDocs,
         query
        } from "firebase/firestore";
import RegenerateTargets from '../components/RegenerateTargets';
import TaskCreation from '../components/TaskCreation';
import TaskList from '../components/TaskList';
import Execution from '../components/Execution';

const GameMasterView = () => {
    const { roomID } = useParams(); 
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const [killedPlayerNamed, setKilledPlayerNamed] = useState('');
    const [killedPlayerPointed, setKilledPlayerPointed] = useState(0);
    const [triggerAS, setTriggerAS] = useState(false);
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //reference to players subcollection
    const [arrayOfDeadPlayers, setArrayOfDeadPlayers] = useState([]);
    const [arrayOfAlivePlayers, setArrayOfAlivePlayers] = useState([]);
    const [arrayOfTasks, setArrayOfTasks] = useState([]);
    const [assassinPlayerNamed, setAssassinPlayerNamed] = useState('');

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

    const handleKillPlayer = (killedPlayerName, setAS) => {
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
            <Heading>Game Master View</Heading>
            <TargetGenerator 
                arrayOfPlayers={arrayOfPlayers} 
                roomID={roomID} 
            />
            <RegenerateTargets
                arrayOfAlivePlayers={arrayOfAlivePlayers}
                roomID = {roomID}
            />
            <Flex direction="row" justifyContent="center" gap='20'>
                <AlivePlayersList roomID={roomID} />
                <DeadPlayersList roomID={roomID} />
            </Flex>
            <HStack spacing='1px'>
            <HStack spacing='1px'>
                <Execution
                    roomID={roomID}
                    arrayOfAlivePlayers={arrayOfAlivePlayers}
                    handleKillPlayer={handleKillPlayer}
                />
            </HStack>
            </HStack>    
            <PlayerRevive 
                roomID = {roomID}
                onPlayerRevived = {handlePlayerRevive}
                arrayOfDeadPlayers = {arrayOfDeadPlayers}
                arrayOfAlivePlayers = {arrayOfAlivePlayers}
            />
            <TaskCreation
                roomID = {roomID}
                onNewTaskAdded = {handleNewTaskAdded}
                arrayOfPlayers = {arrayOfPlayers}
            />
            <TaskList 
                arrayOfTasks = {arrayOfTasks}
                roomID = {roomID}
                arrayOfPlayers = {arrayOfPlayers}
                arrayOfDeadPlayers = {arrayOfDeadPlayers}
            />
        </div>
    );
}

export default GameMasterView;
