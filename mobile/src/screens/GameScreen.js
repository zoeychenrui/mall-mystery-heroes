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
import GameMapModal from './components/GameMapModal';
import LocationStatusPanel, { deriveBoundaryDisplay } from './components/LocationStatusPanel';
import MissionsModal from './components/MissionsModal';
import LeaderboardModal from './components/LeaderboardModal';
import PowerUpShopModal from './components/PowerUpShopModal';
import AvatarButton, { AvatarCircle } from './components/AvatarButton';
import TargetPhotoModal from './components/TargetPhotoModal';
import useBoundaryLocation from '../hooks/useBoundaryLocation';
import { deriveFreshStatus, isPositionFresh, canSee } from '../../../src/game/gameBoundary';
import { normalizePlayerName, resolvePlayerDisplayName } from '../../../src/game/playerNames';
import { buildLeaderboardStandings } from '../../../src/game/leaderboard';
import { isHorcruxActive } from '../../../src/game/powerUpEffects';

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
    const [isMissionsOpen, setIsMissionsOpen] = useState(false);
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
    const [isShopOpen, setIsShopOpen] = useState(false);
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
    // This player's own rooms/{roomID}/boundaryStatuses doc — the server's
    // evaluation of their reports. null until it exists (before the first
    // report) or while the boundary is disabled.
    const [boundaryStatusDoc, setBoundaryStatusDoc] = useState(null);
    // Every other currently-"outside" player's status doc, stored RAW —
    // freshness is applied at render time against nowMs (see below).
    const [otherOutsidePositions, setOtherOutsidePositions] = useState([]);
    const [nowMs, setNowMs] = useState(Date.now());
    // Task 12's map. isMapOpen/pingPositions are lifted here (not inside
    // GameMapModal) for the same reason as the web's PlayerGame.js: a ping
    // card's "View on map" (ChatFeed -> MessageBubble's powerUpPing branch)
    // needs to both set positions to show AND open the map in one user
    // action, and pingPositions must survive the map opening/closing via the
    // normal "View Game Map" entry point too.
    const [isMapOpen, setIsMapOpen] = useState(false);
    // Positions from a ping card's "View on map", shown alongside the live
    // ones until the map closes. Snapshots — never updated.
    const [pingPositions, setPingPositions] = useState([]);
    // Task 15's target list (header accordion) + target-photo viewer.
    // isTargetsListOpen mirrors PlayerGameHeader.js's isTargetsAccordionOpen
    // (RN has no Accordion primitive, so this is a plain show/hide toggle).
    // selectedTarget is either a full {name, avatarUrl} from `players`, or
    // just {name} when the target isn't found there yet (same fallback as
    // the web's `target || { name: targetName }`).
    const [isTargetsListOpen, setIsTargetsListOpen] = useState(false);
    const [selectedTarget, setSelectedTarget] = useState(null);
    const [isTargetPhotoOpen, setIsTargetPhotoOpen] = useState(false);

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

    // A local ticker, so freshness re-evaluates even with no new Firestore
    // snapshot — a stale fix must stop showing as "inside"/"outside" on its
    // own, purely from time passing. Same as src/pages/PlayerGame.js.
    useEffect(() => {
        const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(intervalId);
    }, []);

    // This player's own boundary-status doc, once the boundary is enabled
    // and the player's name is known. Subscribed here, not inside
    // useBoundaryLocation (which only ever writes), exactly like the web —
    // so the displayed status survives a relaunch before this session has
    // reported anything. The error callback deliberately does NOT call
    // handleSubscriptionError: a missing or not-yet-permitted status doc
    // (e.g. before this player's first report) is routine, not a sign this
    // session no longer belongs here.
    useEffect(() => {
        if (!roomID || !gameBoundary?.enabled || !playerName) {
            setBoundaryStatusDoc(null);
            return undefined;
        }
        const unsubscribe = onSnapshot(
            dbCalls.fetchBoundaryStatusReferenceForPlayer(playerName, roomID),
            (snapshot) => setBoundaryStatusDoc(snapshot.exists() ? snapshot.data() : null),
            () => setBoundaryStatusDoc(null)
        );
        return () => unsubscribe();
    }, [roomID, gameBoundary?.enabled, playerName]);

    // Every other currently-exposed ("outside") player, for this player's
    // map (Task 12 reads freshOtherOutsidePositions below as a prop and does
    // not subscribe itself). Mounted whenever the boundary is enabled,
    // regardless of whether the map is open. The query is already filtered
    // to status == 'outside'; the viewer's own id is still excluded here as
    // a belt-and-braces measure. Same as the web, its error just empties the
    // list rather than leaving the game.
    //
    // One deliberate difference from the web: this also waits for
    // playerName. The web reads it synchronously, so it is known on the
    // very first render; here it arrives from AsyncStorage a moment later,
    // and without this gate the query would subscribe once with '' (unable
    // to exclude the player's own doc) and then immediately resubscribe —
    // a wasted read of every outside status on every mount.
    useEffect(() => {
        if (!roomID || !gameBoundary?.enabled || !playerName) {
            setOtherOutsidePositions([]);
            return undefined;
        }
        const unsubscribe = onSnapshot(
            dbCalls.fetchOutsideBoundaryStatusesQueryForRoom(roomID),
            (snapshot) => {
                const next = [];
                snapshot.docs.forEach((statusDoc) => {
                    if (statusDoc.id === normalizePlayerName(playerName)) return; // never yourself
                    const data = statusDoc.data();
                    next.push({
                        id: statusDoc.id,
                        lat: data.lat,
                        lng: data.lng,
                        accuracyM: data.accuracyMeters ?? 0,
                        status: data.status,
                        lastUsableMs: data.lastUsableReceivedAt?.toMillis?.() ?? null,
                    });
                });
                setOtherOutsidePositions(next);
            },
            () => setOtherOutsidePositions([])
        );
        return () => unsubscribe();
    }, [roomID, gameBoundary?.enabled, playerName]);

    // Mounted always, independent of whether the map (Task 12) is open —
    // closing the map must not stop location reporting. Same gating as the
    // web: isAlive defaults to true before the player doc has loaded.
    const { permissionState, ownPosition, requestPermission } = useBoundaryLocation({
        roomID,
        boundaryRevision: gameBoundary?.revision ?? null,
        boundaryEnabled: gameBoundary?.enabled ?? false,
        isGameActive,
        isAlive: playerData?.isAlive ?? true,
    });

    // Render-time derivations, not stored state — exactly as
    // src/pages/PlayerGame.js does them — so a position or status goes
    // stale purely from nowMs advancing, with no new snapshot needed.
    //
    // The viewer and each target go through canSee, which classifies both
    // with the same outside check. Freshness and finite coordinates stay
    // here: they decide whether a marker can be drawn at all.
    const viewer = {
        id: playerName ? normalizePlayerName(playerName) : null,
        lat: ownPosition?.lat,
        lng: ownPosition?.lng,
        accuracyM: ownPosition?.accuracyM,
        status: boundaryStatusDoc?.status,
    };
    // Task 12's map reads this for its live other-player markers, alongside
    // any snapshotted ping positions (pingPositions, below).
    const freshOtherOutsidePositions = otherOutsidePositions
        .filter(
            (position) =>
                canSee(viewer, position, gameBoundary?.vertices) &&
                isPositionFresh(position.lastUsableMs, nowMs) &&
                Number.isFinite(position.lat) &&
                Number.isFinite(position.lng)
        )
        .map((position) => ({
            id: position.id,
            lat: position.lat,
            lng: position.lng,
            label: resolvePlayerDisplayName(position.id, players),
            alwaysShowLabel: true,
        }));

    const liveBoundaryStatus = boundaryStatusDoc
        ? deriveFreshStatus(
              {
                  status: boundaryStatusDoc.status,
                  reason: boundaryStatusDoc.reason,
                  lastUsableMs: boundaryStatusDoc.lastUsableReceivedAt?.toMillis() ?? null,
                  boundaryRevision: boundaryStatusDoc.boundaryRevision,
                  uid: boundaryStatusDoc.uid,
              },
              nowMs,
              { currentRevision: gameBoundary?.revision, currentUid: auth.currentUser?.uid }
          )
        : { status: 'unavailable', reason: 'no_fix' };

    // Status words for the panel and (Task 12) the map's status line —
    // boundaryDisplay.mapStatusText — so both always agree.
    const boundaryDisplay = deriveBoundaryDisplay({ liveBoundaryStatus, boundaryStatusDoc, nowMs });

    // Derived the same way the web's PlayerGame.js does before handing it to
    // its own shop modal — not a field the player doc stores or Task 7
    // passes down.
    const horcruxActive = isHorcruxActive(
        {
            horcrux: playerData?.horcrux,
            horcruxEndsAtMs: playerData?.horcruxEndsAt?.toMillis?.() ?? null,
        },
        nowMs
    );

    // The map's own-position marker only ever shows a fix fresh enough to
    // trust — same freshnessMs window as every other position on this
    // screen (isPositionFresh), applied here rather than inside
    // GameMapModal so it stays purely presentational. Mirrors the web's
    // PlayerBoundaryPanel.js, which does this same check right before
    // handing ownPosition to PlayerMapModal.
    const freshOwnPosition =
        ownPosition && isPositionFresh(ownPosition.acquiredAtMs, nowMs) ? ownPosition : null;

    // The map exists only under this condition — same gate as the "View
    // Game Map" entry point below — so a ping card's "View on map" offers
    // itself only then too.
    const isMapAvailable =
        isGameActive && gameBoundary?.enabled === true && (playerData?.isAlive ?? true);

    // A ping card's "View on map" (ChatFeed -> MessageBubble's
    // powerUpPing branch): snapshots the pinged players' positions and
    // opens the map, exactly like the web's handleShowPings.
    const handleShowPings = useCallback((pings) => {
        setPingPositions(
            (pings ?? [])
                .filter((ping) => Number.isFinite(ping.lat) && Number.isFinite(ping.lng))
                .map((ping) => ({
                    id: `ping-${ping.name}`,
                    lat: ping.lat,
                    lng: ping.lng,
                    label: `📍 ${ping.name}`,
                    alwaysShowLabel: true,
                }))
        );
        setIsMapOpen(true);
    }, []);

    const handleMapClose = useCallback(() => {
        setPingPositions([]);
        setIsMapOpen(false);
    }, []);

    // Opens TargetPhotoModal for one of this player's targets — same
    // resolution the web's target button onClick does (PlayerGameHeader.js):
    // prefer the matching entry from `players` (it carries avatarUrl), but
    // fall back to just the name if that target isn't in `players` yet.
    const handleTargetPress = useCallback(
        (targetName) => {
            const target = players.find(
                (player) => normalizePlayerName(player.name) === normalizePlayerName(targetName)
            );
            setSelectedTarget(target || { name: targetName });
            setIsTargetPhotoOpen(true);
        },
        [players]
    );

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
                    // RN port of PlayerGameHeader.js's target-list
                    // accordion — a plain show/hide toggle here (no
                    // Accordion primitive in RN) wrapping a wrapping row of
                    // per-target buttons, each opening TargetPhotoModal.
                    <View style={styles.targetsBox}>
                        {(playerData.targets ?? []).length > 0 ? (
                            <>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel="Current targets"
                                    onPress={() => setIsTargetsListOpen((open) => !open)}
                                >
                                    <Text style={styles.targetsHeading}>
                                        Current target
                                        {playerData.targets.length === 1 ? '' : 's'}
                                        {playerData.targets.length > 1
                                            ? ` (${playerData.targets.length})`
                                            : ''}
                                    </Text>
                                    {isTargetsListOpen && (
                                        <Text style={styles.targetsHint}>
                                            Tap a target to view their photo
                                        </Text>
                                    )}
                                </TouchableOpacity>
                                {isTargetsListOpen && (
                                    <View style={styles.targetsRow}>
                                        {playerData.targets.map((targetName) => {
                                            const target = players.find(
                                                (player) =>
                                                    normalizePlayerName(player.name) ===
                                                    normalizePlayerName(targetName)
                                            );
                                            return (
                                                <TouchableOpacity
                                                    key={targetName}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`View ${targetName}'s photo`}
                                                    style={styles.targetButton}
                                                    onPress={() => handleTargetPress(targetName)}
                                                >
                                                    <AvatarCircle
                                                        uri={target?.avatarUrl}
                                                        name={targetName}
                                                        size={24}
                                                    />
                                                    <Text style={styles.targetButtonText}>
                                                        {targetName}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}
                            </>
                        ) : (
                            <Text style={styles.targetsHeading}>Waiting for your target...</Text>
                        )}
                    </View>
                )}

                <View style={styles.actionRow}>
                    {playerData && (
                        <AvatarButton
                            playerName={playerName}
                            roomID={roomID}
                            avatarUrl={playerData.avatarUrl}
                        />
                    )}
                    {canShop && (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Open shop"
                            style={styles.headerButton}
                            onPress={() => setIsShopOpen(true)}
                        >
                            <Text style={styles.headerButtonText}>Shop</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="View missions"
                        style={styles.headerButton}
                        onPress={() => setIsMissionsOpen(true)}
                    >
                        <Text style={styles.headerButtonText}>Missions</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="View leaderboard"
                        style={styles.headerButton}
                        onPress={() => setIsLeaderboardOpen(true)}
                    >
                        <Text style={styles.headerButtonText}>Leaderboard</Text>
                    </TouchableOpacity>
                    {gameBoundary?.enabled === true && (
                        // Tasks 11-12: "View Game Map" entry point
                        // (PlayerGameHeader.js's IconButton aria-label
                        // "View Game Map").
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="View Game Map"
                            style={styles.headerButton}
                            onPress={() => setIsMapOpen(true)}
                        >
                            <Text style={styles.headerButtonText}>Map</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <GameRulesModal visible={areRulesOpen} onClose={() => setAreRulesOpen(false)} />
            <TargetPhotoModal
                isOpen={isTargetPhotoOpen}
                onClose={() => setIsTargetPhotoOpen(false)}
                target={selectedTarget}
            />
            <MissionsModal
                isOpen={isMissionsOpen}
                onClose={() => setIsMissionsOpen(false)}
                missions={missions}
            />
            <LeaderboardModal
                isOpen={isLeaderboardOpen}
                onClose={() => setIsLeaderboardOpen(false)}
                standings={buildLeaderboardStandings(players)}
            />
            <PowerUpShopModal
                isOpen={isShopOpen}
                onClose={() => setIsShopOpen(false)}
                roomID={roomID}
                playerName={playerName}
                score={playerData?.score}
                cooldowns={playerData?.powerUpCooldowns ?? {}}
                players={players}
                horcruxActive={horcruxActive}
                zonesEnabled={gameBoundary?.enabled === true}
                pendingMysteryItem={playerData?.pendingMysteryItem ?? null}
                purchasePowerUp={callables.purchasePowerUp}
                claimMysteryReward={callables.claimMysteryReward}
            />
            <GameMapModal
                isOpen={isMapOpen}
                onClose={handleMapClose}
                boundaryVertices={gameBoundary?.vertices ?? []}
                ownPosition={freshOwnPosition}
                otherPositions={[...freshOtherOutsidePositions, ...pingPositions]}
                statusText={boundaryDisplay.mapStatusText}
            />

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
                {/* Location/boundary status (PlayerBoundaryPanel.js).
                    Self-gates on gameBoundary?.enabled and
                    playerData?.isAlive ?? true. GameMapModal (Task 12) is
                    mounted above, outside this panel, reading
                    freshOwnPosition, freshOtherOutsidePositions plus
                    pingPositions, and boundaryDisplay.mapStatusText. */}
                <LocationStatusPanel
                    enabled={gameBoundary?.enabled === true}
                    isAlive={playerData?.isAlive ?? true}
                    permissionState={permissionState}
                    requestPermission={requestPermission}
                    liveBoundaryStatus={liveBoundaryStatus}
                    isApproachingExposure={boundaryDisplay.isApproachingExposure}
                    secondsUntilExposed={boundaryDisplay.secondsUntilExposed}
                    statusText={boundaryDisplay.statusText}
                    unavailableText={boundaryDisplay.unavailableText}
                    lastCheckTime={boundaryDisplay.lastCheckTime}
                    showUnavailableRetry={boundaryDisplay.showUnavailableRetry}
                />
                <ChatFeed
                    roomID={roomID}
                    playerName={playerName}
                    pendingMessages={pendingMessages}
                    onPendingMessageConfirmed={handlePendingMessageConfirmed}
                    onShowPings={isMapAvailable ? handleShowPings : undefined}
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
                // Same as the web's MessageComposer wiring: photos need live
                // location, so the camera stays off until this device has
                // actually produced a fix ('granted' is set on the first one).
                locationEnabled={permissionState === 'granted'}
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
    targetsBox: {
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: '#322659', // purple.900-ish
        borderWidth: 1,
        borderColor: '#4B3E82', // purple.700-ish
        borderRadius: 12,
    },
    targetsHeading: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: 'bold',
    },
    targetsHint: {
        color: 'rgba(255, 255, 255, 0.64)', // whiteAlpha.600
        fontSize: 11,
        marginTop: 2,
    },
    targetsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 8,
    },
    targetButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    targetButtonText: {
        color: '#FFFFFF',
        fontSize: 13,
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
