import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './src/firebase/firebaseConfig';

// THROWAWAY VERIFICATION SCREEN — Task 1, Step 5.
//
// This is not the player app's real UI; it exists only to manually confirm
// that a Firestore onSnapshot listener delivers a live edit to a real
// iPhone over Expo Go / a dev client, without an app restart. Replace this
// whole file once that check has passed and Task 2+ introduce real
// navigation/screens.
//
// Fill in ROOM_ID with an existing room's document ID from the target
// Firestore project (rooms/{roomID} — see docs/data-model.md) before
// running this. Then, from the web GM console or the Firebase console,
// edit that same room document (e.g. toggle a boolean field) while this
// screen is open on the phone, and confirm the new value appears on
// screen without restarting the app.
const ROOM_ID = 'LFUU';
// firestore.rules only lets the host or an actual joined player read a
// room doc (isHostOrPlayerOfRoom) — this name joins the room as a real
// player first, so the anonymous test identity satisfies that rule.
const TEST_PLAYER_NAME = 'ExpoCheck'; // must be 16 chars or fewer

export default function App() {
    const [status, setStatus] = useState('signing in...');
    const [roomData, setRoomData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let unsubscribe;

        signInAnonymously(auth)
            .then(() => {
                setStatus('signed in — joining room as a test player...');
                const joinRoom = httpsCallable(functions, 'joinRoom');
                return joinRoom({ roomId: ROOM_ID, playerName: TEST_PLAYER_NAME });
            })
            .then(() => {
                setStatus('joined — subscribing to room...');
                subscribe();
            })
            .catch((err) => {
                // A rejected join (already joined on a relaunch under the
                // same persisted anonymous identity — 'already-exists' —
                // or the room having since started, which the server
                // checks before even looking at joinedUids, so a player
                // who legitimately already joined before the game
                // started gets the exact same 'failed-precondition'
                // "already started" rejection on every later relaunch)
                // isn't necessarily fatal: this test identity may already
                // be a valid player from an earlier successful join.
                // Just try subscribing — the room read's own permission
                // check is the real, authoritative test of whether this
                // identity actually has access, not this join call's
                // success/failure.
                setStatus(`join rejected (${err.code}) — trying to subscribe anyway...`);
                subscribe();
            });

        function subscribe() {
            const roomRef = doc(db, 'rooms', ROOM_ID);
            unsubscribe = onSnapshot(
                roomRef,
                (snapshot) => {
                    setStatus(snapshot.exists() ? 'receiving updates' : 'room not found');
                    setRoomData(snapshot.exists() ? snapshot.data() : null);
                },
                (err) => {
                    setError(err.message);
                }
            );
        }

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    return (
        <View style={styles.container}>
            <Text style={styles.heading}>Realtime listener check</Text>
            <Text>Status: {status}</Text>
            {error ? <Text style={styles.error}>Error: {error}</Text> : null}
            {roomData ? (
                <Text style={styles.data}>{JSON.stringify(roomData, null, 2)}</Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
        padding: 24,
    },
    heading: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    error: {
        color: 'red',
        marginTop: 12,
    },
    data: {
        marginTop: 12,
        fontFamily: 'monospace',
    },
});
