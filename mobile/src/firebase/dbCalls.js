import { db } from './firebaseConfig';
import { collection, query, where, doc, orderBy, limitToLast } from 'firebase/firestore';
// Every player lookup below queries this instead of the case-preserved `name`
// field, so GM input is case- and whitespace-insensitive end to end
// (docs/improvements.md item 1). addPlayerForRoom already wrote this field
// for duplicate detection; this is what makes it load-bearing for reads too.
// Shared with ChatInput.js and executeKill.js (docs/improvements.md item 35)
// so every caller strips whitespace identically, not just this file's own
// queries.
import { normalizePlayerName } from '../../../src/game/playerNames';

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

//returns a query of alive players in descending order of score with dead players at bottom
export const fetchPlayersQueryByDescendPointsThenIsAliveForRoom = (roomID) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    return query(playerCollectionRef, orderBy('isAlive', 'desc'), orderBy('score', 'desc'));
};

//returns a query of all tasks for room
export const fetchTasksQueryForRoom = (roomID) => {
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    return query(taskCollectionRef);
};

// A player's own boundary-status document — read-only from the client,
// and only the player's own (firestore.rules checks the uid on their
// player doc), same normalized ID scheme as fetchPlayerReferenceForRoom
// above (docs/data-model.md's boundaryStatuses section).
export const fetchBoundaryStatusReferenceForPlayer = (playerName, roomID) => {
    return doc(db, 'rooms', roomID, 'boundaryStatuses', normalizePlayerName(playerName));
};

// Only the currently-outside statuses — the one query shape Firestore can
// prove safe for a non-host player under the widened boundaryStatuses read
// rule, since the rule's own condition matches this exact filter.
export const fetchOutsideBoundaryStatusesQueryForRoom = (roomID) => {
    return query(
        collection(db, 'rooms', roomID, 'boundaryStatuses'),
        where('status', '==', 'outside')
    );
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

// A reference to a specific reconnect request, for onSnapshot — lets
// ReconnectPending.js watch its own request's status live
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
export const fetchReconnectRequestReferenceForRoom = (requestId, roomID) => {
    return doc(db, 'rooms', roomID, 'reconnectRequests', requestId);
};
