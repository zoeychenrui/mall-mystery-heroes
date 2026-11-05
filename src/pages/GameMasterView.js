import React from 'react';
import { useEffect, useRef, useState } from 'react';
import PlayersList from '../components/player_listing/PlayersList';
import { useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import {
    HStack,
    Heading,
    VStack,
    Box,
    Divider,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
} from '@chakra-ui/react';
import TaskCreationModal from '../components/task_components/TaskCreationModal';
import TaskList from '../components/task_components/TaskList';
import TaskListModal from '../components/task_components/TaskListModal';
import LeaderboardModal from '../components/game_end_components/LeaderboardModal';
import HeaderExecution from '../components/header_components/HeaderExecution';
import Log from '../components/logs_components/Log';
import CreateAlert from '../components/CreateAlert';
import {
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchRoomReferenceForRoom,
    addLogForRoom,
    addPlayerMessageForRoom,
    updateIsAliveForPlayer,
} from '../components/firebase_calls/dbCalls';
import { gameContext, executionContext } from '../components/Contexts';
import ChatInput from '../components/logs_components/ChatInput';
import PhotosDisplay from '../components/photos_display_component/PhotosDisplay';
import GMChatPanel from '../components/player_messages_components/GMChatPanel';
import ReconnectRequests from '../components/ReconnectRequests';
import { buildLeaderboardStandings } from '../game/leaderboard';

const GameMasterView = () => {
    const { roomID } = useParams();
    const [players, setPlayers] = useState([]);
    const [, setCompletedTasks] = useState([]);
    const [logList, setLogList] = useState([]);
    const createAlert = CreateAlert();
    const [showTaskCreationModal, setShowTaskCreationModal] = useState(false);
    const [showTaskListModal, setShowTaskListModal] = useState(false);
    const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    const [gameBoundary, setGameBoundary] = useState(undefined);
    const aliveNames = players.filter((player) => player.isAlive).map((player) => player.name);
    // Every player's name, alive or not — HeaderExecution threads this to
    // LivePlayerMapButton (unlike aliveNames, which the live map must NOT
    // use: an eliminated player's status doc needs its real name resolved
    // too, not a fallback to the raw normalized id).
    const allPlayerNames = players.map((player) => player.name);
    const logsBoxRef = useRef(null);

    // Players and logs are both live subscriptions now, not fetched once and
    // mutated by hand (docs/improvements.md items 13 and 22) — this is what
    // used to disagree with PlayersList's own independent subscription and
    // go stale across reloads/other tabs.
    useEffect(() => {
        if (!roomID) return undefined;
        const playersQuery = fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID);
        const unsubscribe = onSnapshot(playersQuery, (snapshot) => {
            setPlayers(
                snapshot.docs.map((doc) => ({
                    name: doc.data().name,
                    avatarUrl: doc.data().avatarUrl,
                    score: doc.data().score,
                    targets: doc.data().targets,
                    openSeason: doc.data().openSeason,
                    isAlive: doc.data().isAlive,
                }))
            );
        });
        return () => unsubscribe();
    }, [roomID]);

    useEffect(() => {
        if (!roomID) return undefined;
        const logsQuery = fetchLogsQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
            setLogList(snapshot.docs.map((doc) => doc.data()));
        });
        return () => unsubscribe();
    }, [roomID]);

    // Keeps the logs panel pinned to the newest entry as it grows, instead
    // of leaving the GM scrolled to wherever they happened to be when the
    // next message arrived.
    useEffect(() => {
        const logsBox = logsBoxRef.current;
        if (!logsBox) return;
        logsBox.scrollTop = logsBox.scrollHeight;
    }, [logList]);

    // isGameActive is set true at room creation and false by endGame
    // (docs/improvements.md item 15's "relatedly" note) — this is what
    // reads it, so a room whose game has ended stops accepting commands
    // from any tab still open on it, not just the one that clicked "End
    // Game" (which navigates itself away separately).
    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(roomRef, (snapshot) => {
            setIsGameActive(snapshot.data()?.isGameActive ?? true);
            setGameBoundary(snapshot.data()?.gameBoundary);
        });
        return () => unsubscribe();
    }, [roomID]);

    //adds a new log entry. The logs subcollection subscription above picks
    // up the write and updates logList — no local append needed.
    //
    // Catches its own errors (docs/improvements.md item 10) rather than
    // letting them propagate: addLog is called from many places (kills,
    // revives, open season toggles, photo judgments), and a failed log write
    // shouldn't block or appear to fail the primary action that triggered it.
    const addLog = async (newLog, color) => {
        try {
            await addLogForRoom(newLog, color, roomID);
        } catch (error) {
            console.error('Error adding log: ', error);
            createAlert('warning', 'Log not saved', error.message, 1500);
        }
    };

    // Mirrors addLog's error isolation (docs/improvements.md item 10) — a
    // failed player-facing broadcast shouldn't block or appear to fail the
    // primary action that triggered it, same reasoning as addLog itself.
    const broadcast = async (text) => {
        try {
            await addPlayerMessageForRoom(
                { type: 'broadcast', recipient: null, text, standings: null },
                roomID
            );
        } catch (error) {
            console.error('Error broadcasting to players: ', error);
        }
    };

    // Sibling to broadcast(text) above, same error-isolation reasoning — this
    // one carries structured mission data instead of free text (see the
    // 'mission' render branch in MessageFeed.js).
    const broadcastMission = async (mission) => {
        try {
            await addPlayerMessageForRoom(
                { type: 'mission', recipient: null, text: null, standings: null, mission },
                roomID
            );
        } catch (error) {
            console.error('Error broadcasting mission to players: ', error);
        }
    };

    // The players subscription above picks up the kill once executeKill's
    // write lands — no local array mutation needed.
    const handleKillPlayer = async (killedPlayerName, assassinName, openSznstatus) => {
        if (openSznstatus === true) {
            await handleOpenSznended(killedPlayerName);
            await addLog('open season has ended for ' + killedPlayerName, 'pink.400');
        }
        await addLog(killedPlayerName + ' was killed by ' + assassinName, 'red.400');
        await broadcast(killedPlayerName + ' was killed by ' + assassinName);
    };

    const handleOpenSznstarted = async (openSznplayer) => {
        await addLog(openSznplayer + ' has open season on them', 'lightblue');
        await broadcast(openSznplayer + ' has open season on them');
    };

    const handleOpenSznended = async (openSznplayer) => {
        await addLog('open season has ended for ' + openSznplayer, 'pink.400');
        await broadcast('open season has ended for ' + openSznplayer);
    };

    // The players subscription above picks up the revive once
    // updateIsAliveForPlayer's write lands — no local array mutation needed.
    const handlePlayerRevive = async (revivedPlayerName) => {
        await updateIsAliveForPlayer(revivedPlayerName, true, roomID);
        await addLog(revivedPlayerName + ' was revived', 'blue.300');
        await broadcast(revivedPlayerName + ' was revived');
    };

    // TaskList (docs/improvements.md item 15) owns its own live subscription
    // to the tasks collection, so a new task shows up there without this
    // needing to track a parallel copy — this only logs the event and
    // closes the creation modal (docs/superpowers/specs/2026-08-04-
    // mission-modal-ui-design.md — creation closes automatically on
    // success).
    const handleNewTaskAdded = async (newTask) => {
        setShowTaskCreationModal(false);
        await addLog('Added new task: ' + newTask.title, 'yellow.400');
        await broadcastMission({
            title: newTask.title,
            description: newTask.description,
            taskType: newTask.taskType,
            pointValue: newTask.pointValue,
            maxCompletions: newTask.maxCompletions,
        });
    };

    const handleShowMissionCreation = () => {
        setShowTaskCreationModal(true);
    };

    const handleShowMissionList = () => {
        setShowTaskListModal(true);
    };

    const handleShowLeaderboardView = () => {
        setShowLeaderboardModal(true);
    };

    //updates completedTasks
    const handleTaskCompleted = async (task) => {
        setCompletedTasks((completedTasks) => [...completedTasks, task]);
        await addLog('Completed task: ' + task, 'green.400');
        await broadcast('Completed task: ' + task);
    };

    //updates logList with remapped targets
    const handleRemapping = async (log) => {
        await addLog(log, 'blue.500');
    };

    // All three below used to feed RemapPlayerModal — a blocking popup
    // that fired on every kill/revive/mission completion that reassigned
    // targets, which the GM found "very annoying, not necessary" since
    // every remap it announces is already logged to the GM log
    // (handleRemapping, above). The popup and the state it displayed are
    // gone; these three stay as no-ops rather than being removed outright,
    // since ChatInput.js and PhotosDisplay.js still call all three from
    // several call sites each — a deeper cleanup, not needed to fix this
    // bug.
    const handleAddNewTargets = () => {};
    const handleAddNewAssassins = () => {};
    const handleSetShowMessageToTrue = () => {};

    // values for executionContext Provider
    const executionContextProviderValues = {
        handleKillPlayer,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleRemapping,
        handlePlayerRevive,
        handleTaskCompleted,
        handleNewTaskAdded,
        handleSetShowMessageToTrue,
        handleShowLeaderboardView,
        handleShowMissionCreation,
        handleShowMissionList,
        handleOpenSznstarted,
        handleOpenSznended,
        addLog,
    };

    return (
        <gameContext.Provider value={{ roomID, players, isGameActive }}>
            <Box sx={styles.container}>
                <TaskCreationModal
                    isOpen={showTaskCreationModal}
                    onClose={() => setShowTaskCreationModal(false)}
                    handleNewTaskAdded={handleNewTaskAdded}
                />
                <TaskListModal
                    isOpen={showTaskListModal}
                    onClose={() => setShowTaskListModal(false)}
                />
                {/* TaskAccordion needs addLog for mission edit/delete
                    announcements, so it shares the execution context here. */}
                <executionContext.Provider value={executionContextProviderValues}>
                    <LeaderboardModal
                        isOpen={showLeaderboardModal}
                        onClose={() => setShowLeaderboardModal(false)}
                        standings={buildLeaderboardStandings(players)}
                    />
                </executionContext.Provider>

                <Box h="6%" m="2px" marginX="4px">
                    <HeaderExecution
                        addLog={addLog}
                        arrayOfAlivePlayers={aliveNames}
                        allPlayerNames={allPlayerNames}
                        gameBoundary={gameBoundary}
                    />
                </Box>

                {/* ReconnectRequests needs addLog from executionContext, but
                    belongs visually in the header area, which sits outside
                    both narrower executionContext.Provider scopes below —
                    same situation as TaskAccordion above, same fix. */}
                <executionContext.Provider value={executionContextProviderValues}>
                    <ReconnectRequests />
                </executionContext.Provider>

                <HStack sx={styles.gameDisplayWrapper}>
                    <Box sx={styles.playersListWrapper}>
                        <Heading sx={styles.playerListHeader}>Players ({players.length})</Heading>
                        <Divider />
                        <PlayersList players={players} />
                    </Box>

                    <Box sx={styles.logsWrapper}>
                        <Tabs
                            display="flex"
                            flexDirection="column"
                            h="100%"
                            minH={0}
                            variant="unstyled"
                        >
                            <TabList flexShrink={0}>
                                <Tab sx={styles.tabHeader}>Player Chat</Tab>
                                <Tab sx={styles.tabHeader}>Logs</Tab>
                            </TabList>
                            <TabPanels flex="1" minH={0}>
                                <TabPanel h="100%" display="flex" flexDirection="column" p={2}>
                                    <GMChatPanel roomID={roomID} />
                                </TabPanel>
                                <TabPanel h="100%" display="flex" flexDirection="column" p={2}>
                                    <Box
                                        sx={styles.logsBox}
                                        ref={logsBoxRef}
                                        data-testid="logs-box"
                                    >
                                        <Log logList={logList} />
                                    </Box>
                                </TabPanel>
                            </TabPanels>
                            <Divider />
                            <executionContext.Provider value={executionContextProviderValues}>
                                <Box sx={styles.logInput}>
                                    <ChatInput />
                                </Box>
                            </executionContext.Provider>
                        </Tabs>
                    </Box>

                    <executionContext.Provider value={executionContextProviderValues}>
                        <VStack sx={styles.rightHandStack}>
                            <Box sx={styles.photosBox}>
                                <PhotosDisplay players={players} />
                            </Box>
                            <Box sx={styles.missionPanelWrapper}>
                                <Heading sx={styles.chatHeaderText}>Missions</Heading>
                                <Divider />
                                <TaskList onStartMission={handleShowMissionCreation} />
                            </Box>
                        </VStack>
                    </executionContext.Provider>
                </HStack>
            </Box>
        </gameContext.Provider>
    );
};

export default GameMasterView;

const styles = {
    gameDisplayWrapper: {
        alignItems: 'left',
        p: '5px',
        flex: '1',
        m: '2px',
        overflow: 'hidden',
    },
    container: {
        h: '100vh',
        display: 'flex',
        flexDirection: 'column',
    },
    playersListWrapper: {
        w: '20%',
        minW: '20%',
        h: '95%',
        borderWidth: '2px',
        borderRadius: '1.5rem',
        px: '2px',
        mx: '8px',
    },
    playerListHeader: {
        fontSize: '28px',
        fontWeight: 'bold',
        textAlign: 'center',
        m: '4px',
        my: '8px',
    },
    chatHeaderText: {
        size: 'lg',
        textAlign: 'center',
        mb: '4px',
        fontSize: '26px',
    },
    logsWrapper: {
        borderWidth: '2px',
        borderRadius: '2xl',
        p: '4px',
        w: '55%',
        h: '95%',
        mx: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
    },
    logsBox: {
        overflow: 'auto',
        flex: '1',
        minH: 0,
    },
    logInput: {
        flex: '0 0 56px',
    },
    rightHandStack: {
        ml: '10px',
        mr: '16px',
        w: '25%',
        minW: '25%',
        // 95%, not 100% — matches playersListWrapper/logsWrapper, its
        // siblings in the same row. The mismatch used to make the photos
        // box's border extend past the players/logs boxes below them.
        h: '95%',
    },
    photosBox: {
        w: { base: '100%', md: '100%' },
        h: '58%',
    },
    missionPanelWrapper: {
        w: '100%',
        flex: '1',
        mt: '8px',
        borderWidth: '2px',
        borderRadius: '2xl',
        p: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
    },
    tabHeader: {
        fontSize: '28px',
        fontWeight: 'bold',
        textAlign: 'center',
        w: '50%',
        outline: 'none',
        boxShadow: 'none',
        _selected: { borderBottom: '2px solid', borderColor: 'blue.300', color: 'blue.300' },
        borderBottom: '2px solid',
        borderColor: 'gray.300',
    },
};
