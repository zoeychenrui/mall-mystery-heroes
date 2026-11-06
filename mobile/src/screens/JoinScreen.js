import { useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { signInAnonymously } from 'firebase/auth';
import { getDocs } from 'firebase/firestore';
import { auth } from '../firebase/firebaseConfig';
import * as dbCalls from '../firebase/dbCalls';
import * as callables from '../firebase/callables';
import * as playerSession from '../utils/playerSession';

// Mirrors src/pages/JoinGame.js (the web app's join form) exactly, adapted
// to React Native components/navigation. Keep the two in sync: same
// uppercase-as-typed room code, same maxLength on the name field, same
// sign-in-only-if-signed-out guard, same "already started" -> reconnect
// fallback.
const JoinScreen = ({ navigation }) => {
    const [roomId, setRoomId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        const trimmedRoomId = roomId.trim();
        setErrorMessage('');
        setIsSubmitting(true);

        try {
            // signInAnonymously mints a new anonymous identity and replaces
            // auth.currentUser whenever the current user isn't already
            // anonymous — it does not layer a guest session on top of an
            // existing one, so only sign in when nobody is signed in yet.
            if (!auth.currentUser) {
                await signInAnonymously(auth);
            }
            await callables.joinRoom(trimmedRoomId, playerName);
            await playerSession.writePlayerSession(trimmedRoomId, playerName);
            navigation.navigate('Game', { roomID: trimmedRoomId });
        } catch (err) {
            // Firebase Functions client errors carry a stable `.code` like
            // 'functions/failed-precondition', but NOT a stable `.message`:
            // the mobile app's firebase SDK (^13.2.0) appends the raw HTTP
            // status to the description inside _errorForResponse
            // (@firebase/functions), e.g. "This game has already started.
            // [400]" — the website's older firebase SDK (^10.12.0) does not
            // do this, which is why an exact-string check against the bare
            // backend message (joinRoom.js's HttpsError('failed-precondition',
            // 'This game has already started.')) worked there but not here.
            // Match on the code plus a substring check instead, so this
            // keeps working regardless of exactly how a given SDK version
            // formats the description.
            const isAlreadyStarted =
                err.code === 'functions/failed-precondition' &&
                err.message?.includes('This game has already started.');
            if (!isAlreadyStarted) {
                setErrorMessage(err.message);
                return;
            }

            try {
                const data = await callables.requestReconnect(trimmedRoomId, playerName);
                navigation.navigate('ReconnectPending', {
                    roomID: trimmedRoomId,
                    requestId: data.requestId,
                });
            } catch (reconnectErr) {
                // reconnectRequest.js's own joinedUids guard (docs/improvements.md
                // item 66) rejects with this when the caller's uid is
                // ALREADY in the room's joinedUids — which is exactly what
                // happens after the real Task 16 QA repro: the player swiped
                // back out of GameScreen (bypassing Leave, so neither their
                // uid nor their stored session was ever cleared) and is now
                // resubmitting the join form as the same, still-valid
                // player. There was never an identity problem to resolve
                // here, so don't show this as an error — rejoin exactly like
                // a normal successful join would. Same code+substring
                // matching approach as the "already started" check above,
                // for the same SDK-reformats-the-message reason.
                const isAlreadyAPlayer =
                    reconnectErr.code === 'functions/failed-precondition' &&
                    reconnectErr.message?.includes('already signed in as a player');
                if (isAlreadyAPlayer) {
                    // requestReconnect.js's guard only proves this uid owns
                    // SOME player doc in the room — it never checked the
                    // `playerName` just typed into the form against it. An
                    // already-joined player could type ANY other in-room
                    // player's name here (names are visible on the
                    // leaderboard) and, without this lookup, would be
                    // signed in and navigated into Game under that OTHER
                    // player's identity — a read-only but real information
                    // leak, since GameScreen's player-doc subscription has
                    // no way to tell the typed name apart from the real
                    // one. Look up which player doc this uid actually
                    // owns and use ITS stored `name`, never the typed
                    // string, for both the session and the navigation.
                    const ownedPlayerSnapshot = await getDocs(
                        dbCalls.fetchPlayerByUidQueryForRoom(auth.currentUser.uid, trimmedRoomId)
                    );
                    if (ownedPlayerSnapshot.docs.length !== 1) {
                        // Zero docs means the "already signed in" guard and
                        // this lookup disagree about reality; more than one
                        // means this uid somehow owns two player docs in
                        // the room. Both are states this recovery branch
                        // has no safe guess for — fail into the normal
                        // error path rather than picking a name.
                        setErrorMessage(reconnectErr.message);
                        return;
                    }
                    const ownedPlayerName = ownedPlayerSnapshot.docs[0].data().name;
                    await playerSession.writePlayerSession(trimmedRoomId, ownedPlayerName);
                    navigation.navigate('Game', { roomID: trimmedRoomId });
                    return;
                }
                setErrorMessage(reconnectErr.message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        // Tapping anywhere outside the inputs dismisses the keyboard —
        // without this, the only way to dismiss it was the keyboard's own
        // return key. Wraps the whole screen rather than each input, since
        // the inputs/button underneath still get their own press events
        // first (TouchableWithoutFeedback only fires on a press that
        // nothing else inside it handled).
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View testID="join-screen" style={styles.container}>
                <Text style={styles.heading}>Join Game</Text>
                {errorMessage ? (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                ) : null}
                <TextInput
                    placeholder="Game ID"
                    value={roomId}
                    // Uppercase as you type (Jackbox-style) rather than only at
                    // submit — room codes are stored/matched uppercase, so this
                    // also means it never matters which case a player actually
                    // typed. autoCapitalize="characters" handles the on-screen
                    // keyboard's own casing; the explicit .toUpperCase() here is
                    // belt-and-suspenders for anything that bypasses it (e.g.
                    // pasted text), matching the web app's Input.
                    autoCapitalize="characters"
                    onChangeText={(text) => setRoomId(text.toUpperCase())}
                    style={styles.input}
                />
                <TextInput
                    placeholder="Your name"
                    value={playerName}
                    onChangeText={setPlayerName}
                    maxLength={16}
                    style={styles.input}
                />
                <TouchableOpacity
                    style={styles.button}
                    onPress={handleSubmit}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>Join</Text>
                    )}
                </TouchableOpacity>
            </View>
        </TouchableWithoutFeedback>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    heading: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 16,
    },
    errorBox: {
        backgroundColor: '#FF5252',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        width: '100%',
        maxWidth: 320,
    },
    errorText: {
        color: '#fff',
    },
    input: {
        borderWidth: 3,
        borderColor: '#ccc',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        width: '100%',
        maxWidth: 320,
    },
    button: {
        backgroundColor: '#319795',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 24,
        alignItems: 'center',
        width: '100%',
        maxWidth: 320,
    },
    buttonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
});

export default JoinScreen;
