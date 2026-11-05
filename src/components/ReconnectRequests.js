import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { gameContext, executionContext } from './Contexts';
import {
    addPlayerMessageForRoom,
    fetchPendingReconnectRequestsQueryForRoom,
} from './firebase_calls/dbCalls';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';
import CreateAlert from './CreateAlert';

// The moderator-facing side of mid-game reconnect and new-join requests
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md). Mirrors
// PhotosDisplay.js's own shape: a small live list of pending items, one
// row each, with judgment buttons that call a thin Cloud Function
// wrapper and then log+broadcast the outcome — Approve only; a denied
// request is never announced to players, matching how a denied kill
// photo isn't announced either.
const ReconnectRequests = () => {
    const { roomID } = useContext(gameContext);
    const { addLog } = useContext(executionContext);
    const [pendingRequests, setPendingRequests] = useState([]);
    const createAlert = CreateAlert();

    useEffect(() => {
        const requestsQuery = fetchPendingReconnectRequestsQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            requestsQuery,
            (snapshot) => {
                setPendingRequests(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
            },
            (error) => {
                console.error('Error fetching reconnect requests: ', error);
            }
        );
        return () => unsubscribe();
    }, [roomID]);

    const handleApprove = async (request) => {
        try {
            await approveReconnectRequest(roomID, request.id);
            const message =
                request.requestType === 'join'
                    ? `${request.playerName} joined the game; target assignments were updated.`
                    : `${request.playerName} reconnected`;
            await addLog(message, 'blue.300');
            // New joins are announced inside the approval transaction;
            // reconnects still need their client-side announcement.
            if (request.requestType !== 'join') {
                await addPlayerMessageForRoom(
                    {
                        type: 'broadcast',
                        recipient: null,
                        text: message,
                        standings: null,
                    },
                    roomID
                );
            }
        } catch (error) {
            console.error('Error approving request: ', error);
            createAlert('error', 'Error approving request', error.message, 1500);
        }
    };

    const handleDeny = async (request) => {
        try {
            await denyReconnectRequest(roomID, request.id);
        } catch (error) {
            console.error('Error denying request: ', error);
            createAlert('error', 'Error denying request', error.message, 1500);
        }
    };

    if (pendingRequests.length === 0) return null;

    return (
        <Box sx={styles.container}>
            {pendingRequests.map((request) => (
                <Flex key={request.id} sx={styles.row}>
                    <Text>
                        {request.requestType === 'join'
                            ? `${request.playerName} wants to join the game (target assignments will be updated)`
                            : `${request.playerName} wants to reconnect`}
                    </Text>
                    <Button size="sm" colorScheme="red" onClick={() => handleDeny(request)}>
                        Deny
                    </Button>
                    <Button size="sm" colorScheme="green" onClick={() => handleApprove(request)}>
                        Approve
                    </Button>
                </Flex>
            ))}
        </Box>
    );
};

const styles = {
    container: {
        w: '100%',
        px: '8px',
    },
    row: {
        alignItems: 'center',
        gap: '8px',
        bg: 'yellow.700',
        borderRadius: '8px',
        p: '4px',
        mb: '4px',
    },
};

export default ReconnectRequests;
