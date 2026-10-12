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
import { render, screen, waitFor } from '@testing-library/react';
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
} from '../components/firebase_calls/dbCalls';
import { leaveGame } from '../components/leaveGame';
import { writePlayerSession, readPlayerSession } from '../utils/playerSession';

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
}));
jest.mock('../components/leaveGame', () => ({ leaveGame: jest.fn() }));
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
});
