import { db } from '../../utils/firebase';
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
         arrayUnion,
    } from 'firebase/firestore';
import UnmapPlayers from '../UnmapPlayers';

//fetches all players from database
export const fetchAllPlayersForRoom = async (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerSnapshot = await getDocs(playerCollectionRef);
        return playerSnapshot.docs.map(doc => doc.data().name);
    }
    catch (error) {
        console.error('Error fetching all players: ', error);
    }
}

//fetch all players by living status from database
export const fetchPlayersByStatusForRoom = async (isAlive, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('isAlive', '==', isAlive));
        const playerSnapshot = await getDocs(playerQuery);
        return playerSnapshot.docs.map(doc => doc.data().name);
    }
    catch (error) {
        console.error('Error fetching alive players: ', error);
    }
}
   
//fetch all tasks from database
export const fetchAllTasksForRoom = async (roomID) => {
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
export const fetchAllLogsForRoom = async (roomID) => {
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
export const updateLogsForRoom = async (newLog, color, roomID) => {
    try {
        const date = new Date();
        const time = date.toLocaleTimeString();
        const docRef = doc(db, 'rooms', roomID);
        const docSnapshot = await getDoc(docRef);
        const currLogs = docSnapshot.data().logs;
        const newAddition = {
            time: time,
            log: newLog,
            color: color
        };
        const newLogs = [...currLogs, newAddition];
        await updateDoc(docRef, {
            logs: arrayUnion(newAddition)
        });
        return newLogs;
    }
    catch (error) {
        console.error("Error updating logList: ", error);
    }
}

//fetches a player's targets from database including openseason
export const fetchTargetsForPlayer = async (playerName, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', playerName));
        const openSeasonQuery = query(playerCollectionRef, where('openSeason', '==', true));

        const [playerSnapshot, openSeasonSnapshot] = await Promise.all([
            getDocs(playerQuery),
            getDocs(openSeasonQuery),
        ]);

        let targets = [];
        if (!playerSnapshot.empty) {
            const playerTargets = playerSnapshot.docs[0].data().targets || [];
            const openSeasonPlayers = openSeasonSnapshot.docs.map(doc => doc.data().name);
            let foundIndex = -1;

            for (let k = 0; k < openSeasonPlayers.length; k++) { // For each open season player
                if (playerName === openSeasonPlayers[k]) { // If same name
                    foundIndex = k;
                    break; // Exit the loop once found
                }
            }

            if (foundIndex !== -1) {
                const newOpenSzn = openSeasonPlayers.toSpliced(foundIndex, 1);
                targets = Array.from(new Set([...playerTargets, ...newOpenSzn]));
            } else {
                targets = Array.from(new Set([...playerTargets, ...openSeasonPlayers]));
            }
        }

        return targets;

    } catch (error) {
        console.error('Error fetching player targets: ', error);
        return [];
    }
};

//fetches all tasks by completion from database
export const fetchTasksByCompletionForRoom = async (isComplete, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where ('isComplete', '==', isComplete));
        const taskSnapshot = await getDocs(taskQuery);
        return taskSnapshot;
    }
    catch (error) {
        console.error('Error fetching active tasks: ', error);
    }
}

//fetches a task's data from database
export const fetchTaskForRoom = async (taskID, roomID) => {
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

// fetches a task's data by its index from database
export const fetchTaskByIndexForRoom = async (index, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
        const taskSnapshot = await getDocs(taskQuery);
        if (!taskSnapshot.empty) {
            return taskSnapshot.docs[0].data();
        } else {
            return null;
        }
    }
    catch (error) {
        console.error('Error fetching task by index: ', error);
    }
}

//updates player's score
export const updatePointsForPlayer = async (player, points, roomID) => {
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

//fetches points valoue of player 
export const fetchPointsForPlayerInRoom = async (player, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        return parseInt(playerSnapshot.docs[0].data().score);
    } catch(error) {
        console.error(`Error fetching points for player: `, error);
    }
}

//updates the 'isAlive' field of a player
export const updateIsAliveForPlayer = async (player, isAlive, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { isAlive: isAlive });
    }
    catch (error) {
        console.error('Error reviving player: ', error);
    }
}

//marks task as completed
export const updateIsCompleteToTrueForTask = async (taskID, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskDocRef = doc(taskCollectionRef, taskID);
        await updateDoc(taskDocRef, { isComplete: true });
    }
    catch (error) {
        console.error('Error completing task: ', error);
    }
}

//marks task as completed by index
export const updateIsCompleteToTrueForTaskByIndex = async (index, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
        const taskSnapshot = await getDocs(taskQuery);
        if (!taskSnapshot.empty) {
            const taskDocRef = taskSnapshot.docs[0].ref;
            await updateDoc(taskDocRef, { isComplete: true });
        } else {
            throw new Error('Task not found');
        }
    }
    catch (error) {
        console.error('Error completing task by index: ', error);
    }
}
//updates the 'completedBy' field of a task
export const updateCompletedByForTask = async (taskDocRef, checkedPlayers) => {
    try {
        await updateDoc(taskDocRef, { completedBy: checkedPlayers });
    }
    catch (error) {
        console.error('Error updating completedBy: ', error);
    }
}

//updates the 'completedBy' field of a task
export const addPlayerToCompletedByForTask = async (taskDocRef, player) => {
    console.log(taskDocRef);
    try {
        await updateDoc(taskDocRef, { completedBy: arrayUnion(player) });
    }
    catch (error) {
        console.error('Error updating completedBy: ', error);
    }
}

export const addTaskForRoom = async (task, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        await addDoc(taskCollectionRef, task);
    }
    catch (error) {
        console.error('Error adding task: ', error);
    }
}

//check if task title already exists in database
export const checkForTaskDupesForRoom = async (task, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where('titleTrimmedLowerCase', '==', task.titleTrimmedLowerCase));
        const taskSnapshot = await getDocs(taskQuery);
        if (taskSnapshot.empty) {
            return false;
        }
        else {
            return true;
        }
    }
    catch (error) {
        console.error('Error checking for task dupes: ', error);
    }
}

//returns a query of alive players in descending order of score
export const fetchAlivePlayersQueryByDescendPointsForRoom = (roomID) => {
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

//returns a query of alive players in descending order of score with dead players at bottom
export const fetchPlayersQueryByDescendPointsThenIsAliveForRoom = (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        return query(playerCollectionRef, orderBy('isAlive', 'desc'), orderBy('score', 'desc'));
    } catch (error) {
        console.error('Error fetching players: ', error);
    }
}

// returns a query of photos by ascending order
export const fetchPhotosQueryByAscendingTimestampForRoom = (roomID) => {
    try {
        const photosCollectionRef = collection(db, 'rooms', roomID, 'photos');
        return query(photosCollectionRef, orderBy('timestamp', 'asc'));
    } catch (error) {
        console.error('Error fetching photos Reference: ', error);
    }
}

//returns a query of all tasks for room
export const fetchTasksQueryForRoom = (roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        return query(taskCollectionRef);
    }
    catch (error) {
        console.error('Error fetching tasks: ', error);
    }
}

//returns document of player
export const fetchPlayerForRoom = async (playerName, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', playerName));
        const playerSnapshot = await getDocs(playerQuery);
        if (playerSnapshot.empty) {
            throw new Error('Player not found');
        }
        else {
            return playerSnapshot.docs[0];
        }
    }
    catch (error) {
        console.error(`Error fetching player ${playerName}: `, error);
    }
}

//resets a player's score, targets, and assassins, and turns alive status to false
//and unmaps their targets and assassins
export const killPlayerForRoom = async (target, roomID) => {
    const unmapPlayers = UnmapPlayers();
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const targetQuery = query(playerCollectionRef, where('name', '==', target));
        const targetSnapshot = await getDocs(targetQuery);
        const targetDoc = targetSnapshot.docs[0].ref;
        await unmapPlayers(target, roomID);
        await updateDoc(targetDoc, { 
            score: 0, 
            isAlive: false, 
            openSeason: false // I need to log that openseason has ended
        });
    }
    catch (error) {
        console.error('Error killing player: ', error);
    }
}

//add player to database
export const addPlayerForRoom = async (player, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const trimmedLowercaseName  = player.replace(/\s/g, '').toLowerCase();
    //check if player already exists
    const playerQuery = query(playerCollectionRef, where('trimmedNameLowerCase', '==', trimmedLowercaseName));
    const playerSnapshot = await getDocs(playerQuery);
    if (!playerSnapshot.empty) {
        throw new Error('Player already exists');
    }
    //adds if not
    addDoc(playerCollectionRef, {
        name: player,
        trimmedNameLowerCase: player.replace(/\s/g, '').toLowerCase(),
        isAlive: true,
        score: 10,
        targets: [],
        targetsLength: 0,
        assassins: [],
        assassinsLength: 0,
        openSeason: false
    })
    .then((docRef) => {
        console.log('Document written with ID: ', docRef.id);
    })
    .catch((error) => {
        console.error('Error adding player: ', error);
    });
}

//removes player from database
export const removePlayerForRoom = async (player, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('name', '==', player));
    const playerSnapshot = await getDocs(playerQuery); 
    //returns error if player not found
    if (playerSnapshot.empty) throw new Error('Player not found');
    try {
        const docRef = playerSnapshot.docs[0].ref;
        await deleteDoc(docRef);
    }
    catch (error) {
        console.error('Error removing player: ', error);
    }
}

//dupates assassins of player in database
export const updateAssassinsForPlayer = async (player, assassins, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { 
            assassins: assassins,
            assassinsLength: assassins.length 
        });
    }
    catch (error) {
        console.error('Error updating player assassins: ', error);
    }
}

//updates targets of player in database
export const updateTargetsForPlayer = async (player, targets, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { 
            targets: targets,
            targetsLength: targets.length
        });

    }
    catch (error) {
        console.error('Error updating player targets: ', error);
    }
}

//fetches player's assassins
export const fetchAssassinsForPlayer = async (player, roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerAssassins = playerSnapshot.docs[0].data().assassins;
        return playerAssassins;
    }
    catch (error) {
        console.error('Error fetching player assassins: ', error);
    }
}

export const fetchReferenceForTask = async (taskID, roomID) => {
    try {
        const taskRef = doc(db, 'rooms', roomID, 'tasks', taskID);
        const taskSnapshot = await getDoc(taskRef);
        if (taskSnapshot.exists()) {
            return taskRef;
        }
        else {
            throw new Error('Task not found');
        }
    }
    catch (error) {
        throw new Error('Error fetching task: ', error);
    }
}

export const fetchReferenceByIndexForTask = async (index, roomID) => {
    try {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
        const taskSnapshot = await getDocs(taskQuery);
        if (!taskSnapshot.empty) {
            return taskSnapshot.docs[0].ref;
        }
        else {
            throw new Error('Task not found');
        }
    }
    catch (error) {
        throw new Error('Error fetching task: ', error);
    }
}


//fetches array of alive players in descending order of assassins and then score
export const fetchAlivePlayersByAscendAssassinsLengthForRoom = async (roomID, player) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, 
                                  where('isAlive', '==', true),
                                  orderBy('assassinsLength', 'asc'),
                                  orderBy('score', 'desc')
                                );
        const playerSnapshot = await getDocs(playerQuery);
        const players = playerSnapshot.docs.map(doc => doc.data())
                                           .filter(doc => doc.name !== player);
        console.log('players: ', players);
        return players;
    }
    catch (error) {
        throw new Error('Error fetching alive players: ', error.message);
    }
}

//fetches array of alive players in descending order of assassins and then score
export const fetchAlivePlayersByAscendTargetsLengthForRoom = async (roomID, player) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, 
                                  where('isAlive', '==', true),
                                  orderBy('targetsLength', 'asc'),
                                  orderBy('score', 'asc')
                                );
        const playerSnapshot = await getDocs(playerQuery);
        const players = playerSnapshot.docs.map(doc => doc.data())
                                           .filter(doc => doc.name !== player);
        console.log('players: ', players);
        return players;
    }
    catch (error) {
        throw new Error('Error fetching alive players: ', error.message);
    }
}


//fetches array of alive player names in room
export const fetchAlivePlayerNamesForRoom = async (roomID) => {
    try {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
        const playerSnapshot = await getDocs(playerQuery);
        return playerSnapshot.docs.map(doc => doc.data().name);

    } catch (error) {
        throw new Error('Error fetching alive players: ', error.message)
    }
}

//ends the game
export const endGame = async (roomID) => {
    try {
        const roomRef = doc(db, 'rooms', roomID);
        const roomSnapshot = await getDoc(roomRef);

        if (roomSnapshot.exists()) {
            await updateDoc(roomRef, { isGameActive: false });
            console.log('Game ended successfully.');
        } else {
            console.log('No such document!');
        }
    } catch (error) {
        console.error('Error ending game: ', error);
    }
};

export const setOpenSznOfPlayerToValueForRoom = async (openSeasonPlayer, value, roomID) => {
     const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
     const playerQuery = query(playerCollectionRef, where('name', '==', openSeasonPlayer));
     const playerSnapshot = await getDocs(playerQuery);
     const playerDoc = playerSnapshot.docs[0].ref;
     await updateDoc(playerDoc, {openSeason: value});
}

export const checkOpenSzn = async (roomID, selectedOpenSeasonPlayer) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const sznQuery = query(playerCollectionRef, where('name', '==', selectedOpenSeasonPlayer));
    const sznSnapshot = await getDocs(sznQuery);
    return sznSnapshot.docs[0].get('openSeason');
}

//checks if roomID already exists
export const checkForRoomIDDupes = async (roomID) => {
    const roomDocRef = doc(db, 'rooms', roomID);
    const roomSnapshot = await getDoc(roomDocRef);
    return !roomSnapshot.exists();
}

// get task index and increment by 1
export const fetchTaskIndexThenIncrement = async (roomID) => {
    try {
        const roomDocRef = doc(db, 'rooms', roomID);
        const roomSnapshot = await getDoc(roomDocRef);
        const index = Number(roomSnapshot.data().taskIndex);
        const newIndex = index + 1;
        await updateDoc(roomDocRef, {
            taskIndex: newIndex
        })
        return index;
    } catch(error) {
        console.error("Error fetching Task Index: ", error);
    }
}