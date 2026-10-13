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
    fetchBoundaryStatusReferenceForPlayer,
    fetchOutsideBoundaryStatusesQueryForRoom,
} from '../components/firebase_calls/dbCalls';
import { leaveGame } from '../components/leaveGame';
import CreateAlert from '../components/CreateAlert';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';
import PlayerTaskListModal from '../components/task_components/PlayerTaskListModal';
import LeaderboardModal from '../components/game_end_components/LeaderboardModal';
import { buildLeaderboardStandings } from '../game/leaderboard';
import { formatMessageTime } from '../utils/formatMessageTime';
import { normalizePlayerName, resolvePlayerDisplayName } from '../game/playerNames';
import useBoundaryLocation from '../hooks/useBoundaryLocation';
import PlayerMapModal from '../components/map_components/PlayerMapModal';
// require(), not a named `import` — gameBoundary.js is CommonJS
// (module.exports) by design (see its own header comment), and a named ES
// `import` of it is not statically analyzable the way CRA's production
// webpack build requires, even though Jest's CommonJS-based test runner
// never notices. Same wall BoundaryEditorModal.js and GameMap.js already
// hit; see boundaryDraft.js's header comment for the full story.
const {
    deriveFreshStatus,
    GAME_BOUNDARY_CONFIG,
    isPositionFresh,
} = require('../game/gameBoundary');

// Plain-language text for every reason deriveFreshStatus/gameBoundary.js
// and the reportPlayerLocation callable can actually produce for an
// `unavailable` status, so players see an explanation instead of a raw
// internal code. wrong_revision/wrong_uid are internal consistency
// reasons, not anything a player can act on, so both fold into the same
// generic "still checking" message. invalid_fix/poor_accuracy are the
// two classifyFix reasons (src/game/gameBoundary.js) that can land here
// via the server-stored status doc's own `reason` field.
const UNAVAILABLE_REASON_TEXT = {
    stale: 'No recent location reading.',
    no_fix: 'No location reading yet.',
    wrong_revision: 'Still checking against the updated game area.',
    wrong_uid: 'Still checking against the updated game area.',
    permission_denied: 'Location permission was denied.',
    timeout: 'Could not get a location fix in time.',
    unavailable: 'Location services are unavailable on this device.',
    invalid_fix: 'Location services are unavailable on this device.',
    poor_accuracy: 'Location accuracy is too low right now.',
    clock_skew: "This device's clock looks out of sync — check it and retry.",
};
const DEFAULT_UNAVAILABLE_TEXT = 'Checking your location status.';
// Reasons worth offering Retry for here, alongside the stored message —
// the ones a fresh attempt could plausibly fix. permission_denied already
// gets its own Retry via the permissionState === 'denied' box above, so
// it is deliberately left out here to avoid a second, redundant button.
const UNAVAILABLE_RETRY_REASONS = new Set(['timeout', 'unavailable']);

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
    const [gameBoundary, setGameBoundary] = useState(undefined);
    const [boundaryStatusDoc, setBoundaryStatusDoc] = useState(null);
    const [otherOutsidePositions, setOtherOutsidePositions] = useState([]);
    const [nowMs, setNowMs] = useState(Date.now());
    const previousRevisionRef = useRef(undefined);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';
    const { isOpen, onOpen, onClose } = useDisclosure();
    const { isOpen: isMapOpen, onOpen: onMapOpen, onClose: onMapClose } = useDisclosure();
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

                // Side effects (toast, ref mutation) live here as plain
                // statements, not inside setGameBoundary's updater — React
                // can invoke a functional setState updater more than once
                // for the same update under some scheduling paths, which
                // would risk a duplicate toast or a double-mutated ref.
                const nextGameBoundary = snapshot.data()?.gameBoundary;
                const previousRevision = previousRevisionRef.current;
                if (nextGameBoundary?.enabled && previousRevision === undefined) {
                    createAlert('info', 'Game area is ready', '', 2500);
                } else if (
                    nextGameBoundary?.enabled &&
                    previousRevision !== undefined &&
                    nextGameBoundary.revision !== previousRevision
                ) {
                    createAlert('info', 'Game area updated', '', 2500);
                }
                previousRevisionRef.current = nextGameBoundary?.revision;
                setGameBoundary(nextGameBoundary);
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // A local ticker, so freshness re-evaluates even with no new Firestore
    // snapshot — a stale fix must stop showing as "inside"/"outside" on its
    // own, purely from time passing.
    useEffect(() => {
        const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(intervalId);
    }, []);

    // This player's own boundary-status doc, only once the boundary is
    // enabled and the player's name is known. The error callback here does
    // NOT call handleSubscriptionError — a missing or not-yet-permitted
    // status doc (e.g. before this player's first report) is expected and
    // routine, not a sign this session no longer belongs here.
    useEffect(() => {
        if (!roomID || !gameBoundary?.enabled || !playerName) {
            setBoundaryStatusDoc(null);
            return undefined;
        }
        const statusRef = fetchBoundaryStatusReferenceForPlayer(playerName, roomID);
        const unsubscribe = onSnapshot(
            statusRef,
            (snapshot) => setBoundaryStatusDoc(snapshot.exists() ? snapshot.data() : null),
            () => setBoundaryStatusDoc(null)
        );
        return () => unsubscribe();
    }, [roomID, gameBoundary?.enabled, playerName]);

    // Every other currently-exposed ("outside") player, for this player's
    // own map — mounted unconditionally once the boundary is enabled, same
    // gating and same reasoning as the own-status subscription above: it
    // must not depend on whether the map modal happens to be open
    // (docs/superpowers/specs/2026-10-12-live-location-visibility-design.md).
    // The query itself is already filtered to status == 'outside'
    // (fetchOutsideBoundaryStatusesQueryForRoom), which is what Firestore
    // can prove safe under the widened read rule; the viewer's own id is
    // still excluded here as a defensive belt-and-suspenders measure in
    // case that query ever included it.
    //
    // Stored RAW (unfiltered by freshness) — a disconnected player's status
    // doc can stay at 'outside' forever with no new snapshot ever arriving,
    // so filtering once here and freezing the result in state would leave a
    // stale dot on the map indefinitely. The freshness check instead runs at
    // render time, below, against the existing `nowMs` ticker, so a dot
    // disappears on its own once freshnessMs passes with no update — the
    // same "stop showing on its own, purely from time passing" treatment
    // deriveFreshStatus already gives this player's own status.
    useEffect(() => {
        if (!roomID || !gameBoundary?.enabled) {
            setOtherOutsidePositions([]);
            return undefined;
        }
        const outsideQuery = fetchOutsideBoundaryStatusesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            outsideQuery,
            (snapshot) => {
                const next = [];
                snapshot.docs.forEach((doc) => {
                    if (doc.id === normalizePlayerName(playerName)) return; // never show yourself
                    const data = doc.data();
                    next.push({
                        id: doc.id,
                        lat: data.lat,
                        lng: data.lng,
                        lastUsableMs: data.lastUsableReceivedAt?.toMillis?.() ?? null,
                    });
                });
                setOtherOutsidePositions(next);
            },
            () => setOtherOutsidePositions([])
        );
        return () => unsubscribe();
    }, [roomID, gameBoundary?.enabled, playerName]);

    // Derived at render time from the raw snapshot data above and the
    // existing `nowMs` ticker — not stored state of its own — so a position
    // goes stale and disappears purely from time passing, even with no new
    // Firestore snapshot (Finding 1). Also guards against a legacy/malformed
    // doc whose lat/lng are missing or not finite numbers.
    const freshOtherOutsidePositions = otherOutsidePositions
        .filter(
            (position) =>
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

    // Mounted always, regardless of whether the map modal is open —
    // closing PlayerMapModal must not stop location reporting.
    const { permissionState, ownPosition, requestPermission } = useBoundaryLocation({
        roomID,
        boundaryRevision: gameBoundary?.revision ?? null,
        boundaryEnabled: gameBoundary?.enabled ?? false,
        isGameActive,
        // Defaults to true (not eliminated) before playerData has loaded at
        // all — e.g. the waiting room, before gameStarted gates the player-doc
        // subscription above — matching this hook's own prior behavior of not
        // gating on aliveness before this change existed.
        isAlive: playerData?.isAlive ?? true,
    });

    // Derived from the subscribed status doc, the local ticker, and this
    // device's own identity/revision — not stored state of its own.
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

    // The countdown to exposure, derived each render from fields already on
    // the player's own status doc — no new Firestore field, per the spec.
    // `near` is the "not yet confirmed outside" status: deriveFreshStatus
    // returns it verbatim (see above), and outsideSince is the server
    // receipt time of the first outside fix in the current outside run
    // (docs/data-model.md). Once confirmMinSpanMs elapses without a
    // qualifying inside fix, the server confirms `outside` and this
    // countdown is replaced by the exposure notice below.
    const outsideSinceMs = boundaryStatusDoc?.outsideSince?.toMillis?.() ?? null;
    const isApproachingExposure = liveBoundaryStatus.status === 'near' && outsideSinceMs !== null;
    const secondsUntilExposed = isApproachingExposure
        ? Math.max(
              0,
              Math.ceil((GAME_BOUNDARY_CONFIG.confirmMinSpanMs - (nowMs - outsideSinceMs)) / 1000)
          )
        : null;

    // Spec: the "Location unavailable" explanation shows the last
    // successful check time "if any" — null (not just an empty string)
    // when there has never been one yet, e.g. before this player's very
    // first report lands, so the render below can tell "no time to show"
    // apart from "time formatted as empty". formatMessageTime already
    // handles a null/undefined Timestamp the same way, for the same
    // reason (a still-pending serverTimestamp()). Only computed for the
    // unavailable status, the only branch that renders it.
    const lastCheckTime =
        liveBoundaryStatus.status === 'unavailable'
            ? formatMessageTime(boundaryStatusDoc?.lastUsableReceivedAt ?? null)
            : null;

    const statusText = {
        inside: 'In game area.',
        near: 'You are near the edge of the game area; check the map.',
        outside:
            'You are outside the game area — your location is visible to everyone until you return.',
        unavailable: null, // handled separately below — needs its own explanation/Retry
    }[liveBoundaryStatus.status];

    // deriveFreshStatus checks staleness FIRST, against lastUsableMs — so a
    // player who has never had a usable fix in the last freshnessMs always
    // gets reason 'stale', even when the stored status doc itself carries a
    // more specific reason (e.g. a real permission_denied/timeout/unavailable
    // from an error report). An error report never updates lastUsableMs (only
    // an in-tolerance/inside/outside/near fix does), so that specific, truer
    // reason would otherwise be masked by the generic staleness fallback.
    // boundaryStatusDoc.reason is never itself 'stale' — nothing server-side
    // ever writes that value — so preferring it here can't loop back on
    // itself.
    const unavailableReason =
        liveBoundaryStatus.status === 'unavailable'
            ? liveBoundaryStatus.reason === 'stale' && boundaryStatusDoc?.reason
                ? boundaryStatusDoc.reason
                : (liveBoundaryStatus.reason ?? 'no_fix')
            : null;
    const unavailableText = unavailableReason
        ? (UNAVAILABLE_REASON_TEXT[unavailableReason] ?? DEFAULT_UNAVAILABLE_TEXT)
        : null;
    const showUnavailableRetry = UNAVAILABLE_RETRY_REASONS.has(unavailableReason);

    // The same words whether the player is looking at the page or has the
    // map open — PlayerMapModal gets this via its own `statusText` prop
    // (spec: status is visible "on the player page as well as inside the
    // map"), independent of whether the page itself is currently showing it
    // (e.g. suppressed below while permissionState is still 'unknown').
    const mapStatusText =
        liveBoundaryStatus.status === 'unavailable'
            ? `Location unavailable: ${unavailableText}`
            : statusText;

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
                    {gameBoundary?.enabled && (playerData?.isAlive ?? true) && (
                        <>
                            {permissionState === 'unknown' && (
                                <Box bg="blue.900" color="white" borderRadius="md" p={3} mb={2}>
                                    <Text mb={2}>
                                        Turn on location so we can check that you are inside the
                                        game area. The moderator sees your boundary status. Other
                                        players cannot see your location unless you leave the game
                                        area. Keep the game open for location updates.
                                    </Text>
                                    <Button size="sm" onClick={requestPermission}>
                                        Enable Location
                                    </Button>
                                </Box>
                            )}
                            {permissionState === 'denied' && (
                                <Box bg="orange.800" color="white" borderRadius="md" p={3} mb={2}>
                                    <Text mb={2}>
                                        Location permission was denied. Enable it in your browser or
                                        device settings, then retry.
                                    </Text>
                                    <Button size="sm" onClick={requestPermission}>
                                        Retry
                                    </Button>
                                </Box>
                            )}
                            {permissionState === 'unavailable' && (
                                <Box bg="orange.800" color="white" borderRadius="md" p={3} mb={2}>
                                    <Text>{UNAVAILABLE_REASON_TEXT.unavailable}</Text>
                                </Box>
                            )}
                            {isApproachingExposure && (
                                <Box
                                    bg="orange.700"
                                    color="white"
                                    borderRadius="md"
                                    p={2}
                                    mb={2}
                                    textAlign="center"
                                >
                                    <Text fontWeight="bold">
                                        Return to the game area — your location will be revealed to
                                        everyone in {secondsUntilExposed}s.
                                    </Text>
                                </Box>
                            )}
                            {liveBoundaryStatus.status === 'outside' && (
                                <Box
                                    bg="red.900"
                                    color="white"
                                    borderRadius="md"
                                    p={2}
                                    mb={2}
                                    textAlign="center"
                                >
                                    <Text fontWeight="bold">{statusText}</Text>
                                </Box>
                            )}
                            {liveBoundaryStatus.status !== 'outside' &&
                                liveBoundaryStatus.status !== 'unavailable' && (
                                    <Text mb={2}>{statusText}</Text>
                                )}
                            {/* Suppressed while permissionState is still 'unknown' — the
                                pre-permission box above already explains why there is
                                nothing to show yet; stacking both is confusing. */}
                            {permissionState !== 'unknown' &&
                                liveBoundaryStatus.status === 'unavailable' && (
                                    <Box
                                        bg="orange.800"
                                        color="white"
                                        borderRadius="md"
                                        p={3}
                                        mb={2}
                                    >
                                        <Text mb={showUnavailableRetry ? 2 : 0}>
                                            Location unavailable: {unavailableText}
                                            {lastCheckTime &&
                                                ` Last confirmed at ${lastCheckTime}.`}
                                        </Text>
                                        {showUnavailableRetry && (
                                            <Button size="sm" onClick={requestPermission}>
                                                Retry
                                            </Button>
                                        )}
                                    </Box>
                                )}
                            <Button size="sm" mb={2} onClick={onMapOpen}>
                                View Game Map
                            </Button>
                            <PlayerMapModal
                                isOpen={isMapOpen}
                                onClose={onMapClose}
                                boundaryVertices={gameBoundary.vertices}
                                otherPositions={freshOtherOutsidePositions}
                                ownPosition={
                                    ownPosition &&
                                    nowMs - ownPosition.acquiredAtMs <=
                                        GAME_BOUNDARY_CONFIG.freshnessMs
                                        ? ownPosition
                                        : null
                                }
                                statusText={mapStatusText}
                            />
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
