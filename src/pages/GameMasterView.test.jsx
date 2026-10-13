/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 13: GameMasterView's player roster is now
 * a live subscription, not fetched once and mutated by hand — this is what
 * the standing CLAUDE.md note ("don't write component tests asserting
 * game-state outcomes until [item 13 is] fixed") was blocking on.
 *
 * ChatInput, PhotosDisplay, ReconnectRequests, GMChatPanel,
 * ResetTargetsButton, TaskCreationModal, and TaskListModal are all stubbed
 * out (each already has its own thorough test file) so this stays focused
 * on GameMasterView's own logic: deriving the header count and the
 * alive-only roster it hands down. ResetTargetsButton's stub still renders
 * enough to assert on — its own dialog UI is its concern, not
 * GameMasterView's; what GameMasterView is responsible for is computing
 * the right `arrayOfPlayers` prop to give it.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import GameMasterView from './GameMasterView';
import { addLogForRoom, addPlayerMessageForRoom } from '../components/firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

// Needed transitively: HeaderExecution now renders LogoutButton, which
// imports 'firebase/auth' and '../../utils/firebase' directly (not through
// dbCalls.js) — explicit factories, not auto-mock, same reason as every
// other mock in this file (auto-mocking still loads the real
// utils/firebase.js, which does real Firebase init at import time and
// touches `fetch`, undefined in jsdom).
jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

// HeaderExecution now renders GameBoundaryButton, which pulls in
// BoundaryEditorModal, which imports publishGameBoundary/disableGameBoundary,
// which import 'firebase/functions' directly — that touches `fetch`
// (undefined in jsdom) at module-load time, same reason firebase/auth and
// utils/firebase are stubbed above. The modal has its own thorough tests;
// stubbing it here keeps this file's concern to GameMasterView's own logic,
// same reasoning as every other stub in this file.
jest.mock('../components/map_components/BoundaryEditorModal', () => () => null);

// HeaderExecution now also renders LivePlayerMapButton, which imports the
// real GameMap, which imports 'react-map-gl' -> 'mapbox-gl' at module load
// time — mapbox-gl's loader touches TextDecoder, undefined in jsdom, same
// class of problem as the mocks above. LivePlayerMapButton has its own
// thorough test file (LivePlayerMapButton.test.jsx), where GameMap itself
// is stubbed instead; stubbing the whole button here keeps this file's
// concern to GameMasterView's own logic, same reasoning as every other
// stub in this file.
jest.mock('../components/map_components/LivePlayerMapButton', () => () => null);

// HeaderExecution renders Endgamebutton, which now imports endGame from its
// own module (src/components/endGame.js) rather than dbCalls.js — that
// module calls httpsCallable from 'firebase/functions' at import time, which
// touches `fetch` (undefined in jsdom), same class of problem as the
// BoundaryEditorModal/LivePlayerMapButton mocks above.
jest.mock('../components/endGame', () => ({ endGame: jest.fn() }));

// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom: jest.fn(() => 'players-query'),
    fetchLogsQueryByAscendingTimestampForRoom: jest.fn(() => 'logs-query'),
    fetchRoomReferenceForRoom: jest.fn(() => 'room-ref'),
    addLogForRoom: jest.fn(),
    addPlayerMessageForRoom: jest.fn(),
    updateIsAliveForPlayer: jest.fn(),
}));

// Reads gameContext itself, unlike the other stubs — needed to verify
// isGameActive actually reaches ChatInput via context (see the "isGameActive"
// describe block below), since that's the entire point of the wiring this
// file is testing, not just that GameMasterView renders without crashing.
let capturedExecutionContext;
jest.mock('../components/logs_components/ChatInput', () => {
    const { useContext } = require('react');
    const { gameContext, executionContext } = require('../components/Contexts');
    return () => {
        const { isGameActive } = useContext(gameContext);
        capturedExecutionContext = useContext(executionContext);
        return <div>chat-input-stub isGameActive={String(isGameActive)}</div>;
    };
});
jest.mock('../components/photos_display_component/PhotosDisplay', () => () => (
    <div>photos-display-stub</div>
));
jest.mock('../components/ReconnectRequests', () => () => <div>reconnect-requests-stub</div>);
jest.mock('../components/player_messages_components/GMChatPanel', () => (props) => (
    <div>gm-chat-panel-stub roomID={props.roomID}</div>
));
jest.mock('../components/header_components/ResetTargetsButton', () => ({ arrayOfPlayers }) => (
    <div data-testid="reset-targets-stub">{JSON.stringify(arrayOfPlayers)}</div>
));
// TaskCreationModal/TaskListModal (item 15's mission modals) have their
// own test coverage (TaskCreationModal.test.jsx, TaskListModal.test.jsx) —
// stubbed here for the same reason ChatInput/PhotosDisplay/ResetTargetsButton
// are: this file stays focused on GameMasterView's own logic.
jest.mock('../components/task_components/TaskCreationModal', () => () => (
    <div>task-creation-modal-stub</div>
));
jest.mock('../components/task_components/TaskListModal', () => () => (
    <div>task-list-modal-stub</div>
));

const asPlayerDocs = (players) => players.map((player) => ({ data: () => player }));

const mountGameMasterView = () => {
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/GameMasterView']}>
                <Routes>
                    <Route path="/rooms/:roomID/GameMasterView" element={<GameMasterView />} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );
};

/** Simulates onSnapshot reporting the given players immediately, an empty
 * logs snapshot, and an active game, regardless of mount order. */
const mockPlayersSnapshot = (players) => {
    onSnapshot.mockImplementation((query, onNext) => {
        if (query === 'room-ref') {
            onNext({ data: () => ({ isGameActive: true }) });
        } else {
            onNext({ docs: query === 'players-query' ? asPlayerDocs(players) : [] });
        }
        return () => {};
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    capturedExecutionContext = undefined;
});

describe('the player roster is a live subscription, not stale state (improvements item 13)', () => {
    it('shows the header count from the subscribed snapshot, not a frozen count', async () => {
        mockPlayersSnapshot([
            { name: 'Alice', score: 10, targets: [], openSeason: false, isAlive: true },
            { name: 'Bob', score: 5, targets: [], openSeason: false, isAlive: false },
        ]);

        mountGameMasterView();

        // Before this fix, the header read from router state frozen at
        // navigation time — a reload (no router state) always showed
        // "Players (0)" regardless of the real roster.
        expect(await screen.findByText('Players (2)')).toBeInTheDocument();
    });

    it('updates the header count when the subscription reports a change', async () => {
        let onNext;
        onSnapshot.mockImplementation((query, callback) => {
            if (query === 'players-query') onNext = callback;
            if (query === 'room-ref') {
                callback({ data: () => ({ isGameActive: true }) });
                return () => {};
            }
            callback({
                docs:
                    query === 'players-query'
                        ? asPlayerDocs([
                              {
                                  name: 'Alice',
                                  score: 0,
                                  targets: [],
                                  openSeason: false,
                                  isAlive: true,
                              },
                          ])
                        : [],
            });
            return () => {};
        });

        mountGameMasterView();
        expect(await screen.findByText('Players (1)')).toBeInTheDocument();

        // Simulates a second GM adding a player in another tab — the point
        // of a live subscription is this needs no reload to show up.
        act(() => {
            onNext({
                docs: asPlayerDocs([
                    { name: 'Alice', score: 0, targets: [], openSeason: false, isAlive: true },
                    { name: 'Carol', score: 0, targets: [], openSeason: false, isAlive: true },
                ]),
            });
        });

        expect(await screen.findByText('Players (2)')).toBeInTheDocument();
    });

    it('passes only alive players to the reset-targets roster, not the full player list', async () => {
        mockPlayersSnapshot([
            { name: 'Alice', score: 10, targets: [], openSeason: false, isAlive: true },
            { name: 'Bob', score: 5, targets: [], openSeason: false, isAlive: false },
        ]);

        mountGameMasterView();

        expect(await screen.findByTestId('reset-targets-stub')).toHaveTextContent(
            JSON.stringify(['Alice'])
        );
    });
});

describe("isGameActive is read, not just written (docs/improvements.md item 15's relatedly note)", () => {
    it('defaults to active before the room subscription has reported anything', async () => {
        onSnapshot.mockImplementation(() => () => {});

        mountGameMasterView();

        expect(await screen.findByText(/isGameActive=true/)).toBeInTheDocument();
    });

    it('passes isGameActive=false down through gameContext once endGame has fired', async () => {
        onSnapshot.mockImplementation((query, onNext) => {
            if (query === 'room-ref') {
                onNext({ data: () => ({ isGameActive: false }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountGameMasterView();

        expect(await screen.findByText(/isGameActive=false/)).toBeInTheDocument();
    });
});

describe('the Game Boundary entry point', () => {
    it("shows the Game Boundary entry point with the room's current boundary", () => {
        onSnapshot.mockImplementation((query, onNext) => {
            if (query === 'room-ref') {
                onNext({
                    data: () => ({
                        isGameActive: true,
                        gameBoundary: { enabled: true, revision: 1 },
                    }),
                });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountGameMasterView();

        expect(screen.getByRole('button', { name: 'Edit Game Area' })).toBeInTheDocument();
    });

    it('shows Set Game Area when the room has no boundary yet', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            if (query === 'room-ref') {
                onNext({ data: () => ({ isGameActive: true }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountGameMasterView();

        expect(screen.getByRole('button', { name: 'Set Game Area' })).toBeInTheDocument();
    });
});

describe('the GM chat panel', () => {
    it('mounts with the current room ID', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        expect(await screen.findByText('gm-chat-panel-stub roomID=room-a')).toBeInTheDocument();
    });
});

describe('game events are broadcast to players, not just logged to the GM console', () => {
    it('broadcasts a kill to players with the same text as the GM log', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleKillPlayer('Alice', 'Bob', false);
        });

        expect(addLogForRoom).toHaveBeenCalledWith('Alice was killed by Bob', 'red.400', 'room-a');
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Alice was killed by Bob',
                standings: null,
            },
            'room-a'
        );
    });

    it('broadcasts both the open-season-ended and the kill when a kill happens during open season', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleKillPlayer('Alice', 'Bob', true);
        });

        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'open season has ended for Alice',
                standings: null,
            },
            'room-a'
        );
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Alice was killed by Bob',
                standings: null,
            },
            'room-a'
        );
        expect(addPlayerMessageForRoom).toHaveBeenCalledTimes(2);
    });

    it('broadcasts open season starting', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleOpenSznstarted('Alice');
        });

        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Alice has open season on them',
                standings: null,
            },
            'room-a'
        );
    });

    it('broadcasts open season ending', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleOpenSznended('Alice');
        });

        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'open season has ended for Alice',
                standings: null,
            },
            'room-a'
        );
    });

    it('broadcasts a revive', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handlePlayerRevive('Alice');
        });

        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            { type: 'broadcast', recipient: null, text: 'Alice was revived', standings: null },
            'room-a'
        );
    });

    it('broadcasts a new mission being added as a structured mission message', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleNewTaskAdded({
                title: 'Find the clue',
                description: 'Look under the food court table',
                taskType: 'Task',
                pointValue: '10',
                maxCompletions: null,
            });
        });

        expect(addLogForRoom).toHaveBeenCalledWith(
            'Added new task: Find the clue',
            'yellow.400',
            'room-a'
        );
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'mission',
                recipient: null,
                text: null,
                standings: null,
                mission: {
                    title: 'Find the clue',
                    description: 'Look under the food court table',
                    taskType: 'Task',
                    pointValue: '10',
                    maxCompletions: null,
                },
            },
            'room-a'
        );
    });

    it('broadcasts a mission being manually ended', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleTaskCompleted('Find the clue');
        });

        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Completed task: Find the clue',
                standings: null,
            },
            'room-a'
        );
    });
});

describe('the logs panel auto-scrolls to the newest entry', () => {
    it('scrolls to the bottom whenever a new log arrives', async () => {
        let deliverLogs;
        onSnapshot.mockImplementation((query, onNext) => {
            if (query === 'room-ref') {
                onNext({ data: () => ({ isGameActive: true }) });
            } else if (query === 'players-query') {
                onNext({ docs: [] });
            } else {
                deliverLogs = onNext;
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountGameMasterView();

        const logsBox = await screen.findByTestId('logs-box');
        // jsdom never computes real layout, so scrollHeight is always 0 —
        // stub it to a value that would actually require scrolling, the
        // same way a real, overflowing logs panel would report it.
        Object.defineProperty(logsBox, 'scrollHeight', {
            value: 500,
            configurable: true,
        });
        logsBox.scrollTop = 0;

        await act(async () => {
            deliverLogs({
                docs: [
                    {
                        data: () => ({
                            time: '1:00:00 PM',
                            log: 'Game has begun!',
                            color: 'gray.400',
                        }),
                    },
                ],
            });
        });

        expect(logsBox.scrollTop).toBe(500);
    });
});
