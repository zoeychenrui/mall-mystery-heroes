import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { onSnapshot } from 'firebase/firestore';
import * as dbCalls from '../firebase/dbCalls';
import * as playerSession from '../utils/playerSession';

// Mirrors src/pages/ReconnectPending.js exactly (the requester-facing side of
// a mid-game reconnect or new-join request,
// docs/superpowers/specs/2026-08-30-player-reconnect-design.md), adapted to
// React Native navigation/components. Reached via JoinScreen's fallback when
// requestReconnect succeeds — either a genuine returning player (requestType
// 'reconnect', the default) or a player joining fresh after the game has
// already started (requestType 'join'); both land on this same screen and
// just get different copy. Watches its own request document live; once the
// host approves it, this device's uid has already been added to the room's
// joinedUids (approveReconnectRequest's own transaction did that), so writing
// the local session and navigating into the normal Game flow now succeeds
// the same way a fresh join would.
const ReconnectPendingScreen = ({ route, navigation }) => {
    const { roomID, requestId } = route.params ?? {};
    const [status, setStatus] = useState('pending');
    const [requestType, setRequestType] = useState('reconnect');

    useEffect(() => {
        if (!roomID || !requestId) return undefined;
        const requestRef = dbCalls.fetchReconnectRequestReferenceForRoom(requestId, roomID);
        const unsubscribe = onSnapshot(
            requestRef,
            async (snapshot) => {
                if (!snapshot.exists()) {
                    setStatus('denied');
                    return;
                }
                const data = snapshot.data();
                setRequestType(data.requestType ?? 'reconnect');
                if (data.status === 'approved') {
                    // The request document's own playerName, not a route
                    // param or anything else — this is the one value a
                    // subtle bug here would silently corrupt.
                    await playerSession.writePlayerSession(roomID, data.playerName);
                    // reset, not navigate: React Navigation 7's navigate()
                    // pushes Game on top and leaves this screen mounted
                    // underneath, so this request-doc listener would never
                    // tear down. Resetting unmounts it.
                    navigation.reset({ index: 0, routes: [{ name: 'Game', params: { roomID } }] });
                    return;
                }
                setStatus(data.status);
            },
            (error) => {
                console.error('Error watching reconnect request:', error);
                setStatus('denied');
            }
        );
        return () => unsubscribe();
    }, [roomID, requestId, navigation]);

    return (
        <View style={styles.container}>
            {status === 'pending' && (
                <>
                    <Text style={styles.heading}>
                        {requestType === 'join'
                            ? 'Waiting for the host to approve your join…'
                            : 'Waiting for the host to approve your reconnect…'}
                    </Text>
                    <Text style={styles.body}>Hang tight — this updates automatically.</Text>
                </>
            )}
            {status === 'denied' && (
                <>
                    <Text style={styles.heading}>
                        Your {requestType === 'join' ? 'join' : 'reconnect'} request was denied
                    </Text>
                    {/* reset, same reason as the approval path above. */}
                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Join' }] })}
                    >
                        <Text style={styles.buttonText}>Back to home</Text>
                    </TouchableOpacity>
                </>
            )}
        </View>
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
        fontSize: 20,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 12,
    },
    body: {
        textAlign: 'center',
    },
    button: {
        backgroundColor: '#319795',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    buttonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
});

export default ReconnectPendingScreen;
