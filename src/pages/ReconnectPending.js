import React, { useEffect, useState } from 'react';
import { Button, Center, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { fetchReconnectRequestReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { writePlayerSession } from '../utils/playerSession';

// The requester-facing side of a mid-game reconnect
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md). Reached
// only via JoinGame.js's fallback when joinRoom rejects a join attempt
// specifically because the game has already started and the typed name
// belongs to an existing player. Watches its own request document live;
// once the host approves it, this device's uid has already been added to
// the room's joinedUids (approveReconnectRequest's own transaction did
// that), so writing the local session and navigating into the normal
// PlayerGame.js flow now succeeds the same way a fresh join would.
const ReconnectPending = () => {
    const { roomID, requestId } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('pending');

    useEffect(() => {
        if (!roomID || !requestId) return undefined;
        const requestRef = fetchReconnectRequestReferenceForRoom(requestId, roomID);
        const unsubscribe = onSnapshot(
            requestRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    setStatus('denied');
                    return;
                }
                const data = snapshot.data();
                if (data.status === 'approved') {
                    // The request document's own playerName, not a route
                    // param or anything else — this is the one value a
                    // subtle bug here would silently corrupt.
                    writePlayerSession(roomID, data.playerName);
                    navigate(`/rooms/${roomID}/waiting`, { replace: true });
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
    }, [roomID, requestId, navigate]);

    return (
        <Center h="100vh" p={4}>
            <Flex direction="column" alignItems="center" gap={4}>
                {status === 'pending' && (
                    <>
                        <Heading size="md">Waiting for the host to approve your reconnect…</Heading>
                        <Text>Hang tight — this updates automatically.</Text>
                    </>
                )}
                {status === 'denied' && (
                    <>
                        <Heading size="md">Your reconnect request was denied</Heading>
                        <Button colorScheme="teal" onClick={() => navigate('/')}>
                            Back to home
                        </Button>
                    </>
                )}
            </Flex>
        </Center>
    );
};

export default ReconnectPending;
