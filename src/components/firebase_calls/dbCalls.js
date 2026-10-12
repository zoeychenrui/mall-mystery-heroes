import { db } from '../../utils/firebase';
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    updateDoc,
    addDoc,
    orderBy,
    limitToLast,
    limit,
    deleteDoc,
    arrayUnion,
    runTransaction,
    increment,
    serverTimestamp,
} from 'firebase/firestore';
// Every player lookup below queries this instead of the case-preserved `name`
// field, so GM input is case- and whitespace-insensitive end to end
// (docs/improvements.md item 1). addPlayerForRoom already wrote this field
// for duplicate detection; this is what makes it load-bearing for reads too.
// Shared with ChatInput.js and executeKill.js (docs/improvements.md item 35)
// so every caller strips whitespace identically, not just this file's own
// queries.
import { normalizePlayerName } from '../../game/playerNames';

//fetches all players from database
export const fetchAllPlayersForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerSnapshot = await getDocs(playerCollectionRef);
    return playerSnapshot.docs.map((doc) => doc.data().name);
};

// A reference to the players collection itself, for onSnapshot — lets
// Lobby.js watch the roster live instead of one-time-fetching it, so a
// player joining from another device shows up without the GM reloading
// the page. Item 13 (docs/improvements.md) gave GameMasterView this same
// treatment but never extended it to Lobby.
export const fetchAllPlayersQueryForRoom = (roomID) => {
    return collection(db, 'rooms', roomID, 'players');
};

//fetch all players by living status from database
export const fetchPlayersByStatusForRoom = async (isAlive, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('isAlive', '==', isAlive));
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs.map((doc) => doc.data().name);
};

// returns a query of logs by ascending timestamp — same shape as
// fetchPhotosQueryByAscendingTimestampForRoom (docs/improvements.md item 22)
export const fetchLogsQueryByAscendingTimestampForRoom = (roomID) => {
    const logsCollectionRef = collection(db, 'rooms', roomID, 'logs');
    return query(logsCollectionRef, orderBy('timestamp', 'asc'));
};

// Adds a log entry to the room's logs subcollection. Replaces
// updateLogsForRoom (docs/improvements.md item 22) — logs used to live as an
// array field on the room document, capped by Firestore's 1MiB document
// limit and rewritten in full on every message; arrayUnion also silently
// dropped two messages with identical {time, log, color} (deep-equality
// dedup). Named add…, not update…, per this file's convention (add…For…
// creates a new document, matching addPlayerForRoom/addTaskForRoom) — an
// addDoc into a subcollection isn't an update to an existing one. Returns
// nothing: callers subscribe to fetchLogsQueryByAscendingTimestampForRoom
// instead of consuming a return value.
export const addLogForRoom = async (newLog, color, roomID) => {
    const logsCollectionRef = collection(db, 'rooms', roomID, 'logs');
    await addDoc(logsCollectionRef, {
        time: new Date().toLocaleTimeString(),
        log: newLog,
        color,
        timestamp: serverTimestamp(),
    });
};

// Adds a player-facing message to the room's playerMessages subcollection —
// the write-side half of a contract with the player mobile app that
// doesn't exist yet (docs/superpowers/specs/2026-08-06-player-messaging-
// mobile-prep-design.md), the same interim shape `photos` already uses.
// `message` is `{ type, recipient, text, standings, mission }` — see the
// spec for which fields apply to which `type`.
export const addPlayerMessageForRoom = async (message, roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    await addDoc(messagesRef, { ...message, timestamp: serverTimestamp() });
};

// A query of a room's playerMessages in write order, for onSnapshot — lets
// MessageFeed and GMChatPanel watch incoming messages live. Bounded to the
// newest 50 with limitToLast (not limit, which would return the OLDEST 50
// instead) — without this, every subscriber re-fetches and re-renders the
// entire message history on every single new message, which gets
// significantly worse once players are chatting live instead of
// occasionally receiving a GM broadcast
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
export const fetchPlayerMessagesQueryForRoom = (roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    return query(messagesRef, orderBy('timestamp', 'asc'), limitToLast(50));
};

//fetches all tasks by completion from database
export const fetchTasksByCompletionForRoom = async (isComplete, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('isComplete', '==', isComplete));
    return await getDocs(taskQuery);
};

// fetches a task's data by its index from database
export const fetchTaskByIndexForRoom = async (index, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
    const taskSnapshot = await getDocs(taskQuery);
    return taskSnapshot.empty ? null : taskSnapshot.docs[0].data();
};

//updates player's score
//
// Uses Firestore's increment() so concurrent calls (two GMs, or a GM plus a
// task completion) add up instead of racing on a read-then-write and
// silently dropping one of the increments (docs/improvements.md item 7).
export const updatePointsForPlayer = async (player, points, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, { score: increment(points) });
};

//updates the 'isAlive' field of a player
export const updateIsAliveForPlayer = async (player, isAlive, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, { isAlive: isAlive });
};

//marks task as completed by index
export const updateIsCompleteToTrueForTaskByIndex = async (index, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
    const taskSnapshot = await getDocs(taskQuery);
    if (taskSnapshot.empty) {
        throw new Error('Task not found');
    }
    await updateDoc(taskSnapshot.docs[0].ref, { isComplete: true });
};
//updates the 'completedBy' field of a task
export const addPlayerToCompletedByForTask = async (taskDocRef, player) => {
    await updateDoc(taskDocRef, { completedBy: arrayUnion(player) });
};

export const addTaskForRoom = async (task, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    await addDoc(taskCollectionRef, task);
};

//check if task title already exists in database
export const checkForTaskDupesForRoom = async (task, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(
        taskCollectionRef,
        where('titleTrimmedLowerCase', '==', task.titleTrimmedLowerCase)
    );
    const taskSnapshot = await getDocs(taskQuery);
    return !taskSnapshot.empty;
};

//returns a query of alive players in descending order of score with dead players at bottom
export const fetchPlayersQueryByDescendPointsThenIsAliveForRoom = (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    return query(playerCollectionRef, orderBy('isAlive', 'desc'), orderBy('score', 'desc'));
};

// returns a query of photos by ascending order
export const fetchPhotosQueryByAscendingTimestampForRoom = (roomID) => {
    const photosCollectionRef = collection(db, 'rooms', roomID, 'photos');
    return query(photosCollectionRef, orderBy('timestamp', 'asc'));
};

// updates a photo's status in Firestore
export const updatePhotoStatusForRoom = async (roomID, photoID, status) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, { status: status });
};

// Approves a photo and persists the pre-kill player snapshot onto the photo
// document itself (docs/improvements.md item 6) — judgedPhotos used to live
// only in React state, so reloading the console lost the data an undo needs,
// even though the photo's approved/denied status was already durable. Also
// persists `target`, resolved by the moderator in PhotosDisplay.js — a
// submitted photo never names one (a player no longer picks who they
// killed), so this is the point a kill's target is first recorded.
export const approvePhotoForRoom = async (roomID, photoID, target, originalPlayerData) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, {
        status: 'approved',
        target,
        originalPlayerData,
        mission: null,
        missionUndoSnapshot: null,
    });
};

// Approves a photo as evidence of a mission completion instead of a kill —
// the sibling of approvePhotoForRoom for the mission branch of
// PhotosDisplay.js's dropdown
// (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
// Persists which mission the photo was approved as, mirroring how
// approvePhotoForRoom persists the resolved `target`.
export const approvePhotoAsMissionForRoom = async (
    roomID,
    photoID,
    missionIndex,
    reversalSnapshot
) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, {
        status: 'approved',
        mission: missionIndex,
        missionUndoSnapshot: reversalSnapshot,
    });
};

//returns a query of all tasks for room
export const fetchTasksQueryForRoom = (roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    return query(taskCollectionRef);
};

//returns document of player
export const fetchPlayerForRoom = async (playerName, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(playerName))
    );
    const playerSnapshot = await getDocs(playerQuery);
    if (playerSnapshot.empty) {
        throw new Error('Player not found');
    }
    return playerSnapshot.docs[0];
};

//removes player from database
export const removePlayerForRoom = async (player, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    //returns error if player not found
    if (playerSnapshot.empty) throw new Error('Player not found');
    const docRef = playerSnapshot.docs[0].ref;
    await deleteDoc(docRef);
};

//dupates assassins of player in database
export const updateAssassinsForPlayer = async (player, assassins, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, {
        assassins: assassins,
    });
};

//updates targets of player in database
export const updateTargetsForPlayer = async (player, targets, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerdoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerdoc, {
        targets: targets,
    });
};

//fetches player's assassins
export const fetchAssassinsForPlayer = async (player, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(player))
    );
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs[0].data().assassins;
};

export const fetchReferenceByIndexForTask = async (index, roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const taskQuery = query(taskCollectionRef, where('taskIndex', '==', index));
    const taskSnapshot = await getDocs(taskQuery);
    if (taskSnapshot.empty) {
        throw new Error('Task not found');
    }
    return taskSnapshot.docs[0].ref;
};

export const updateTaskForRoom = async (index, updates, roomID) => {
    const taskDocRef = await fetchReferenceByIndexForTask(index, roomID);
    await updateDoc(taskDocRef, updates);
};

export const deleteTaskForRoom = async (index, roomID) => {
    const taskDocRef = await fetchReferenceByIndexForTask(index, roomID);
    await deleteDoc(taskDocRef);
};

//fetches array of alive player names in room
export const fetchAlivePlayerNamesForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs.map((doc) => doc.data().name);
};

//fetches the full alive roster in one read, shaped for src/game/remapPlan.js
export const fetchAliveRosterForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
    const playerSnapshot = await getDocs(playerQuery);
    return playerSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            name: data.name,
            targets: data.targets ?? [],
            assassins: data.assassins ?? [],
        };
    });
};

// One-time fetch of every player (alive and dead), shaped for
// src/game/leaderboard.js's buildLeaderboardStandings — Endgamebutton.js
// uses this to compute final standings for the game-end broadcasts.
export const fetchAllPlayersDataForRoom = async (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerSnapshot = await getDocs(playerCollectionRef);
    return playerSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            name: data.name,
            score: data.score,
            isAlive: data.isAlive,
        };
    });
};

//ends the game
export const endGame = async (roomID) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { isGameActive: false, endedAt: serverTimestamp() });
};

// Persists the most recent /mission done completion's reversal snapshot on
// the room itself, so /mission undo has something to act on — the
// command-path counterpart to approvePhotoAsMissionForRoom's
// missionUndoSnapshot, tracked independently (two separate undo stacks,
// docs/superpowers/specs/2026-08-29-mission-undo-design.md).
export const recordLastMissionCommandCompletion = async (roomID, reversalSnapshot) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { lastMissionCommandCompletion: reversalSnapshot });
};

// Marks the room's Lobby phase as over — written once, when "Confirm and
// Begin Game" is clicked. Distinct from isGameActive, which is set true at
// room creation and only goes false on explicit "End Game": it answers
// "does this room still exist," not "has gameplay started"
// (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
// joinRoom (functions/callableFunctions/joinRoom.js) reads this field via
// the Admin SDK to reject self-registration once it's true.
export const markGameAsStarted = async (roomID) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { gameStarted: true });
};

// A reference to the room document itself, for onSnapshot — isGameActive
// used to be written by endGame and never read anywhere (docs/improvements.md
// item 15's "relatedly" note), so a room a GM had ended still fully accepted
// commands from any tab still open on it.
export const fetchRoomReferenceForRoom = (roomID) => {
    return doc(db, 'rooms', roomID);
};

// A reference to a specific player's document, for onSnapshot — lets
// PlayerGame.js watch its own target/alive status live once the game
// starts, the same way fetchRoomReferenceForRoom lets it watch
// gameStarted. Keyed the same way every other player lookup in this file
// is (trimmedNameLowerCase via normalizePlayerName) —
// functions/callableFunctions/joinRoom.js builds this exact same value as
// the document ID when a player joins, so this ID scheme is a public
// contract, not just an implementation detail of this function. Player
// docs created before that scheme keep their old auto-generated IDs,
// which this by-ID lookup cannot resolve; such players would not get a
// live player-doc subscription.
export const fetchPlayerReferenceForRoom = (playerName, roomID) => {
    return doc(db, 'rooms', roomID, 'players', normalizePlayerName(playerName));
};

// A reference to a specific reconnect request, for onSnapshot — lets
// ReconnectPending.js watch its own request's status live
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
export const fetchReconnectRequestReferenceForRoom = (requestId, roomID) => {
    return doc(db, 'rooms', roomID, 'reconnectRequests', requestId);
};

// A query of a room's still-pending reconnect requests, for onSnapshot —
// lets ReconnectRequests.js show the GM a live list to judge, the same
// role fetchPhotosQueryByAscendingTimestampForRoom plays for kill photos
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
export const fetchPendingReconnectRequestsQueryForRoom = (roomID) => {
    const requestsCollectionRef = collection(db, 'rooms', roomID, 'reconnectRequests');
    return query(requestsCollectionRef, where('status', '==', 'pending'), limit(20));
};

export const setOpenSznOfPlayerToValueForRoom = async (openSeasonPlayer, value, roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const playerQuery = query(
        playerCollectionRef,
        where('trimmedNameLowerCase', '==', normalizePlayerName(openSeasonPlayer))
    );
    const playerSnapshot = await getDocs(playerQuery);
    const playerDoc = playerSnapshot.docs[0].ref;
    await updateDoc(playerDoc, { openSeason: value });
};

//checks if roomID already exists
export const checkForRoomIDDupes = async (roomID) => {
    const roomDocRef = doc(db, 'rooms', roomID);
    const roomSnapshot = await getDoc(roomDocRef);
    return !roomSnapshot.exists();
};

// Finds the room this host is currently running (isGameActive: true), so a
// returning GM lands back in their existing room instead of getting a new
// one created on every login (DashBoard.js,
// docs/superpowers/specs/2026-08-08-dashboard-removal-design.md). The
// firestore.rules `allow list` grant is scoped to exactly this query shape
// (`where('hostId', '==', uid)`) — Firestore can only authorize a `list`
// query when the rule is provably true for every possible result, so the
// isGameActive filter happens here in JS rather than as a second `where`
// clause. A host realistically has at most a couple of rooms, so filtering
// client-side after one read is not a real cost.
//
// Two near-simultaneous logins as the same host can each pass the
// "no active room" check before either write lands, creating two active
// rooms for one host (docs/improvements.md item 56). Sorting by
// `createdAt` here doesn't prevent that — it just makes every subsequent
// lookup land on the same (newest) room instead of an arbitrary one, so a
// returning host is never bounced between two rooms across reloads. A
// room created before this field existed has no `createdAt` at all, and
// sorts as older than any timestamped room.
export const fetchActiveRoomForHost = async (hostId) => {
    const roomsCollectionRef = collection(db, 'rooms');
    const roomsQuery = query(roomsCollectionRef, where('hostId', '==', hostId));
    const roomsSnapshot = await getDocs(roomsQuery);
    const activeRoomDocs = roomsSnapshot.docs.filter(
        (roomDoc) => roomDoc.data().isGameActive === true
    );
    const newestFirst = [...activeRoomDocs].sort((a, b) => {
        const aMillis = a.data().createdAt?.toMillis() ?? 0;
        const bMillis = b.data().createdAt?.toMillis() ?? 0;
        return bMillis - aMillis;
    });
    const activeRoomDoc = newestFirst[0];
    if (!activeRoomDoc) return null;
    return { id: activeRoomDoc.id, gameStarted: activeRoomDoc.data().gameStarted };
};

// get task index and increment by 1
//
// Wrapped in a transaction so two concurrent mission creations can't read
// the same taskIndex and both hand it out (docs/improvements.md item 7) —
// increment() alone isn't enough here, since the caller needs to know which
// index it was assigned, not just that the counter moved.
export const fetchTaskIndexThenIncrement = async (roomID) => {
    const roomDocRef = doc(db, 'rooms', roomID);
    return runTransaction(db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomDocRef);
        const index = Number(roomSnapshot.data().taskIndex);
        transaction.update(roomDocRef, { taskIndex: index + 1 });
        return index;
    });
};
