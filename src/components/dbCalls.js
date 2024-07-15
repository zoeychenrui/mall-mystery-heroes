import { db } from '../utils/firebase';
import { collection, 
         getDocs, 
         query, 
         where,
         doc,
         getDoc,
         updateDoc,
         addDoc,
         orderBy,
         deleteDoc,
    } from 'firebase/firestore';
import UnmapPlayers from './UnmapPlayers';

//fetches all players from database
const fetchAllPlayersForRoom = async (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerSnapshot = await getDocs(playerCollectionRef);
        return playerSnapshot.docs.map(doc => doc.data().name);
    }
    catch (error) {
        console.error('Error fetching all players: ', error);
    }
}

//fetch all alive players from database
const fetchAlivePlayersForRoom = async (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
        const playerSnapshot = await getDocs(playerQuery);
        return playerSnapshot.docs.map(doc => doc.data().name);
    }
    catch (error) {
        console.error('Error fetching alive players: ', error);
    }
}

//fetch all dead players from database
const fetchDeadPlayersForRoom = async (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('isAlive', '==', false));
        const playerSnapshot = await getDocs(playerQuery);
        return playerSnapshot.docs.map(doc => doc.data().name);
    }
    catch (error) {
        console.error('Error fetching dead players: ', error);
    }
} 
   
//fetch all tasks from database
const fetchAllTasksForRoom = async (roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskSnapshot = await getDocs(taskCollectionRef);
        return taskSnapshot.docs.map(doc => doc.data());
    }
    catch (error) {
        console.error('Error fetching all tasks: ', error);
    }
}

//fetch all logs from database
const fetchallLogsForRoom = async (roomID) => {
    try {
        const docRef = doc(db, 'rooms', roomID);
        const docSnapshot = await getDoc(docRef);
        return docSnapshot.data().logs;
    }
    catch (error) {
        console.error('Error fetching all logs: ', error);
    }
}

//add new log to database
const updateLogsForRoom = async (newLog, roomID) => {
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
        return newLogs;
    }
    catch (error) {
        console.error("Error updating logList: ", error);
    }
}

//fetches a player's targets from database
const fetchTargetsForPlayer = async (playerName, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', playerName));
        const playerSnapshot = await getDocs(playerQuery);
        const playerTargets = playerSnapshot.docs[0].data().targets;
        return playerTargets;
    }    
    catch (error) {
        console.error('Error fetching player targets: ', error);
    }
}

//fetches all active tasks from database
const fetchActiveTasksForRoom = async (roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where ('isComplete', '==', false));
        const taskSnapshot = await getDocs(taskQuery);
        return taskSnapshot;
    }
    catch (error) {
        console.error('Error fetching active tasks: ', error);
    }
}

//fetches all inactive tasks from database
const fetchInactiveTasksForRoom = async (roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where ('isComplete', '==', true));
        const taskSnapshot = await getDocs(taskQuery);
        return taskSnapshot;
    }
    catch (error) { 
        console.error('Error fetching inactive tasks: ', error);
    }
}

//fetches a task's data from database
const fetchTaskForRoom = async (taskID, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskRef = doc(taskCollectionRef, taskID);
        const taskSnapshot = await getDoc(taskRef);
        return taskSnapshot.data();
    }
    catch (error) {
        console.error('Error fetching task: ', error);
    }
}

//updates player's score
const updatePointsForPlayer = async (player, points, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        const playerScore = parseInt(playerSnapshot.docs[0].data().score);
        const newPoints = points + playerScore;
        await updateDoc(playerdoc, { score: newPoints });
    }
    catch (error) {
        console.error('Error updating player score: ', error);
    }
}

//revives a player
const updateIsAliveToTrueForPlayer = async (player, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { isAlive: true });
    }
    catch (error) {
        console.error('Error reviving player: ', error);
    }
}

//turns a player's alive status to false
const updateIsAliveToFalseForPlayer = async (player, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { isAlive: false });
    }
    catch (error) {
        console.error('Error killing player: ', error);
    }
}

//marks task as completed
const updateIsCompleteToTrueForTask = async (taskID, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskDocRef = doc(taskCollectionRef, taskID);
        await updateDoc(taskDocRef, { isComplete: true });
    }
    catch (error) {
        console.error('Error completing task: ', error);
    }
}

//updates the 'completedBy' field of a task
const updateCompletedByForTask = async (taskDocRef, checkedPlayers) => {
    try {
        await updateDoc(taskDocRef, { completedBy: checkedPlayers });
    }
    catch (error) {
        console.error('Error updating completedBy: ', error);
    }
}

const addTaskForRoom = async (task, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        await addDoc(taskCollectionRef, task);
    }
    catch (error) {
        console.error('Error adding task: ', error);
    }
}

//check if task title already exists in database
const checkForTaskDupesForRoom = async (task, roomID, createAlert) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where('title', '==', task.title));
        const taskSnapshot = await getDocs(taskQuery);
        if (taskSnapshot.empty) {
            return false;
        }
        else {
            createAlert('error', 'Error', 'Error: task title already exists', 1500);
            return true;
        }
    }
    catch (error) {
        console.error('Error checking for task dupes: ', error);
    }
}

//returns a query of alive players in descending order of score
const fetchAlivePlayersQueryByDesendPointsForRoom = (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        return query(playerCollectionRef, 
                     where('isAlive', '==', true), 
                     orderBy('score', 'desc')
                );
    }
    catch (error) {
        console.error('Error fetching alive players: ', error);
    }
}

//returns document of player
const fetchPlayerForRoom = async (playerName, roomID, createAlert) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', playerName));
        const playerSnapshot = await getDocs(playerQuery);
        if (playerSnapshot.empty) {
            return createAlert('error', 'Error', 'Player not found', 1500);
        }
        else {
            return playerSnapshot.docs[0];
        }
    }
    catch (error) {
        console.error('Error fetching player: ', error);
    }
}

//resets a player's score, targets, and assassins, and turns alive status to false
//and unmaps their targets and assassins
const killPlayerForRoom = async (target, roomID) => {
    const unmapPlayers = UnmapPlayers();
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const targetQuery = query(playerCollectionRef, where('name', '==', target));
        const targetSnapshot = await getDocs(targetQuery);
        const targetDoc = targetSnapshot.docs[0].ref;
        await unmapPlayers(target, roomID);
        await updateDoc(targetDoc, { 
            score: 0, 
            isAlive: false 
        });
    }
    catch (error) {
        console.error('Error killing player: ', error);
    }
}

//add player to database
const addPlayerForRoom = async(player, lowercaseName, createAlert, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    //check if player already exists
    const playerQuery = query(playerCollectionRef, where('name', '==', lowercaseName));
    const playerSnapshot = await getDocs(playerQuery);
    if (!playerSnapshot.empty) {
        return createAlert('error', 'Error', `Player already exists: ${player}`, 1500);
    }
    //adds if not
    addDoc(playerCollectionRef, {
        name: player,
        nameLowerCase: lowercaseName,
        isAlive: true,
        score: 10,
        targets: [],
        assassins: []
    })
    .then((docRef) => {
        console.log('Document written with ID: ', docRef.id);
    })
    .catch((error) => {
        console.error('Error adding player: ', error);
        return createAlert('error', 'Error adding player:', 'check console', 1500);
    });
}

//removes player from database
const removePlayerForRoom = async (player, createAlert, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('name', '==', player));
    const playerSnapshot = await getDocs(playerQuery); 
    //returns error alert if player not found
    if (playerSnapshot.empty) return createAlert('error', 'Error', 'player does not exist', 1500);
    try {
        const docRef = playerSnapshot.docs[0].ref;
        await deleteDoc(docRef);
    }
    catch (error) {
        console.error('Error removing player: ', error);
        createAlert('error', 'Error deleting player', 'check console', 1500);
    }
}

//dupates assassins of player in database
const updateAssassinsForPlayer = async (player, assassins, createAlert, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { assassins: assassins });
    }
    catch (error) {
        console.error('Error updating player assassins: ', error);
        createAlert('error', 'Error updating player assassins', 'check console', 1500);
    }
}

//updates targets of player in database
const updateTaregtsForPlayer = async (player, targets, createAlert, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { targets: targets });
    }
    catch (error) {
        console.error('Error updating player targets: ', error);
        createAlert('error', 'Error updating player targets', 'check console', 1500);
    }
}

//fetches player's assassins
const fetchAssassinsForPlayer = async (player, createAlert, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerAssassins = playerSnapshot.docs[0].data().assassins;
        return playerAssassins;
    }
    catch (error) {
        console.error('Error fetching player assassins: ', error);
        createAlert('error', 'Error fetching player assassins', 'check console', 1500);
    }
}

const fetchReferenceForTask = async (taskID, createAlert, roomID) => {
    console.log('fetching task: ', taskID);
    try {
        const taskRef = doc(db, 'rooms', roomID, 'tasks', taskID);
        const taskSnapshot = await getDoc(taskRef);
        if (taskSnapshot.exists()) {
            return taskRef;
        }
        else {
            console.error('task does not exist.')
            createAlert('error', 'Error', 'task does not exist', 1500);
            return null;
        }
    }
    catch (error) {
        console.error('Error fetching task: ', error);
        createAlert('error', 'Error fetching task reference', 'check console', 1500);
        return null;
    }
}

export { 
    fetchAllPlayersForRoom,
    fetchAlivePlayersForRoom,
    fetchDeadPlayersForRoom,
    fetchAllTasksForRoom,
    fetchallLogsForRoom,
    updateLogsForRoom,
    fetchTargetsForPlayer,
    fetchActiveTasksForRoom,
    fetchTaskForRoom,
    updatePointsForPlayer,
    updateIsAliveToTrueForPlayer,
    updateIsAliveToFalseForPlayer,
    updateIsCompleteToTrueForTask,
    updateCompletedByForTask,
    fetchInactiveTasksForRoom,
    addTaskForRoom,
    checkForTaskDupesForRoom,
    fetchAlivePlayersQueryByDesendPointsForRoom,
    fetchPlayerForRoom,
    killPlayerForRoom,
    addPlayerForRoom,
    removePlayerForRoom,
    updateAssassinsForPlayer,
    updateTaregtsForPlayer,
    fetchAssassinsForPlayer,
    fetchReferenceForTask
};