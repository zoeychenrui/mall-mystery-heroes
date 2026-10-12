import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Box,
    Button,
    Flex,
    Heading,
    HStack,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Text,
    useDisclosure,
} from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchTasksQueryForRoom,
} from '../components/firebase_calls/dbCalls';
import { leaveGame } from '../components/leaveGame';
import CreateAlert from '../components/CreateAlert';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';
import PlayerTaskListModal from '../components/task_components/PlayerTaskListModal';
import LeaderboardModal from '../components/game_end_components/LeaderboardModal';
import { buildLeaderboardStandings } from '../game/leaderboard';

const PlayerGame = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    const [playerData, setPlayerData] = useState(null);
    const [players, setPlayers] = useState([]);
    const [missions, setMissions] = useState([]);
    // This player's own chat sends that MessageComposer has fired off but
    // Firestore hasn't confirmed yet — submitChatMessage writes server-side
    // now, so this browser no longer gets an automatic local echo of its
    // own write the way a direct client write used to give it. Lifted here
    // since MessageFeed (which renders them) and MessageComposer (which
    // adds them) are siblings with no other shared state.
    const [pendingMessages, setPendingMessages] = useState([]);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';
    const { isOpen, onOpen, onClose } = useDisclosure();
    const {
        isOpen: isMissionsOpen,
        onOpen: onMissionsOpen,
        onClose: onMissionsClose,
    } = useDisclosure();
    const {
        isOpen: isLeaderboardOpen,
        onOpen: onLeaderboardOpen,
        onClose: onLeaderboardClose,
    } = useDisclosure();
    const {
        isOpen: isGameEndedOpen,
        onOpen: onGameEndedOpen,
        onClose: onGameEndedClose,
    } = useDisclosure();
    const cancelRef = useRef();
    const createAlert = CreateAlert();

    useEffect(() => {
        setPendingMessages([]);
    }, [roomID]);

    const handleOptimisticSend = useCallback((message) => {
        setPendingMessages((previous) => [...previous, message]);
    }, []);

    const handleOptimisticSendFailed = useCallback((id) => {
        setPendingMessages((previous) => previous.filter((message) => message.id !== id));
    }, []);

    // MessageFeed calls this once per real, server-confirmed chat message
    // it sees from this player — oldest pending entry first, so the
    // hand-off from "my local preview" to "the real thing" never needs to
    // match on content, just consume in the order they were sent.
    const handlePendingMessageConfirmed = useCallback(() => {
        setPendingMessages((previous) => previous.slice(1));
    }, []);

    // Shared by every subscription below: a permission error or the
    // watched doc disappearing both mean this session no longer belongs
    // here (room deleted, or — for the player doc — the GM removed this
    // player from the roster), so both bounce the same way a deleted room
    // already does.
    const handleSubscriptionError = useCallback(
        (err) => {
            console.error('Error watching game state:', err);
            clearPlayerSession();
            navigate('/', { replace: true });
        },
        [navigate]
    );

    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(
            roomRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    clearPlayerSession();
                    navigate('/', { replace: true });
                    return;
                }
                setGameStarted(snapshot.data()?.gameStarted ?? false);
                setIsGameActive(snapshot.data()?.isGameActive ?? true);
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, navigate, handleSubscriptionError]);

    // Fires once per mount/transition to inactive — not on every re-render,
    // since it only runs when isGameActive itself changes. A player
    // loading the page after the game already ended sees it once too, not
    // just a player who was watching live when it happened.
    useEffect(() => {
        if (!isGameActive) onGameEndedOpen();
    }, [isGameActive, onGameEndedOpen]);

    // Only starts once the game has actually begun — no need to read the
    // player's own doc while still in the waiting room, and it keeps the
    // waiting screen's read footprint unchanged from before this doc.
    useEffect(() => {
        if (!roomID || !gameStarted || !playerName) return undefined;
        const playerRef = fetchPlayerReferenceForRoom(playerName, roomID);
        const unsubscribe = onSnapshot(
            playerRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    clearPlayerSession();
                    navigate('/', { replace: true });
                    return;
                }
                setPlayerData(snapshot.data());
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, gameStarted, playerName, navigate, handleSubscriptionError]);

    useEffect(() => {
        if (!roomID || !gameStarted) return undefined;
        const playersQuery = fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID);
        const unsubscribe = onSnapshot(playersQuery, (snapshot) => {
            setPlayers(
                snapshot.docs.map((doc) => ({
                    name: doc.data().name,
                    score: doc.data().score,
                    targets: doc.data().targets,
                    openSeason: doc.data().openSeason,
                    isAlive: doc.data().isAlive,
                }))
            );
        });
        return () => unsubscribe();
    }, [roomID, gameStarted]);

    useEffect(() => {
        if (!roomID || !gameStarted) return undefined;
        const missionsQuery = fetchTasksQueryForRoom(roomID);
        const unsubscribe = onSnapshot(missionsQuery, (snapshot) => {
            setMissions(snapshot.docs.map((doc) => doc.data()));
        });
        return () => unsubscribe();
    }, [roomID, gameStarted]);

    const handleLeaveClick = () => {
        onOpen();
    };

    const handleConfirmLeave = async () => {
        try {
            await leaveGame(roomID);
        } catch (err) {
            console.error('Error leaving game:', err);
            onClose();
            createAlert('error', 'Error leaving game', err.message, 1500);
            return;
        }

        try {
            await signOut(auth);
        } catch (err) {
            console.error('Error signing out:', err);
        }
        clearPlayerSession();
        navigate('/');
    };

    return (
        <Flex
            height="100vh"
            direction="column"
            p={4}
            // Dark red, and it stays — closing the "game ended" popup below
            // dismisses the popup, not this. Player-facing only; the GM
            // console (GameMasterView.js) is untouched.
            bg={!isGameActive ? 'red.900' : undefined}
        >
            <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={2} mb={2}>
                <Heading size="md">
                    {playerName || 'You'} joined {roomID}
                </Heading>
                <HStack spacing={2}>
                    <Button
                        size="sm"
                        colorScheme="red"
                        variant="outline"
                        onClick={handleLeaveClick}
                    >
                        Leave
                    </Button>
                    <Button size="sm" colorScheme="teal" variant="outline" onClick={onMissionsOpen}>
                        Missions
                    </Button>
                    <Button
                        size="sm"
                        colorScheme="teal"
                        variant="outline"
                        onClick={onLeaderboardOpen}
                    >
                        Leaderboard
                    </Button>
                </HStack>
            </Flex>
            <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Leave the game? You&apos;ll be removed, and won&apos;t be able to rejoin
                        once the game has started.
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={handleConfirmLeave}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <PlayerTaskListModal
                isOpen={isMissionsOpen}
                onClose={onMissionsClose}
                roomID={roomID}
            />
            <LeaderboardModal
                isOpen={isLeaderboardOpen}
                onClose={onLeaderboardClose}
                standings={buildLeaderboardStandings(players)}
            />
            {/* Once the game has ended, the target/status text no longer
                applies — the "please head back" and final-standings
                announcements arrive as real chat messages instead
                (Endgamebutton.js posts them). Chat itself stays mounted
                either way, so players can keep talking on the way back. */}
            {isGameActive && (
                <>
                    {!gameStarted && <Text mb={4}>Waiting for the host to start...</Text>}
                    {gameStarted && playerData?.isAlive && (
                        <Text mb={4}>
                            {(playerData.targets ?? []).length > 0
                                ? `Your target: ${(playerData.targets ?? []).join(', ')}`
                                : 'Waiting for your target...'}
                        </Text>
                    )}
                    {gameStarted && playerData && !playerData.isAlive && (
                        <>
                            <Heading size="md" mb={2}>
                                You&apos;ve been eliminated
                            </Heading>
                            <Text mb={4}>
                                You may be revived if the host assigns you a revival mission.
                            </Text>
                        </>
                    )}
                </>
            )}
            {/* Pinned above the chat feed for as long as the game stays
                inactive — closing the popup below only dismisses the
                popup, not this. */}
            {!isGameActive && (
                <Box bg="red.700" color="white" borderRadius="md" p={2} mb={2} textAlign="center">
                    <Text fontWeight="bold">
                        GAME ENDED. PLEASE HEAD BACK TO THE STARTING AREA.
                    </Text>
                </Box>
            )}
            <Modal isOpen={isGameEndedOpen} onClose={onGameEndedClose} size="xl" isCentered>
                <ModalOverlay />
                <ModalContent bg="red.900" color="white">
                    <ModalHeader textAlign="center" fontSize="2xl" fontWeight="bold">
                        GAME ENDED
                    </ModalHeader>
                    <ModalCloseButton aria-label="Close modal" />
                    <ModalBody textAlign="center">
                        <Text fontSize="lg" fontWeight="bold">
                            PLEASE HEAD BACK TO THE STARTING AREA.
                        </Text>
                    </ModalBody>
                    <ModalFooter justifyContent="center">
                        <Button onClick={onGameEndedClose}>Close</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <MessageFeed
                roomID={roomID}
                playerName={playerName}
                pendingMessages={pendingMessages}
                onPendingMessageConfirmed={handlePendingMessageConfirmed}
            />
            <MessageComposer
                roomID={roomID}
                playerName={playerName}
                isGameActive={isGameActive}
                onOptimisticSend={handleOptimisticSend}
                onOptimisticSendFailed={handleOptimisticSendFailed}
                players={players}
                missions={missions}
            />
        </Flex>
    );
};

export default PlayerGame;
