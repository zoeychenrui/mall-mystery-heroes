import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseConfig';
import * as dbCalls from '../firebase/dbCalls';
import * as callables from '../firebase/callables';
import * as playerSession from '../utils/playerSession';
import ChatFeed from './components/ChatFeed';
import ChatComposer from './components/ChatComposer';

// The player's in-game screen — a port of the web app's src/pages/PlayerGame.js
// plus the pieces of it that live in src/components/player_game/
// (PlayerGameHeader, PlayerGameDialogs, PlayerGameStatusNotices,
// PlayerRulesModal). Like the web page, this one screen is both the waiting
// room and the main game: nothing here is wrapped in one big
// `{gameStarted && ...}`. The header (Leave, Rules, avatar) and chat are
// always mounted, and every gated piece checks its own precondition
// (gameStarted, isGameActive, playerData?.isAlive, gameBoundary?.enabled).
//
// This is the shell later tasks mount into. The state below — gameBoundary,
// players, missions, playerData — is produced here even where nothing in
// this file renders it yet, because Tasks 9-15 read it as props from the
// empty slots marked "Task N" further down.
const GameScreen = ({ route, navigation }) => {
    const { roomID } = route.params ?? {};
    const [gameStarted, setGameStarted] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    // The whole player doc as stored: targets, isAlive, score,
    // powerUpCooldowns, horcrux/horcruxEndsAt, avatarUrl, cameraBlockedUntil,
    // pendingMysteryItem, and whatever else it holds.
    const [playerData, setPlayerData] = useState(null);
    const [players, setPlayers] = useState([]);
    const [missions, setMissions] = useState([]);
    // {enabled, revision, vertices}, or undefined if the room has none yet.
    const [gameBoundary, setGameBoundary] = useState(undefined);
    const [areRulesOpen, setAreRulesOpen] = useState(false);
    // This player's own chat sends that ChatComposer has fired off but
    // Firestore hasn't confirmed yet — callables.submitChatMessage writes
    // server-side, so this device no longer gets an automatic local echo
    // of its own write. Lifted here since ChatFeed (which renders them)
    // and ChatComposer (which adds them) are siblings with no other
    // shared state, mirroring src/pages/PlayerGame.js.
    const [pendingMessages, setPendingMessages] = useState([]);
    // The web reads the session synchronously from localStorage; AsyncStorage
    // is promise-based, so the name arrives a moment after mount. Until then
    // it is '' and the player-doc subscription below simply waits — the same
    // state the web is in when the stored session belongs to another room.
    const [playerName, setPlayerName] = useState('');

    // Used by Task 14's shop slot. purchasePowerUp enforces the same rules
    // server-side; this only hides the entry point. `=== true` keeps it
    // hidden until the player doc loads.
    const canShop = gameStarted && isGameActive && playerData?.isAlive === true;

    useEffect(() => {
        let cancelled = false;
        playerSession.readPlayerSession().then((session) => {
            if (cancelled) return;
            setPlayerName(session && session.roomID === roomID ? session.playerName : '');
        });
        return () => {
            cancelled = true;
        };
    }, [roomID]);

    useEffect(() => {
        setPendingMessages([]);
    }, [roomID]);

    const handleOptimisticSend = useCallback((message) => {
        setPendingMessages((previous) => [...previous, message]);
    }, []);

    const handleOptimisticSendFailed = useCallback((id) => {
        setPendingMessages((previous) => previous.filter((message) => message.id !== id));
    }, []);

    // ChatFeed calls this once per real, server-confirmed chat message it
    // sees from this player — oldest pending entry first, so the hand-off
    // from "my local preview" to "the real thing" never needs to match on
    // content, just consume in the order they were sent.
    const handlePendingMessageConfirmed = useCallback(() => {
        setPendingMessages((previous) => previous.slice(1));
    }, []);

    // Shared by the room and player-doc subscriptions: a permission error or
    // the watched doc disappearing both mean this session no longer belongs
    // here (room deleted, or the GM removed this player), so both clear the
    // session and go back to Join. The session is cleared before navigating
    // so nothing on Join can read the stale one back.
    //
    // reset, not navigate: in React Navigation 7, navigate('Join') from here
    // pushes a NEW Join on top and leaves this screen mounted underneath,
    // so its four onSnapshot listeners would never tear down and would pile
    // up across leave/rejoin cycles. Resetting the stack to just Join
    // unmounts GameScreen, which runs every effect's unsubscribe. Same as the
    // web's navigate('/', { replace: true }).
    const leaveToJoin = useCallback(async () => {
        await playerSession.clearPlayerSession();
        navigation.reset({ index: 0, routes: [{ name: 'Join' }] });
    }, [navigation]);

    const handleSubscriptionError = useCallback(
        (err) => {
            console.error('Error watching game state:', err);
            leaveToJoin();
        },
        [leaveToJoin]
    );

    useEffect(() => {
        if (!roomID) return undefined;
        const unsubscribe = onSnapshot(
            dbCalls.fetchRoomReferenceForRoom(roomID),
            (snapshot) => {
                if (!snapshot.exists()) {
                    leaveToJoin();
                    return;
                }
                const data = snapshot.data();
                setGameStarted(data?.gameStarted ?? false);
                setIsGameActive(data?.isGameActive ?? true);
                setGameBoundary(data?.gameBoundary);
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, leaveToJoin, handleSubscriptionError]);

    // The web's one-time "GAME ENDED" modal (PlayerGameDialogs.js), as a
    // native alert. Fires once per transition to inactive, including for a
    // player who opens the screen after the game already ended. The pinned
    // banner below stays up regardless.
    useEffect(() => {
        if (!isGameActive) {
            Alert.alert('GAME ENDED', 'PLEASE HEAD BACK TO THE STARTING AREA.', [
                { text: 'Close' },
            ]);
        }
    }, [isGameActive]);

    // Deliberately NOT gated on gameStarted: the web reads the player's own
    // doc in the waiting room too, so they can set their avatar (Task 15)
    // before the host starts the game.
    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        const unsubscribe = onSnapshot(
            dbCalls.fetchPlayerReferenceForRoom(playerName, roomID),
            (snapshot) => {
                if (!snapshot.exists()) {
                    leaveToJoin();
                    return;
                }
                setPlayerData(snapshot.data());
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, playerName, leaveToJoin, handleSubscriptionError]);

    useEffect(() => {
        if (!roomID || !gameStarted) return undefined;
        const unsubscribe = onSnapshot(
            dbCalls.fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID),
            (snapshot) => {
                setPlayers(
                    snapshot.docs.map((playerDoc) => ({
                        name: playerDoc.data().name,
                        ...(playerDoc.data().avatarUrl
                            ? { avatarUrl: playerDoc.data().avatarUrl }
                            : {}),
                        score: playerDoc.data().score,
                        targets: playerDoc.data().targets,
                        openSeason: playerDoc.data().openSeason,
                        isAlive: playerDoc.data().isAlive,
                    }))
                );
            }
        );
        return () => unsubscribe();
    }, [roomID, gameStarted]);

    useEffect(() => {
        if (!roomID || !gameStarted) return undefined;
        const unsubscribe = onSnapshot(dbCalls.fetchTasksQueryForRoom(roomID), (snapshot) => {
            setMissions(snapshot.docs.map((missionDoc) => missionDoc.data()));
        });
        return () => unsubscribe();
    }, [roomID, gameStarted]);

    const handleConfirmLeave = async () => {
        try {
            await callables.leaveGame(roomID);
        } catch (err) {
            console.error('Error leaving game:', err);
            Alert.alert('Error leaving game', err.message);
            return;
        }

        // Same as the web: sign out so the next join starts from a fresh
        // anonymous identity rather than the one just removed from the room.
        try {
            await signOut(auth);
        } catch (err) {
            console.error('Error signing out:', err);
        }
        await leaveToJoin();
    };

    const handleLeavePress = () => {
        Alert.alert(
            'WARNING',
            "Leave the game? You'll be removed, and won't be able to rejoin once the game has started.",
            [
                { text: 'Go Back', style: 'cancel' },
                { text: 'Confirm', style: 'destructive', onPress: handleConfirmLeave },
            ]
        );
    };

    return (
        <SafeAreaView
            testID="game-screen"
            style={[styles.screen, !isGameActive && styles.screenEnded]}
        >
            {/* Header — always mounted, waiting room included
                (PlayerGameHeader.js). */}
            <View style={styles.header}>
                <View style={styles.headerRow}>
                    <View style={styles.headerTitle}>
                        <Text style={styles.brand}>Mall Mystery Heroes</Text>
                        <Text style={styles.playerLine} numberOfLines={1}>
                            {playerName || 'You'} <Text style={styles.lobby}>· Lobby {roomID}</Text>
                        </Text>
                    </View>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Game rules"
                        style={styles.headerButton}
                        onPress={() => setAreRulesOpen(true)}
                    >
                        <Text style={styles.headerButtonText}>Rules</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Leave"
                        style={styles.headerButton}
                        onPress={handleLeavePress}
                    >
                        <Text style={styles.headerButtonText}>Leave</Text>
                    </TouchableOpacity>
                </View>

                {isGameActive && gameStarted && playerData?.isAlive && (
                    // Task 15: target list (accordion) + target-photo viewer.
                    // Reads playerData.targets and players (for each
                    // target's avatarUrl). Owns its own "Waiting for your
                    // target..." empty state.
                    <View />
                )}

                <View style={styles.actionRow}>
                    {playerData && (
                        // Task 15: avatar button (add/change my photo).
                        // Reads playerData.avatarUrl, playerName, roomID.
                        <View />
                    )}
                    {canShop && (
                        // Task 14: shop entry point + PowerUpShopModal.
                        // Reads canShop, roomID, playerName, players,
                        // playerData.{score, powerUpCooldowns, horcrux,
                        // horcruxEndsAt, pendingMysteryItem},
                        // gameBoundary?.enabled (zonesEnabled).
                        <View />
                    )}
                    {/* Task 13: Missions and Leaderboard entry points +
                        their modals. Reads roomID, players. */}
                    <View />
                    {gameBoundary?.enabled === true && (
                        // Tasks 11-12: "View Game Map" entry point.
                        <View />
                    )}
                </View>
            </View>

            <GameRulesModal visible={areRulesOpen} onClose={() => setAreRulesOpen(false)} />

            {/* Status notices (PlayerGameStatusNotices.js). */}
            {isGameActive && !gameStarted && (
                <View style={styles.waitingBox}>
                    <Text style={styles.waitingText}>Waiting for the host to start...</Text>
                </View>
            )}
            {isGameActive && gameStarted && playerData && !playerData.isAlive && (
                <View style={styles.eliminatedBox}>
                    <Text style={styles.eliminatedHeading}>YOU&apos;VE BEEN ELIMINATED</Text>
                    <Text style={styles.eliminatedBody}>
                        Be on the lookout for revival missions to get back in.
                    </Text>
                </View>
            )}
            {!isGameActive && (
                <View style={styles.endedBanner}>
                    <Text style={styles.endedBannerText}>
                        GAME ENDED. PLEASE HEAD BACK TO THE STARTING AREA.
                    </Text>
                </View>
            )}

            <View style={styles.body}>
                {/* Tasks 11-12: location/boundary panel + map modal.
                    Self-gates on gameBoundary?.enabled and
                    playerData?.isAlive ?? true (PlayerBoundaryPanel.js).
                    Reads roomID, playerName, isGameActive, players,
                    gameBoundary.{enabled, revision, vertices}. */}
                <View />
                <ChatFeed
                    roomID={roomID}
                    playerName={playerName}
                    pendingMessages={pendingMessages}
                    onPendingMessageConfirmed={handlePendingMessageConfirmed}
                    // Task 12 wires onShowPings once the map exists.
                />
            </View>
            <ChatComposer
                roomID={roomID}
                playerName={playerName}
                isGameActive={isGameActive}
                players={players}
                missions={missions}
                cameraBlockedUntil={playerData?.cameraBlockedUntil ?? null}
                onOptimisticSend={handleOptimisticSend}
                onOptimisticSendFailed={handleOptimisticSendFailed}
                // locationEnabled isn't threaded here yet — ChatComposer's
                // own default (true) applies until Task 11 builds the
                // location-permission hook `permissionState` comes from and
                // this passes permissionState === 'granted' down.
            />
        </SafeAreaView>
    );
};

// PlayerRulesModal.js, verbatim copy. Pure static text.
const RULES_SECTIONS = [
    {
        heading: 'Targets',
        items: [
            'To make a kill attempt, take a photo of the person and submit it for the host to review. An elimination only counts when the host approves it.',
            'If you eliminate a target, you will take all of their points.',
            'Your targets may change throughout the game, so check your target list regularly. You can press their avatar to see a closer view of them.',
        ],
    },
    {
        heading: 'Missions & Points',
        items: [
            'Complete missions to earn points or revive. To keep track of scores, check the leaderboard.',
        ],
    },
    {
        heading: 'Avatars',
        items: [
            'Change your avatar to be a picture of yourself so other players know who you are.',
        ],
    },
    {
        heading: 'Zones',
        items: [
            'The host can decide to enable zones in the game. Users must accept location permissions to submit photos.',
            'If these zones are enabled, use the map to locate individuals who are outside of the zone.',
        ],
    },
    {
        heading: 'Shop',
        items: ['Use the shop to purchase items that can help you in the game.'],
    },
    {
        heading: 'Safety',
        items: [
            'Follow all venue rules. Stay in public areas; never enter restricted spaces or run indoors.',
            'Keep play friendly and safe. No real weapons, physical contact, or actions that could alarm or endanger anyone.',
            'If rules are broken, the host may issue warnings or penalties, including removal from the game.',
        ],
    },
];

const GameRulesModal = ({ visible, onClose }) => (
    <Modal visible={visible} onRequestClose={onClose} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Game Rules</Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Close game rules"
                        onPress={onClose}
                    >
                        <Text style={styles.modalClose}>✕</Text>
                    </TouchableOpacity>
                </View>
                <ScrollView contentContainerStyle={styles.modalBody}>
                    <Text style={styles.rulesIntro}>
                        You have been contracted to eliminate your targets. Follow these rules, plus
                        any instructions from your game host.
                    </Text>
                    {RULES_SECTIONS.map((section) => (
                        <View key={section.heading} style={styles.rulesSection}>
                            <Text style={styles.rulesHeading}>{section.heading}</Text>
                            {section.items.map((item) => (
                                <Text key={item} style={styles.rulesItem}>
                                    • {item}
                                </Text>
                            ))}
                        </View>
                    ))}
                    <Text style={styles.rulesHeading}>If you are eliminated</Text>
                    <Text style={styles.rulesIntro}>
                        Stay in the game and watch for revival missions. The host controls
                        eliminations, revivals, and when the game ends. Check the chat for updates
                        and announcements.
                    </Text>
                </ScrollView>
            </View>
        </View>
    </Modal>
);

// Colors are the Chakra tokens the web page uses, resolved to hex.
const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#0F1117', // gray.950
    },
    screenEnded: {
        backgroundColor: '#3B0A0A', // red.950
    },
    header: {
        backgroundColor: '#171923', // gray.900
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.16)', // whiteAlpha.200
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        gap: 12,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        flex: 1,
        minWidth: 0,
    },
    brand: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.64)', // whiteAlpha.600
        textTransform: 'uppercase',
        letterSpacing: 1.7,
    },
    playerLine: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    lobby: {
        color: 'rgba(255, 255, 255, 0.64)',
        fontWeight: 'normal',
    },
    headerButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    headerButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    waitingBox: {
        margin: 16,
        padding: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.06)', // whiteAlpha.100
        borderRadius: 12,
    },
    waitingText: {
        color: '#FFFFFF',
    },
    eliminatedBox: {
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    eliminatedHeading: {
        marginVertical: 8,
        fontSize: 20,
        fontWeight: 'bold',
        color: '#E53E3E', // red.500
    },
    eliminatedBody: {
        marginBottom: 16,
        color: '#FFFFFF',
        textAlign: 'center',
    },
    endedBanner: {
        backgroundColor: '#9B2C2C', // red.700
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
    },
    endedBannerText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        textAlign: 'center',
    },
    body: {
        flex: 1,
        minHeight: 0,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        padding: 16,
    },
    modalContent: {
        backgroundColor: '#1A202C', // gray.800
        borderRadius: 8,
        maxHeight: '85%',
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    modalTitle: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: 'bold',
    },
    modalClose: {
        color: '#FFFFFF',
        fontSize: 18,
        paddingHorizontal: 8,
    },
    modalBody: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    rulesIntro: {
        color: 'rgba(255, 255, 255, 0.80)', // whiteAlpha.800
        marginBottom: 20,
    },
    rulesSection: {
        marginBottom: 20,
    },
    rulesHeading: {
        color: '#81E6D9', // teal.200
        fontWeight: 'bold',
        marginBottom: 8,
    },
    rulesItem: {
        color: '#FFFFFF',
        marginBottom: 8,
        paddingLeft: 8,
    },
});

export default GameScreen;
