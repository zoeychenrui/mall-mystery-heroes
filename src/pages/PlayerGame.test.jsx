/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the post-join waiting screen and the in-game target/status view:
 * renders room/player info, updates its status line when gameStarted flips,
 * redirects home when the room stops existing, shows the player's target(s)
 * or a placeholder once the game has started, shows an eliminated state,
 * and Leave opens a confirmation dialog, calls `leaveGame`, then signs out
 * + clears the stored session
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md,
 * docs/superpowers/specs/2026-08-08-player-target-view-design.md,
 * docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
 * Explicit mock factories for 'firebase/auth', 'firebase/firestore', and
 * '../components/firebase_calls/dbCalls' — see RequireAuth.test.jsx and
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe here.
 * playerSession is left unmocked: it touches only real jsdom localStorage.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import PlayerGame from './PlayerGame';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchTasksQueryForRoom,
    fetchBoundaryStatusReferenceForPlayer,
} from '../components/firebase_calls/dbCalls';
import { leaveGame } from '../components/leaveGame';
import { writePlayerSession, readPlayerSession } from '../utils/playerSession';
import useBoundaryLocation from '../hooks/useBoundaryLocation';
// require(), not a named import — gameBoundary.js is CommonJS by design
// (see its own header comment); PlayerGame.js itself loads it the same way.
const { GAME_BOUNDARY_CONFIG } = require('../game/gameBoundary');

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchRoomReferenceForRoom: jest.fn(),
    fetchPlayerReferenceForRoom: jest.fn(),
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom: jest.fn(),
    fetchTasksQueryForRoom: jest.fn(),
    fetchBoundaryStatusReferenceForPlayer: jest.fn(() => 'status-ref'),
    fetchOutsideBoundaryStatusesQueryForRoom: jest.fn(() => 'outside-statuses-query'),
}));
jest.mock('../components/leaveGame', () => ({ leaveGame: jest.fn() }));
jest.mock('../components/reportPlayerLocation', () => ({ reportPlayerLocation: jest.fn() }));
jest.mock('../hooks/useBoundaryLocation', () =>
    jest.fn(() => ({
        permissionState: 'unknown',
        lastResult: null,
        ownPosition: null,
        requestPermission: jest.fn(),
    }))
);
// Mocked, not the real Chakra modal — PlayerMapModal has its own test file.
// The Close button here is this stub's own affordance, not the real
// modal's ModalCloseButton, so the "closing the map modal" test below has
// something to click without pulling in the real Modal/GameMap tree.
// `mockLastPlayerMapModalProps` captures every render's props (regardless
// of isOpen, since the function component itself still runs) so tests can
// assert what PlayerGame actually hands down — e.g. the freshness-filtered
// ownPosition (Finding 6) and the plain-language statusText (Finding 2).
let mockLastPlayerMapModalProps;
jest.mock('../components/map_components/PlayerMapModal', () => (props) => {
    mockLastPlayerMapModalProps = props;
    return props.isOpen ? (
        <div data-testid="mock-player-map-modal">
            <button onClick={props.onClose}>Close</button>
        </div>
    ) : null;
});
// Stubbed — has its own dedicated test file (PlayerTaskListModal.test.jsx).
// This file only checks that the button opens/closes it and passes roomID
// through, same reasoning as the MessageFeed/MessageComposer stubs below.
jest.mock(
    '../components/task_components/PlayerTaskListModal',
    () => (props) =>
        props.isOpen ? (
            <div>
                player-task-list-modal-stub roomID={props.roomID}
                <button onClick={props.onClose}>close-missions-modal</button>
            </div>
        ) : null
);
// Stubbed — each has its own thorough test file (MessageFeed.test.jsx,
// MessageComposer.test.jsx). This file stays focused on PlayerGame's own
// status-line logic and on wiring MessageFeed's props, not re-testing
// MessageFeed's internals — same reasoning GameMasterView.test.jsx stubs
// ChatInput.
jest.mock('../components/player_messages_components/MessageFeed', () => (props) => (
    <div>
        <div>
            message-feed-stub roomID={props.roomID} playerName={props.playerName}
        </div>
        <div data-testid="pending-messages">{JSON.stringify(props.pendingMessages)}</div>
        <button onClick={() => props.onPendingMessageConfirmed()}>confirm-pending</button>
    </div>
));
jest.mock('../components/player_messages_components/MessageComposer', () => (props) => (
    <div>
        <div>
            message-composer-stub roomID={props.roomID} playerName={props.playerName} isGameActive=
            {String(props.isGameActive)} players={JSON.stringify(props.players)} missions=
            {JSON.stringify(props.missions)}
        </div>
        <button
            onClick={() =>
                props.onOptimisticSend({
                    id: 'test-pending-id',
                    type: 'chat',
                    sender: props.playerName,
                    text: 'hello',
                })
            }
        >
            trigger-optimistic-send
        </button>
        <button onClick={() => props.onOptimisticSendFailed('test-pending-id')}>
            trigger-optimistic-fail
        </button>
    </div>
));

const renderWaiting = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/waiting']}>
                <Routes>
                    <Route path="/rooms/:roomID/waiting" element={<PlayerGame />} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    fetchRoomReferenceForRoom.mockReturnValue('room-ref');
    fetchPlayerReferenceForRoom.mockReturnValue('player-ref');
    fetchBoundaryStatusReferenceForPlayer.mockReturnValue('status-ref');
    // clearMocks (jest.config.js) only clears call history, not a mocked
    // implementation set via mockReturnValue — same reason the two lines
    // above re-seed every test rather than relying on the jest.mock
    // factory's own default sticking around once some other test (e.g.
    // the Retry test below) has overridden it.
    useBoundaryLocation.mockReturnValue({
        permissionState: 'unknown',
        lastResult: null,
        ownPosition: null,
        requestPermission: jest.fn(),
    });
    signOut.mockResolvedValue(undefined);
    leaveGame.mockResolvedValue({
        removedPlayerName: 'Alice',
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});

describe('PlayerGame', () => {
    it('shows the stored player name and room ID, waiting for the host', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Alice joined Fluffy42317')).toBeInTheDocument();
        expect(screen.getByText('Waiting for the host to start...')).toBeInTheDocument();
    });

    it('hides the waiting message once gameStarted flips true', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText('Waiting for the host to start...')).not.toBeInTheDocument();
    });

    it('clears the session and redirects home when the room no longer exists', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => false });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when onSnapshot reports a permission error', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback, errorCallback) => {
            if (ref === 'room-ref') {
                errorCallback({
                    code: 'permission-denied',
                    message: 'Missing or insufficient permissions.',
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when the player-doc subscription reports a permission error', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback, errorCallback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                errorCallback({
                    code: 'permission-denied',
                    message: 'Missing or insufficient permissions.',
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when the player doc no longer exists', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => false });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('opens a confirmation dialog instead of leaving immediately', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

        expect(
            screen.getByText(
                "Leave the game? You'll be removed, and won't be able to rejoin once the game has started."
            )
        ).toBeInTheDocument();
        expect(leaveGame).not.toHaveBeenCalled();
    });

    it('calls leaveGame, signs out, clears the session, and navigates home once confirmed', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(leaveGame).toHaveBeenCalledWith('Fluffy42317');
        // handleConfirmLeave chains two real awaits (leaveGame, then signOut)
        // before clearing the session — userEvent's click doesn't wait for a
        // fire-and-forget onClick handler's own promise chain to drain, so
        // the post-click assertions need waitFor here (same pattern as
        // ChatInput.test.jsx/MessageComposer.test.jsx use for async onClick
        // handlers), unlike PlayerRemove.test.jsx's single-await handler.
        await waitFor(() => expect(readPlayerSession()).toBeNull());
        expect(signOut).toHaveBeenCalled();
        expect(await screen.findByText('Home page')).toBeInTheDocument();
    });

    it('calls neither leaveGame nor signOut when Go Back is clicked', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
        await userEvent.click(screen.getByRole('button', { name: 'Go Back' }));

        expect(leaveGame).not.toHaveBeenCalled();
        expect(signOut).not.toHaveBeenCalled();
        expect(readPlayerSession()).not.toBeNull();
    });

    it('opens the missions modal when Missions is clicked, and closes it again', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText(/player-task-list-modal-stub/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Missions' }));

        expect(
            screen.getByText('player-task-list-modal-stub roomID=Fluffy42317')
        ).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'close-missions-modal' }));

        expect(screen.queryByText(/player-task-list-modal-stub/)).not.toBeInTheDocument();
    });

    it('opens the leaderboard modal when Leaderboard is clicked, showing the live standings', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        fetchPlayersQueryByDescendPointsThenIsAliveForRoom.mockReturnValue('players-query');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: true, targets: [] }) });
            } else if (ref === 'players-query') {
                callback({
                    docs: [
                        { data: () => ({ name: 'Bob', score: 40, isAlive: true }) },
                        { data: () => ({ name: 'Alice', score: 10, isAlive: true }) },
                    ],
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText(/Bob — 40/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Leaderboard' }));

        expect(screen.getByText(/1\. Bob — 40/)).toBeInTheDocument();
        expect(screen.getByText(/2\. Alice — 10/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        // LeaderboardModal is a real Chakra <Modal>, unlike the stubbed
        // PlayerTaskListModal above — its exit animation means the content
        // doesn't vanish from the DOM synchronously with the click.
        await waitFor(() => expect(screen.queryByText(/Bob — 40/)).not.toBeInTheDocument());
    });

    it('shows an error and does not sign out when leaveGame is rejected', async () => {
        leaveGame.mockRejectedValue(new Error('You have not joined this room.'));
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText('You have not joined this room.')).toBeInTheDocument();
        expect(signOut).not.toHaveBeenCalled();
        expect(readPlayerSession()).not.toBeNull();
    });

    it('subscribes to the player doc once gameStarted is true and shows the target', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: true, targets: ['Bob'] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Your target: Bob')).toBeInTheDocument();
        expect(
            screen.getByText(
                'message-composer-stub roomID=Fluffy42317 playerName=Alice isGameActive=true players=[] missions=[]'
            )
        ).toBeInTheDocument();
    });

    it('lifts an optimistic message from MessageComposer into MessageFeed pendingMessages, then clears it on confirmation', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({}) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByTestId('pending-messages')).toHaveTextContent('[]');

        await userEvent.click(screen.getByRole('button', { name: 'trigger-optimistic-send' }));

        expect(screen.getByTestId('pending-messages')).toHaveTextContent(
            JSON.stringify([
                { id: 'test-pending-id', type: 'chat', sender: 'Alice', text: 'hello' },
            ])
        );

        await userEvent.click(screen.getByRole('button', { name: 'confirm-pending' }));

        expect(screen.getByTestId('pending-messages')).toHaveTextContent('[]');
    });

    it('removes a failed optimistic message from pendingMessages', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({}) });
            }
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'trigger-optimistic-send' }));
        await userEvent.click(screen.getByRole('button', { name: 'trigger-optimistic-fail' }));

        expect(screen.getByTestId('pending-messages')).toHaveTextContent('[]');
    });

    it('does not subscribe to the player doc while still waiting for the host', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(fetchPlayerReferenceForRoom).not.toHaveBeenCalled();
    });

    it('shows a placeholder when alive but not yet assigned a target', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: true, targets: [] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Waiting for your target...')).toBeInTheDocument();
    });

    it('shows an eliminated message instead of a target once isAlive is false', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: false, targets: [] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText("You've been eliminated")).toBeInTheDocument();
        expect(
            screen.getByText(/you may be revived if the host assigns you a revival mission/i)
        ).toBeInTheDocument();
        expect(screen.queryByText(/your target/i)).not.toBeInTheDocument();
    });

    it('mounts the message feed even before the game has started', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(
            screen.getByText('message-feed-stub roomID=Fluffy42317 playerName=Alice')
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                'message-composer-stub roomID=Fluffy42317 playerName=Alice isGameActive=true players=[] missions=[]'
            )
        ).toBeInTheDocument();
    });

    it('hides the target-status text but keeps chat mounted once the game has ended', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({ gameStarted: true, isGameActive: false }),
                });
            }
            return () => {};
        });

        renderWaiting();

        // The dedicated "Game Over" screen is gone — the game-end
        // announcements now arrive as real chat messages instead
        // (Endgamebutton.js posts them, MessageBubble.js renders them).
        expect(screen.queryByText('Game Over')).not.toBeInTheDocument();
        expect(screen.queryByText(/your target/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/waiting for the host/i)).not.toBeInTheDocument();
        expect(
            screen.getByText('message-feed-stub roomID=Fluffy42317 playerName=Alice')
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                'message-composer-stub roomID=Fluffy42317 playerName=Alice isGameActive=false players=[] missions=[]'
            )
        ).toBeInTheDocument();
    });

    it('shows the game-ended popup and a pinned banner once the game has ended, and closing the popup keeps the banner', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({ gameStarted: true, isGameActive: false }),
                });
            }
            return () => {};
        });

        renderWaiting();

        // The popup opens via a useEffect keyed on isGameActive, which
        // runs after the initial synchronous render.
        expect(await screen.findByText('GAME ENDED')).toBeInTheDocument();
        expect(screen.getAllByText(/PLEASE HEAD BACK TO THE STARTING AREA/).length).toBeGreaterThan(
            0
        );

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        await waitFor(() => expect(screen.queryByText('GAME ENDED')).not.toBeInTheDocument());
        // The pinned banner (not the popup) is what should remain.
        expect(screen.getByText(/PLEASE HEAD BACK TO THE STARTING AREA/)).toBeInTheDocument();
    });

    it('does not show the game-ended popup or banner while the game is still active', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText('GAME ENDED')).not.toBeInTheDocument();
        expect(screen.queryByText(/PLEASE HEAD BACK TO THE STARTING AREA/)).not.toBeInTheDocument();
    });

    it('subscribes to the roster and missions once the game has started, and passes both to MessageComposer', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        fetchPlayersQueryByDescendPointsThenIsAliveForRoom.mockReturnValue('players-query');
        fetchTasksQueryForRoom.mockReturnValue('missions-query');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: true, targets: ['Bob'] }) });
            } else if (ref === 'players-query') {
                callback({
                    docs: [
                        {
                            data: () => ({
                                name: 'Bob',
                                score: 0,
                                targets: [],
                                openSeason: false,
                                isAlive: true,
                            }),
                        },
                    ],
                });
            } else if (ref === 'missions-query') {
                callback({
                    docs: [
                        {
                            data: () => ({
                                taskIndex: 1,
                                title: 'Find the clue',
                                taskType: 'Task',
                                isComplete: false,
                                completedBy: [],
                            }),
                        },
                    ],
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(
            screen.getByText(
                'message-composer-stub roomID=Fluffy42317 playerName=Alice isGameActive=true players=' +
                    JSON.stringify([
                        { name: 'Bob', score: 0, targets: [], openSeason: false, isAlive: true },
                    ]) +
                    ' missions=' +
                    JSON.stringify([
                        {
                            taskIndex: 1,
                            title: 'Find the clue',
                            taskType: 'Task',
                            isComplete: false,
                            completedBy: [],
                        },
                    ])
            )
        ).toBeInTheDocument();
    });

    // --- Game boundary tracking/status UI (Phase 3) ---------------------

    it('shows the pre-permission explanation and an Enable Location button once a boundary is published', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(
            screen.getByText(/Turn on location so we can check that you are inside the game area/)
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enable Location' })).toBeInTheDocument();
    });

    it('hides the whole location panel for an eliminated player, even with a boundary published', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: true,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: false, targets: [] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText('Enable Location')).not.toBeInTheDocument();
        expect(
            screen.queryByText(/Turn on location so we can check that you are inside the game area/)
        ).not.toBeInTheDocument();
    });

    it('shows "In game area." when the live-derived status is inside', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        status: 'inside',
                        reason: null,
                        lastUsableReceivedAt: { toMillis: () => Date.now() },
                        boundaryRevision: 1,
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('In game area.')).toBeInTheDocument();
    });

    it('shows the persistent outside warning', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        status: 'outside',
                        reason: null,
                        lastUsableReceivedAt: { toMillis: () => Date.now() },
                        boundaryRevision: 1,
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        // This box's copy changed in Task 7 (live location visibility): a
        // confirmed-outside player is now told their location is visible to
        // everyone, since another player's/the GM's map now shows it —
        // replacing the old bare "please return inside" wording.
        expect(screen.getByText(/visible to everyone/i)).toBeInTheDocument();
    });

    it('shows Location unavailable once the stored status has gone stale, even though it was last Inside', () => {
        jest.useFakeTimers();
        try {
            writePlayerSession('Fluffy42317', 'Alice');
            // Non-'unknown', since this status doc can only exist after this
            // player already granted permission and reported at least once —
            // 'unknown' is covered by its own dedicated test below, where the
            // unavailable line must stay hidden instead.
            useBoundaryLocation.mockReturnValue({
                permissionState: 'granted',
                lastResult: null,
                ownPosition: null,
                requestPermission: jest.fn(),
            });
            const lastUsableMs = Date.now();
            onSnapshot.mockImplementation((ref, callback) => {
                if (ref === 'room-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            gameStarted: false,
                            gameBoundary: { enabled: true, revision: 1, vertices: [] },
                        }),
                    });
                } else if (ref === 'status-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            status: 'inside',
                            reason: null,
                            lastUsableReceivedAt: {
                                toMillis: () => lastUsableMs,
                                toDate: () => new Date(lastUsableMs),
                            },
                            boundaryRevision: 1,
                        }),
                    });
                }
                return () => {};
            });

            renderWaiting();

            // Fresh at mount — the stale-ness is introduced only by the
            // local ticker advancing below, with no new Firestore snapshot.
            expect(screen.getByText('In game area.')).toBeInTheDocument();

            act(() => {
                jest.advanceTimersByTime(31000);
            });

            expect(screen.getByText(/Location unavailable/)).toBeInTheDocument();
            // Spec (docs/superpowers/specs/2026-09-30-game-boundaries-design.md:119):
            // "Location unavailable" must also show the last successful
            // check time, when there is one — this doc's own
            // lastUsableReceivedAt, formatted the same way MessageBubble's
            // chat timestamps already are.
            expect(screen.getByText(/Last confirmed at/)).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not show a last-confirmed time once unavailable when no report has ever landed', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        // Non-'unknown' for the same reason as the stale-status test above.
        useBoundaryLocation.mockReturnValue({
            permissionState: 'granted',
            lastResult: null,
            ownPosition: null,
            requestPermission: jest.fn(),
        });
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                // Before this player's first report, the status doc does
                // not exist at all yet — "if any" means render nothing
                // extra, not an empty/garbled time.
                callback({ exists: () => false });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText(/Location unavailable/)).toBeInTheDocument();
        expect(screen.queryByText(/Last confirmed at/)).not.toBeInTheDocument();
    });

    it('hides status entirely once the boundary is disabled', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: false, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText('In game area.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Enable Location' })).not.toBeInTheDocument();
    });

    it('Retry calls requestPermission again after a denial', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });
        const requestPermission = jest.fn();
        useBoundaryLocation.mockReturnValue({
            permissionState: 'denied',
            lastResult: null,
            ownPosition: null,
            requestPermission,
        });

        renderWaiting();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(requestPermission).toHaveBeenCalled();
    });

    it('closing the map modal does not unmount or otherwise stop useBoundaryLocation', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
        const mockModal = screen.getByTestId('mock-player-map-modal');
        const argsWhileOpen =
            useBoundaryLocation.mock.calls[useBoundaryLocation.mock.calls.length - 1][0];

        // Scoped to the mock modal itself — the "Game area is ready" toast
        // fired on this same mount also renders its own Close button with
        // an accessible name matching /close/i, which would otherwise make
        // this query ambiguous.
        fireEvent.click(within(mockModal).getByRole('button', { name: /close/i }));

        expect(screen.queryByTestId('mock-player-map-modal')).not.toBeInTheDocument();
        // useBoundaryLocation is called once per PlayerGame render
        // regardless of the modal's own open/closed state — it kept being
        // called across the toggle (never unmounted), and with the exact
        // same roomID/boundary/isGameActive args both times, i.e. closing
        // the modal was not a side channel that touched the hook's inputs.
        const callsAfterToggle = useBoundaryLocation.mock.calls.length;
        expect(callsAfterToggle).toBeGreaterThan(0);
        const argsAfterClose = useBoundaryLocation.mock.calls[callsAfterToggle - 1][0];
        expect(argsAfterClose).toEqual(argsWhileOpen);
    });

    it('shows a "Game area updated" notice when the boundary revision increases after the room is already loaded', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        let roomCallback;
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                roomCallback = callback;
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        act(() => {
            roomCallback({
                exists: () => true,
                data: () => ({
                    gameStarted: false,
                    gameBoundary: { enabled: true, revision: 2, vertices: [] },
                }),
            });
        });

        expect(await screen.findByText(/Game area updated/)).toBeInTheDocument();
    });

    // --- Final-review fixes: plain-language reasons, map status, and
    // ownPosition freshness (Findings 1, 2, 6) --------------------------

    it('hides the Location unavailable line while permissionState is unknown, since the pre-permission box already explains it', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });
        // useBoundaryLocation's default mock (beforeEach) already returns
        // permissionState: 'unknown'.

        renderWaiting();

        expect(screen.getByRole('button', { name: 'Enable Location' })).toBeInTheDocument();
        expect(screen.queryByText(/Location unavailable/)).not.toBeInTheDocument();
    });

    it('shows an explanation when the browser has no geolocation API at all', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });
        useBoundaryLocation.mockReturnValue({
            permissionState: 'unavailable',
            lastResult: null,
            ownPosition: null,
            requestPermission: jest.fn(),
        });

        renderWaiting();

        expect(
            screen.getByText(/Location services are unavailable on this device/)
        ).toBeInTheDocument();
    });

    it('prefers a more specific stored reason over the generic staleness fallback', () => {
        // Finding 1: deriveFreshStatus checks staleness FIRST against
        // lastUsableMs, so a player with no usable fix in the freshness
        // window always gets reason 'stale' locally — even when the
        // stored status doc's own `reason` (from a real error report)
        // says exactly why: here, permission_denied.
        writePlayerSession('Fluffy42317', 'Alice');
        useBoundaryLocation.mockReturnValue({
            permissionState: 'granted',
            lastResult: null,
            ownPosition: null,
            requestPermission: jest.fn(),
        });
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        status: 'unavailable',
                        reason: 'permission_denied',
                        lastUsableReceivedAt: null,
                        boundaryRevision: 1,
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText(/Location permission was denied/)).toBeInTheDocument();
    });

    it('offers Retry inside the unavailable-status box when the stored reason is a timeout, not just on denial', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        const requestPermission = jest.fn();
        useBoundaryLocation.mockReturnValue({
            permissionState: 'granted',
            lastResult: null,
            ownPosition: null,
            requestPermission,
        });
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        status: 'unavailable',
                        reason: 'timeout',
                        lastUsableReceivedAt: null,
                        boundaryRevision: 1,
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(requestPermission).toHaveBeenCalled();
    });

    it("passes this player's own isAlive (from the subscribed player doc) through to useBoundaryLocation", () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: true,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: false, targets: [] }) });
            }
            return () => {};
        });

        renderWaiting();

        const lastCallArgs =
            useBoundaryLocation.mock.calls[useBoundaryLocation.mock.calls.length - 1][0];
        expect(lastCallArgs.isAlive).toBe(false);
    });

    it('defaults isAlive to true for useBoundaryLocation before the player doc has loaded at all', () => {
        // Before gameStarted flips true, the player-doc subscription never
        // even mounts (see "does not subscribe to the player doc while
        // still waiting for the host" above), so playerData stays null —
        // this must not be mistaken for "eliminated" and block tracking
        // in the waiting room, where a boundary can already be published.
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        const lastCallArgs =
            useBoundaryLocation.mock.calls[useBoundaryLocation.mock.calls.length - 1][0];
        expect(lastCallArgs.isAlive).toBe(true);
    });

    it('passes the current status text through to PlayerMapModal so it is visible inside the map too', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        status: 'inside',
                        reason: null,
                        lastUsableReceivedAt: { toMillis: () => Date.now() },
                        boundaryRevision: 1,
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

        expect(mockLastPlayerMapModalProps.statusText).toBe('In game area.');
    });

    it('passes the exact same outside-status text to PlayerMapModal as the page itself renders, for the outside case', () => {
        // Regression test: a prior fix gave the page's own "outside" box
        // and the modal's statusText prop two independently-hardcoded
        // copies of this text, which drifted — the page said the player's
        // location is now visible to everyone, but the modal (fed from the
        // stale statusText.outside entry) still said the old "please
        // return inside," contradicting this file's own comment that the
        // words must be identical whether the player is on the page or has
        // the map open. Comparing the page's own rendered text against the
        // modal's prop (rather than each against a separately-duplicated
        // literal) is what actually catches a future re-drift.
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'status-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        status: 'outside',
                        reason: null,
                        lastUsableReceivedAt: { toMillis: () => Date.now() },
                        boundaryRevision: 1,
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        const pageOutsideText = screen.getByText(/visible to everyone/i).textContent;

        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

        expect(mockLastPlayerMapModalProps.statusText).toBe(pageOutsideText);
    });

    it('passes a fresh ownPosition through to PlayerMapModal, then null once it goes stale', () => {
        jest.useFakeTimers();
        try {
            writePlayerSession('Fluffy42317', 'Alice');
            const acquiredAtMs = Date.now();
            onSnapshot.mockImplementation((ref, callback) => {
                if (ref === 'room-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            gameStarted: false,
                            gameBoundary: { enabled: true, revision: 1, vertices: [] },
                        }),
                    });
                }
                return () => {};
            });
            useBoundaryLocation.mockReturnValue({
                permissionState: 'granted',
                lastResult: null,
                ownPosition: { lat: 10, lng: 20, accuracyM: 5, acquiredAtMs },
                requestPermission: jest.fn(),
            });

            renderWaiting();
            fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

            expect(mockLastPlayerMapModalProps.ownPosition).toEqual({
                lat: 10,
                lng: 20,
                accuracyM: 5,
                acquiredAtMs,
            });

            act(() => {
                jest.advanceTimersByTime(GAME_BOUNDARY_CONFIG.freshnessMs + 1000);
            });

            expect(mockLastPlayerMapModalProps.ownPosition).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    // --- Exposure feed and countdown warning (Task 7) -------------------

    it("shows another player's position on the map once their status reads outside, excluding the viewer's own id", () => {
        writePlayerSession('Fluffy42317', 'Alice');
        const lastUsableMs = Date.now();
        // gameStarted: true and a seeded roster (doc.id 'bob' is the
        // normalized key; the roster's real-cased 'Bob' is what
        // resolvePlayerDisplayName should resolve to) — needed so the
        // label assertion below can actually distinguish the resolved
        // display name from the raw normalized id.
        fetchPlayersQueryByDescendPointsThenIsAliveForRoom.mockReturnValue('players-query');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: true,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'players-query') {
                callback({
                    docs: [
                        {
                            data: () => ({
                                name: 'Bob',
                                score: 0,
                                targets: [],
                                openSeason: false,
                                isAlive: true,
                            }),
                        },
                    ],
                });
            } else if (ref === 'outside-statuses-query') {
                callback({
                    docs: [
                        {
                            id: 'bob',
                            data: () => ({
                                status: 'outside',
                                lat: 11,
                                lng: 21,
                                lastUsableReceivedAt: { toMillis: () => lastUsableMs },
                            }),
                        },
                        // Seeded present, defensively excluded even though the
                        // real query (status == 'outside') should never
                        // actually include the viewer's own doc here.
                        {
                            id: 'alice',
                            data: () => ({
                                status: 'outside',
                                lat: 99,
                                lng: 99,
                                lastUsableReceivedAt: { toMillis: () => lastUsableMs },
                            }),
                        },
                    ],
                });
            }
            return () => {};
        });

        renderWaiting();
        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

        expect(mockLastPlayerMapModalProps.otherPositions).toEqual([
            { id: 'bob', lat: 11, lng: 21, label: 'Bob', alwaysShowLabel: true },
        ]);
    });

    it('excludes a stale outside position from the map', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        const staleUsableMs = Date.now() - (GAME_BOUNDARY_CONFIG.freshnessMs + 60000);
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'outside-statuses-query') {
                callback({
                    docs: [
                        {
                            id: 'bob',
                            data: () => ({
                                status: 'outside',
                                lat: 11,
                                lng: 21,
                                lastUsableReceivedAt: { toMillis: () => staleUsableMs },
                            }),
                        },
                    ],
                });
            }
            return () => {};
        });

        renderWaiting();
        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

        expect(mockLastPlayerMapModalProps.otherPositions).toEqual([]);
    });

    it('shows a countdown warning while near-confirming outside, naming the seconds remaining', () => {
        const NOW = 1_700_000_000_000;
        jest.useFakeTimers().setSystemTime(NOW);
        try {
            writePlayerSession('Fluffy42317', 'Alice');
            onSnapshot.mockImplementation((ref, callback) => {
                if (ref === 'room-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            gameStarted: false,
                            gameBoundary: { enabled: true, revision: 1, vertices: [] },
                        }),
                    });
                } else if (ref === 'status-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            status: 'near',
                            reason: null,
                            lastUsableReceivedAt: { toMillis: () => NOW },
                            outsideSince: { toMillis: () => NOW - 5000 },
                            boundaryRevision: 1,
                        }),
                    });
                }
                return () => {};
            });

            renderWaiting();

            // GAME_BOUNDARY_CONFIG.confirmMinSpanMs is 20000; outsideSince was
            // 5000ms ago, so 15 remaining seconds is expected.
            expect(screen.getByText(/15/)).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('replaces the countdown with an exposure notice the instant status is confirmed outside', () => {
        const NOW = 1_700_000_000_000;
        jest.useFakeTimers().setSystemTime(NOW);
        try {
            writePlayerSession('Fluffy42317', 'Alice');
            let statusCallback;
            onSnapshot.mockImplementation((ref, callback) => {
                if (ref === 'room-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            gameStarted: false,
                            gameBoundary: { enabled: true, revision: 1, vertices: [] },
                        }),
                    });
                } else if (ref === 'status-ref') {
                    statusCallback = callback;
                    callback({
                        exists: () => true,
                        data: () => ({
                            status: 'near',
                            reason: null,
                            lastUsableReceivedAt: { toMillis: () => NOW },
                            outsideSince: { toMillis: () => NOW - 5000 },
                            boundaryRevision: 1,
                        }),
                    });
                }
                return () => {};
            });

            renderWaiting();
            expect(screen.getByText(/15/)).toBeInTheDocument();

            act(() => {
                statusCallback({
                    exists: () => true,
                    data: () => ({
                        status: 'outside',
                        reason: null,
                        lastUsableReceivedAt: { toMillis: () => NOW },
                        outsideSince: { toMillis: () => NOW - 5000 },
                        boundaryRevision: 1,
                    }),
                });
            });

            expect(screen.queryByText(/15/)).not.toBeInTheDocument();
            expect(screen.getByText(/visible to everyone/i)).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('closing the map modal does not stop the outside-players subscription from updating', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            }
            return () => {};
        });

        renderWaiting();

        const outsideQueryCallsBeforeToggle = onSnapshot.mock.calls.filter(
            (call) => call[0] === 'outside-statuses-query'
        );
        expect(outsideQueryCallsBeforeToggle.length).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
        const mockModal = screen.getByTestId('mock-player-map-modal');
        // Scoped to the mock modal itself — same ambiguity-avoidance reason
        // as the useBoundaryLocation toggle test above (the "Game area is
        // ready" toast's own Close button also matches /close/i).
        fireEvent.click(within(mockModal).getByRole('button', { name: /close/i }));

        const outsideQueryCallsAfterToggle = onSnapshot.mock.calls.filter(
            (call) => call[0] === 'outside-statuses-query'
        );
        // Established once, at PlayerGame's own mount — not tied to the
        // modal's own open/closed state.
        expect(outsideQueryCallsAfterToggle.length).toBe(1);
    });

    it('removes a player dot once it goes stale from time passing alone, with no new snapshot delivered', () => {
        // Finding 1: a disconnected player's status doc can sit at
        // 'outside' forever with no new snapshot ever arriving. The fix
        // stores the raw doc data and re-derives freshness at render time
        // against the existing nowMs ticker, so the dot must disappear on
        // its own once GAME_BOUNDARY_CONFIG.freshnessMs passes — without
        // the mocked onSnapshot callback ever firing again.
        jest.useFakeTimers();
        try {
            writePlayerSession('Fluffy42317', 'Alice');
            const lastUsableMs = Date.now();
            onSnapshot.mockImplementation((ref, callback) => {
                if (ref === 'room-ref') {
                    callback({
                        exists: () => true,
                        data: () => ({
                            gameStarted: false,
                            gameBoundary: { enabled: true, revision: 1, vertices: [] },
                        }),
                    });
                } else if (ref === 'outside-statuses-query') {
                    callback({
                        docs: [
                            {
                                id: 'bob',
                                data: () => ({
                                    status: 'outside',
                                    lat: 11,
                                    lng: 21,
                                    lastUsableReceivedAt: { toMillis: () => lastUsableMs },
                                }),
                            },
                        ],
                    });
                }
                return () => {};
            });

            renderWaiting();
            fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

            expect(mockLastPlayerMapModalProps.otherPositions).toEqual([
                { id: 'bob', lat: 11, lng: 21, label: 'bob', alwaysShowLabel: true },
            ]);

            act(() => {
                jest.advanceTimersByTime(GAME_BOUNDARY_CONFIG.freshnessMs + 1000);
            });

            expect(mockLastPlayerMapModalProps.otherPositions).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('excludes an outside position whose lat/lng are not finite numbers, even when otherwise fresh', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        const lastUsableMs = Date.now();
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'outside-statuses-query') {
                callback({
                    docs: [
                        {
                            id: 'bob',
                            data: () => ({
                                status: 'outside',
                                lat: null,
                                lng: undefined,
                                lastUsableReceivedAt: { toMillis: () => lastUsableMs },
                            }),
                        },
                    ],
                });
            }
            return () => {};
        });

        renderWaiting();
        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

        expect(mockLastPlayerMapModalProps.otherPositions).toEqual([]);
    });

    it("removes a player's dot once their status is no longer outside, on the very next snapshot", () => {
        writePlayerSession('Fluffy42317', 'Alice');
        const lastUsableMs = Date.now();
        let outsideStatusesCallback;
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({
                    exists: () => true,
                    data: () => ({
                        gameStarted: false,
                        gameBoundary: { enabled: true, revision: 1, vertices: [] },
                    }),
                });
            } else if (ref === 'outside-statuses-query') {
                outsideStatusesCallback = callback;
                callback({
                    docs: [
                        {
                            id: 'bob',
                            data: () => ({
                                status: 'outside',
                                lat: 11,
                                lng: 21,
                                lastUsableReceivedAt: { toMillis: () => lastUsableMs },
                            }),
                        },
                    ],
                });
            }
            return () => {};
        });

        renderWaiting();
        fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));

        expect(mockLastPlayerMapModalProps.otherPositions).toEqual([
            { id: 'bob', lat: 11, lng: 21, label: 'bob', alwaysShowLabel: true },
        ]);

        act(() => {
            // Exactly what Firestore delivers once a document stops matching
            // a live query's filter: a later snapshot whose docs array omits
            // it entirely, not a doc with a changed status.
            outsideStatusesCallback({ docs: [] });
        });

        expect(mockLastPlayerMapModalProps.otherPositions).toEqual([]);
    });
});
