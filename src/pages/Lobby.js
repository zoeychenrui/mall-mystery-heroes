import { Box, Button, Divider, Flex, Heading, Image, Input } from '@chakra-ui/react';
import { signOut } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import mallLogo from '../assets/mall-logo-black-green.png';
import CreateAlert from '../components/CreateAlert';
import PlayerList from '../components/lobby_components/PlayerList';
import PlayerRemove from '../components/lobby_components/PlayerRemove';
import AbandonRoomButton from '../components/lobby_components/AbandonRoomButton';
import TargetGenerator from '../components/TargetGenerator';
import GameBoundaryButton from '../components/map_components/GameBoundaryButton';
import GMChatPanel from '../components/player_messages_components/GMChatPanel';
import {
    addPlayerMessageForRoom,
    fetchAllPlayersQueryForRoom,
    fetchRoomReferenceForRoom,
} from '../components/firebase_calls/dbCalls';
import { auth } from '../utils/firebase';

const Lobby = () => {
    const navigate = useNavigate();
    const { roomID } = useParams();
    const [arrayOfPlayers, setArrayOfPlayers] = useState([]);
    const [gameBoundary, setGameBoundary] = useState(undefined);
    const [broadcastText, setBroadcastText] = useState('');
    const [isBroadcasting, setIsBroadcasting] = useState(false);
    const createAlert = CreateAlert();

    const logout = async () => {
        try {
            await signOut(auth);
            console.log('User successfully logged out');
            navigate('/');
        } catch (err) {
            console.error(err);
        }
    };

    const handleBroadcast = async () => {
        const text = broadcastText.trim();
        if (!text || isBroadcasting) return;
        setIsBroadcasting(true);
        setBroadcastText('');
        try {
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text,
                    standings: null,
                    mission: null,
                    sender: null,
                },
                roomID
            );
        } catch (error) {
            console.error('Error broadcasting lobby message:', error);
            setBroadcastText(text);
            createAlert('error', 'Error broadcasting message', error.message, 1500);
        } finally {
            setIsBroadcasting(false);
        }
    };

    // Live subscription, not a one-time fetch (docs/improvements.md item
    // 13, extended here from GameMasterView to Lobby) — a player joining
    // from another device now shows up without the GM reloading the page.
    useEffect(() => {
        if (!roomID) return undefined;
        const playersQuery = fetchAllPlayersQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            playersQuery,
            (snapshot) => {
                setArrayOfPlayers(snapshot.docs.map((doc) => doc.data().name));
            },
            (error) => {
                console.error(error);
                createAlert('error', 'Error updating arrayOfPlayers', 'Check console.', 1500);
            }
        );
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomID]);

    // Live subscription to the room doc's gameBoundary field, mirroring the
    // players-query subscription above in structure — GameBoundaryButton
    // needs to know whether a boundary already exists to pick its own
    // label ("Set Game Area" vs "Edit Game Area").
    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(roomRef, (snapshot) => {
            setGameBoundary(snapshot.data()?.gameBoundary);
        });
        return () => unsubscribe();
    }, [roomID]);

    //navigates to lobby
    const handleLobbyRoom = async () => {
        //checks if arrayOfPlayers has at least two players
        if (arrayOfPlayers) {
            if (arrayOfPlayers.length <= 1) {
                return createAlert(
                    'error',
                    'Error',
                    'Not enough players (must have at least 2)',
                    1500
                );
            }
        } else {
            return createAlert('error', 'Error', 'arrayOfPlayers is not defined', 1500);
        }

        try {
            // GameMasterView derives its own player count from a live
            // Firestore subscription now, not router state
            // (docs/improvements.md item 13) — nothing reads this anymore.
            navigate(`/rooms/${roomID}/GameMasterView`);
        } catch (error) {
            console.error('Error navigating to game view: ', error);
            createAlert('error', 'Error navigating to game view', 'Check console.', 1500);
        }
    };

    // Single centered column: green banner (logo + Log Out) up top, then
    // game ID, roster, Remove Player, and Start Game below — replacing the
    // old 40/70 split-screen layout and its manual "Add Player" form, now
    // redundant since players self-join via JoinGame.js
    // (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md).
    return (
        <Flex h="100vh" w="100vw" direction="row">
            <Flex direction="column" w="30%" h="100%" bg="#66bf78" justify="center" align="center">
                <Image src={mallLogo} alt="logo" w="280px" h="300px" />
                <Heading fontSize={28} mt="4%" color="black">
                    Game ID: {roomID}
                </Heading>
                <Flex mt="8%" gap="12px" align="center" direction="column">
                    <TargetGenerator
                        roomID={roomID}
                        arrayOfPlayers={arrayOfPlayers}
                        handleLobbyRoom={handleLobbyRoom}
                    />
                </Flex>
            </Flex>

            <Flex direction="column" w="100%" flex="1" bg="black" align="center" overflow="auto">
                <Flex justify="flex-end" w="98%" mt={1}>
                    <Flex justify="flex-start" flex="1">
                        <GameBoundaryButton roomID={roomID} gameBoundary={gameBoundary} />
                    </Flex>
                    <AbandonRoomButton roomID={roomID} />
                    <Button
                        colorScheme="red"
                        m="12px"
                        borderRadius="3xl"
                        variant="ghost"
                        _hover={{ bg: 'red', color: 'white' }}
                        onClick={logout}
                    >
                        Log Out
                    </Button>
                </Flex>
                <Heading mt="4%" mb="1%">
                    Players ({arrayOfPlayers.length})
                </Heading>

                <Divider />

                <Flex flex="1" w="100%" justify="center" align="center" overflow="auto">
                    <PlayerList arrayOfPlayers={arrayOfPlayers} />
                </Flex>

                <Flex mb="2%" align="center" justify="center" w="100%">
                    {arrayOfPlayers.length > 0 && (
                        <PlayerRemove roomID={roomID} arrayOfPlayers={arrayOfPlayers} />
                    )}
                </Flex>

                <Box
                    w="100%"
                    h="24%"
                    minH="150px"
                    maxH="240px"
                    mb="3%"
                    display="flex"
                    flexDirection="column"
                    borderColor="gray.600"
                    borderRadius="md"
                >
                    <Divider />
                    <GMChatPanel roomID={roomID} />
                    <Flex p={2} gap={2} borderTop="1px solid" borderColor="gray.600">
                        <Input
                            aria-label="Broadcast message"
                            placeholder="Write a message to all players…"
                            value={broadcastText}
                            onChange={(event) => setBroadcastText(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                    handleBroadcast();
                                }
                            }}
                            maxLength={500}
                            isDisabled={isBroadcasting}
                        />
                        <Button
                            colorScheme="teal"
                            onClick={handleBroadcast}
                            isLoading={isBroadcasting}
                            isDisabled={!broadcastText.trim()}
                        >
                            Send
                        </Button>
                    </Flex>
                </Box>
            </Flex>
        </Flex>
    );
};

export default Lobby;
