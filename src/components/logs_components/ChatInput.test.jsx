/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * `executeKill` is a thin wrapper around a Cloud Function call now
 * (docs/improvements.md item 4) — validation, scoring, unmapping, and
 * remapping all happen server-side, inside `functions/callableFunctions/
 * killPlayer.js`, not in ChatInput.js. So these tests mock `executeKill`
 * itself rather than the individual Firestore calls it used to make; what's
 * left to verify here is ChatInput's own remaining job: normalize the typed
 * names, check them against the roster, call executeKill, and route its
 * response to the right handlers.
 *
 * The roster comes from `gameContext`'s `players` (GameMasterView's own
 * live subscription), not a `fetchAllPlayersForRoom` call — see
 * docs/superpowers/specs/2026-08-05-shell-style-command-completion-design.md.
 * `mountChatInput` takes an optional roster; defaults to Alice/Bob for
 * tests that don't care about the exact names.
 *
 * Tab-completion's actual matching logic (ambiguous prefixes, mission
 * sub-command shapes, dead-player-only filtering, etc.) is unit tested
 * directly in `src/game/commandCompletion.test.js`, which needs no
 * component, no mocks, and no DOM — the tests here only prove the wiring:
 * that the live roster and on-demand mission fetch actually reach it.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInput from './ChatInput';
import { executionContext, gameContext } from '../Contexts';
import * as dbCalls from '../firebase_calls/dbCalls';
import { executeKill } from '../executeKill';
import { completeMission } from '../completeMission';
import { undoMissionCommand } from '../undoMissionCommand';
import { removePlayer } from '../removePlayer';

// An explicit factory, not just `jest.mock('../firebase_calls/dbCalls')` —
// auto-mocking still loads the real module first to learn its shape, which
// pulls in utils/firebase.js's real initialization (getFunctions() touches
// `fetch`, undefined in jsdom).
jest.mock('../firebase_calls/dbCalls', () => ({
    addPlayerMessageForRoom: jest.fn(),
    fetchAliveRosterForRoom: jest.fn(),
    fetchPlayersByStatusForRoom: jest.fn(),
    fetchTaskByIndexForRoom: jest.fn(),
    fetchTasksByCompletionForRoom: jest.fn(),
    recordLastMissionCommandCompletion: jest.fn(),
    setOpenSznOfPlayerToValueForRoom: jest.fn(),
    updateIsAliveForPlayer: jest.fn(),
    updateIsCompleteToTrueForTaskByIndex: jest.fn(),
    updatePointsForPlayer: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));
jest.mock('../completeMission', () => ({ completeMission: jest.fn() }));
jest.mock('../undoMissionCommand', () => ({ undoMissionCommand: jest.fn() }));
jest.mock('../removePlayer', () => ({ removePlayer: jest.fn() }));
// An inspectable double, not a bare arrow function — some tests need to
// assert on exactly what ChatInput passes as playersNeedingTarget/
// playersNeedingAssassins (see the revival case-casing regression test
// below).
const mockRegenerate = jest.fn();
jest.mock('../RemapPlayers', () => jest.fn(() => mockRegenerate));

const executionHandlers = {
    handleKillPlayer: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
    handleRemapping: jest.fn(),
    handleTaskCompleted: jest.fn(),
    handleShowMissionCreation: jest.fn(),
    handleShowMissionList: jest.fn(),
    handleShowLeaderboardView: jest.fn(),
    handleOpenSznstarted: jest.fn(),
    handleOpenSznended: jest.fn(),
    handlePlayerRevive: jest.fn(),
    addLog: jest.fn(),
};

const defaultPlayers = [
    { name: 'Alice', isAlive: true },
    { name: 'Bob', isAlive: true },
];

const mountChatInput = (players = defaultPlayers, isGameActive = true) => {
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a', players, isGameActive }}>
                <executionContext.Provider value={executionHandlers}>
                    <ChatInput />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );
    return screen.getByRole('textbox');
};

const typeAndSubmit = (input, text) => userEvent.type(input, `${text}{enter}`);

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.updatePointsForPlayer.mockResolvedValue(undefined);
    dbCalls.fetchTasksByCompletionForRoom.mockResolvedValue({ docs: [] });
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
    completeMission.mockResolvedValue({
        reversalSnapshot: { missionIndex: 1, playerName: 'bob', wasAutoEnded: false, players: {} },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
        taskTitle: 'Find the clue',
        maxCompletions: null,
        revivesPlayer: false,
    });
    dbCalls.recordLastMissionCommandCompletion.mockResolvedValue(undefined);
    undoMissionCommand.mockResolvedValue(undefined);
    mockRegenerate.mockResolvedValue([{}, {}]);
    removePlayer.mockResolvedValue({
        removedPlayerName: 'Bob',
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});

describe('/kill (improvements item 4: executeKill is now a Cloud Function call)', () => {
    it('normalizes both names and routes the response to the right handlers', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill alice bob');

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
        // executeKill itself still gets the normalized (lowercased) form —
        // that's the matching key Firestore/the Cloud Function need. The
        // handler that turns this into chat log text gets the player's
        // actual stored casing instead (improvements: player names should
        // reflect their real casing in chat, not the lowercased match key).
        expect(executionHandlers.handleKillPlayer).toHaveBeenCalledWith('Alice', 'Bob', false);
    });

    it('rejects a kill for a name not on the roster without calling executeKill', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill nobody bob');

        expect(await screen.findByText(/invalid players/i)).toBeInTheDocument();
        expect(executeKill).not.toHaveBeenCalled();
    });

    it('passes remapLogs, addedTargets, and addedAssassins from the response through to their handlers', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill alice bob');

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
        expect(executionHandlers.handleSetShowMessageToTrue).toHaveBeenCalled();
    });
});

describe('/kill with a multi-word bracketed player name (improvements item 35)', () => {
    it('normalizes a name with an internal space before calling executeKill', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice Smith', isAlive: true },
            { name: 'Bob', isAlive: true },
        ]);
        // user-event v13's type() treats a bare `[` as special syntax —
        // `[[` escapes to a literal `[`. `]` needs no escaping. This types
        // the literal string "/kill [Alice Smith] bob".
        typeAndSubmit(commandInput, '/kill [[Alice Smith] bob');

        await waitFor(() =>
            expect(executeKill).toHaveBeenCalledWith('alicesmith', 'bob', 'room-a')
        );
    });
});

describe('open-season flag passed to handleKillPlayer (improvements item 8)', () => {
    it("uses executeKill's targetWasOpenSzn, not any locally-derived flag", async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: true,
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill alice bob');

        await waitFor(() => expect(executionHandlers.handleKillPlayer).toHaveBeenCalled());
        expect(executionHandlers.handleKillPlayer).toHaveBeenCalledWith('Alice', 'Bob', true);
    });
});

describe('/add with a capitalized player name (improvements item 1)', () => {
    it('accepts the player despite parseCommand not lowercasing args', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/add Alice 5');

        await waitFor(() => expect(dbCalls.updatePointsForPlayer).toHaveBeenCalled());
        expect(dbCalls.updatePointsForPlayer).toHaveBeenCalledWith('alice', 5, 'room-a');
    });
});

describe('a rejected executeKill surfaces as a toast (improvements item 5)', () => {
    it('shows the Cloud Function error instead of killing anyway', async () => {
        executeKill.mockRejectedValue(new Error('bob is not a valid target for alice'));

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill bob alice');

        expect(await screen.findByText(/bob is not a valid target for alice/i)).toBeInTheDocument();
        expect(executionHandlers.handleKillPlayer).not.toHaveBeenCalled();
    });
});

describe('/mission end does not toast success before the write succeeds (improvements item 20)', () => {
    it('shows an error and does not toast success when the task index is invalid', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue(undefined);

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission end 5');

        expect(await screen.findByText(/invalid task index/i)).toBeInTheDocument();
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).not.toHaveBeenCalled();
        expect(executionHandlers.handleTaskCompleted).not.toHaveBeenCalled();
        expect(screen.queryByText(/task has been saved as completed/i)).not.toBeInTheDocument();
    });

    it('toasts success and calls handleTaskCompleted once the write succeeds', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ title: 'Find the clue' });
        dbCalls.updateIsCompleteToTrueForTaskByIndex.mockResolvedValue(undefined);

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission end 2');

        await waitFor(() =>
            expect(executionHandlers.handleTaskCompleted).toHaveBeenCalledWith('Find the clue')
        );
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).toHaveBeenCalledWith(2, 'room-a');
        expect(await screen.findByText(/task has been saved as completed/i)).toBeInTheDocument();
    });
});

describe('/mission start and /mission view open the mission modals (improvements item 15)', () => {
    it('/mission start calls handleShowMissionCreation', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission start');

        await waitFor(() => expect(executionHandlers.handleShowMissionCreation).toHaveBeenCalled());
    });

    it('/mission view calls handleShowMissionList', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission view');

        await waitFor(() => expect(executionHandlers.handleShowMissionList).toHaveBeenCalled());
    });
});

describe('/mission done (bug report: ended missions, missing chat log, completion cap)', () => {
    it('calls completeMission with the missionIndex, the normalized player name, and roomID', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() => expect(completeMission).toHaveBeenCalledWith(1, 'bob', 'room-a'));
    });

    it('rejects completing a mission that has been deleted, surfacing the Cloud Function error', async () => {
        // Validity of the mission index (deleted mission, already ended,
        // etc.) is entirely server-side now — planMissionCompletion runs
        // inside the completeMission Cloud Function
        // (functions/callableFunctions/completeMission.js), not here.
        completeMission.mockRejectedValue(new Error('Invalid task index'));

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        expect(await screen.findByText(/invalid task index/i)).toBeInTheDocument();
        expect(dbCalls.recordLastMissionCommandCompletion).not.toHaveBeenCalled();
    });

    it('rejects completing a mission that has already ended, without recording anything', async () => {
        completeMission.mockRejectedValue(new Error('Mission 1 has already ended'));

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        expect(await screen.findByText(/mission 1 has already ended/i)).toBeInTheDocument();
        expect(dbCalls.recordLastMissionCommandCompletion).not.toHaveBeenCalled();
    });

    it('records the reversalSnapshot completeMission returns, via recordLastMissionCommandCompletion', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: true,
                players: {
                    bob: {
                        score: 10,
                        targets: [],
                        assassins: [],
                        isAlive: true,
                        openSeason: false,
                    },
                },
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(dbCalls.recordLastMissionCommandCompletion).toHaveBeenCalledWith('room-a', {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: true,
                players: {
                    bob: {
                        score: 10,
                        targets: [],
                        assassins: [],
                        isAlive: true,
                        openSeason: false,
                    },
                },
            })
        );
    });

    it('passes remapLogs, addedTargets, and addedAssassins from a revival completion through to their handlers', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
            taskTitle: 'Revival Mission',
            maxCompletions: null,
            revivesPlayer: true,
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
        expect(executionHandlers.handleSetShowMessageToTrue).toHaveBeenCalled();
    });

    it('announces the completion in the GM log and player chat', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: null,
            revivesPlayer: false,
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'Bob completed mission: Find the clue',
                'green.400'
            )
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Bob completed mission: Find the clue',
                standings: null,
            },
            'room-a'
        );
    });

    it('additionally announces an auto-end when the completion reaches maxCompletions', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: true,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: 1,
            revivesPlayer: false,
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'Mission "Find the clue" auto-ended — reached its 1-completion cap',
                'purple.400'
            )
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Mission Find the clue has been completed!',
                standings: null,
            },
            'room-a'
        );
    });

    it('calls handlePlayerRevive when the completion revives the player', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 2,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Revival Mission',
            maxCompletions: null,
            revivesPlayer: true,
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 2');

        await waitFor(() =>
            expect(executionHandlers.handlePlayerRevive).toHaveBeenCalledWith(
                'Bob',
                expect.any(Function)
            )
        );
    });

    it('does not fire any remap handlers for a plain Task completion', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: null,
            revivesPlayer: false,
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() => expect(completeMission).toHaveBeenCalled());
        expect(executionHandlers.handleAddNewAssassins).not.toHaveBeenCalled();
        expect(executionHandlers.handleAddNewTargets).not.toHaveBeenCalled();
        expect(executionHandlers.handleSetShowMessageToTrue).not.toHaveBeenCalled();
        expect(executionHandlers.handlePlayerRevive).not.toHaveBeenCalled();
    });
});

describe('/mission undo', () => {
    it('calls undoMissionCommand with just roomID', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission undo');

        await waitFor(() => expect(undoMissionCommand).toHaveBeenCalledWith('room-a'));
    });

    it('logs and broadcasts the undo announcement on success', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission undo');

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'Undo: the last mission completion was reverted',
                'blue.200'
            )
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Undo: the last mission completion was reverted',
                standings: null,
            },
            'room-a'
        );
    });

    it('surfaces a thrown error through the outer-catch wording', async () => {
        // The outer catch's wording is built from `commandLine`, which is
        // just the top-level command word ("/mission") — parseCommand
        // never folds the "undo" sub-argument into it (src/game/commands.js).
        undoMissionCommand.mockRejectedValueOnce(new Error('Nothing to undo.'));
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission undo');

        expect(await screen.findByText(/\/mission failed: nothing to undo/i)).toBeInTheDocument();
    });
});

describe('/kick', () => {
    it('normalizes the name and routes the response to the remap handlers', async () => {
        removePlayer.mockResolvedValue({
            removedPlayerName: 'Bob',
            addedTargets: { alice: ['carol'] },
            addedAssassins: { carol: ['alice'] },
            remapLogs: ['New target for alice: carol'],
        });
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kick bob');

        await waitFor(() => expect(removePlayer).toHaveBeenCalledWith('bob', 'room-a'));
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Bob was removed from the game',
            'gray.400'
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Bob was removed from the game',
                standings: null,
            },
            'room-a'
        );
        // Waited on directly (rather than asserted synchronously right after
        // the removePlayer waitFor above, as the task-4 brief's draft had
        // it) — the /kick case chains three more awaited mock calls
        // (addLog, addPlayerMessageForRoom, then handleRemapping) after
        // removePlayer resolves, and in practice that's enough
        // microtask/macrotask interleaving with RTL's own waitFor polling
        // that handleRemapping hadn't always run yet by this point,
        // producing a real (not flaky-random, but deterministic-in-this-
        // environment) race. Mirrors how the /mission done tests above
        // wait on handleRemapping itself rather than assuming it's settled.
        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for alice: carol'
            )
        );
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['alice'],
        });
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ alice: ['carol'] });
        expect(executionHandlers.handleSetShowMessageToTrue).toHaveBeenCalled();
    });

    it('rejects a name not on the roster without calling removePlayer', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kick nobody');

        expect(await screen.findByText(/Player nobody is invalid/)).toBeInTheDocument();
        expect(removePlayer).not.toHaveBeenCalled();
    });

    it('normalizes a name with an internal space before calling removePlayer', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice Smith', isAlive: true },
            { name: 'Bob', isAlive: true },
        ]);
        // user-event v13's type() treats a bare `[` as special syntax —
        // `[[` escapes to a literal `[` (see the equivalent /kill test
        // above). This types the literal string "/kick [Alice Smith]".
        typeAndSubmit(commandInput, '/kick [[Alice Smith]');

        await waitFor(() => expect(removePlayer).toHaveBeenCalledWith('alicesmith', 'room-a'));
    });
});

describe('a rejected removePlayer surfaces as a toast', () => {
    it('shows the error and never logs or broadcasts', async () => {
        removePlayer.mockRejectedValue(new Error('Player not found: bob'));
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kick bob');

        expect(await screen.findByText(/\/kick failed: Player not found: bob/)).toBeInTheDocument();
        expect(executionHandlers.addLog).not.toHaveBeenCalled();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});

describe('Tab completion (shell-style, per-argument — docs/superpowers/specs/2026-08-05-shell-style-command-completion-design.md)', () => {
    it('completes a unique command word and appends a trailing space, ready to keep typing', async () => {
        // Regression test for the specific bug this redesign fixes: a
        // trailing `.trim()` used to strip the space Tab had just added,
        // so a GM couldn't keep typing straight into the next argument.
        const commandInput = mountChatInput();

        await userEvent.type(commandInput, '/mi');
        await userEvent.tab();

        await waitFor(() => expect(commandInput).toHaveValue('/mission '));
    });

    it('completes a unique player name from the live roster (not a Firestore fetch)', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice Smith', isAlive: true },
            { name: 'Bob', isAlive: true },
        ]);

        await userEvent.type(commandInput, '/kill Alice');
        await userEvent.tab();

        // Wrapped in brackets — the completed name has an internal space.
        await waitFor(() => expect(commandInput).toHaveValue('/kill [Alice Smith] '));
    });

    it('narrows an ambiguous match to the common prefix, without a trailing space', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice', isAlive: true },
            { name: 'Alicia', isAlive: true },
        ]);

        await userEvent.type(commandInput, '/kill Ali');
        await userEvent.tab();

        // "Alice" and "Alicia" only agree up through "Alic" — Tab advances
        // that far and stops, with no trailing space since it's still
        // ambiguous.
        await waitFor(() => expect(commandInput).toHaveValue('/kill Alic'));
    });

    it('completes the /mission sub-command to the bare word, not the full argument skeleton', async () => {
        const commandInput = mountChatInput();

        await userEvent.type(commandInput, '/mission d');
        await userEvent.tab();

        await waitFor(() => expect(commandInput).toHaveValue('/mission done '));
    });

    it('refreshes the dropdown for the next slot right after Tab, without needing a literal space typed first (bug report: "have to press space again")', async () => {
        // Tab completing "/mission" to "/mission " used to leave the
        // dropdown showing stale suggestions for the slot that was just
        // filled (or empty), rebuilt from the value/completion captured
        // *before* Tab's setValue took effect. The next slot's
        // suggestions only appeared once the GM typed a literal space
        // themselves, re-triggering onSuggestionsFetchRequested.
        const commandInput = mountChatInput();

        await userEvent.type(commandInput, '/mission');
        await userEvent.tab();

        await waitFor(() => expect(commandInput).toHaveValue('/mission '));
        expect(
            await screen.findByText('/mission done [player_name] [mission_index]')
        ).toBeInTheDocument();
        expect(screen.getByText('/mission end [mission_index]')).toBeInTheDocument();
        expect(screen.getByText('/mission start')).toBeInTheDocument();
        expect(screen.getByText('/mission view')).toBeInTheDocument();
    });

    it('shows the whole command in context in the dropdown, not just the bare candidate (feedback: "super hard to know how to write commands")', async () => {
        const commandInput = mountChatInput([{ name: 'Alice Smith', isAlive: true }]);

        await userEvent.type(commandInput, '/mission d');
        // The dropdown shows "/mission done [player_name] [mission_index]",
        // not just "done" — Tab still only fills the bare word (see above).
        expect(
            await screen.findByText('/mission done [player_name] [mission_index]')
        ).toBeInTheDocument();

        await userEvent.clear(commandInput);
        await userEvent.type(commandInput, '/kill Al');
        expect(await screen.findByText('/kill [Alice Smith] [assassin_name]')).toBeInTheDocument();
    });

    it('fetches active missions on demand and completes a mission index', async () => {
        dbCalls.fetchTasksByCompletionForRoom.mockResolvedValue({
            docs: [{ data: () => ({ taskIndex: 1, isComplete: false }) }],
        });
        const commandInput = mountChatInput();

        await userEvent.type(commandInput, '/mission end ');
        await userEvent.tab();

        await waitFor(() => expect(commandInput).toHaveValue('/mission end 1 '));
        expect(dbCalls.fetchTasksByCompletionForRoom).toHaveBeenCalledWith(false, 'room-a');
    });

    it('Enter accepts a highlighted suggestion instead of submitting a stale value (bug report: /mission start "does nothing")', async () => {
        // react-autosuggest has its own built-in Enter handling: when a
        // suggestion is highlighted (arrow keys, or a mouse resting over
        // the dropdown — very easy to trigger while using the feature this
        // is built for), it intercepts Enter to accept that suggestion,
        // then *still* calls our onKeyDown afterward. Without a guard, that
        // second call read the pre-acceptance value and submitted it —
        // e.g. the still-ambiguous "/mission s" instead of the
        // just-accepted "/mission start ".
        const commandInput = mountChatInput();

        await userEvent.type(commandInput, '/mission s');
        expect(await screen.findByText('/mission start')).toBeInTheDocument();
        await userEvent.type(commandInput, '{arrowdown}');
        await userEvent.type(commandInput, '{enter}');

        // First Enter only accepts the highlighted suggestion.
        await waitFor(() => expect(commandInput).toHaveValue('/mission start '));
        expect(executionHandlers.handleShowMissionCreation).not.toHaveBeenCalled();

        // A second, unambiguous Enter actually submits it.
        await userEvent.type(commandInput, '{enter}');
        await waitFor(() => expect(executionHandlers.handleShowMissionCreation).toHaveBeenCalled());
    });
});

describe("chat log messages show a player's actual stored casing, not the lowercased matching key", () => {
    it('/openseason start passes the actual casing to handleOpenSznstarted', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/openseason alice start');

        await waitFor(() =>
            expect(dbCalls.setOpenSznOfPlayerToValueForRoom).toHaveBeenCalledWith(
                'alice',
                true,
                'room-a'
            )
        );
        expect(executionHandlers.handleOpenSznstarted).toHaveBeenCalledWith('Alice');
    });

    it('/openseason end passes the actual casing to handleOpenSznended', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/openseason alice end');

        await waitFor(() =>
            expect(dbCalls.setOpenSznOfPlayerToValueForRoom).toHaveBeenCalledWith(
                'alice',
                false,
                'room-a'
            )
        );
        expect(executionHandlers.handleOpenSznended).toHaveBeenCalledWith('Alice');
    });

    it('/openseason start on an already-open season shows an error and does not write', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true, openSeason: true }]);
        typeAndSubmit(commandInput, '/openseason alice start');

        expect(
            await screen.findByText(/alice.?s open season is already started/i)
        ).toBeInTheDocument();
        expect(dbCalls.setOpenSznOfPlayerToValueForRoom).not.toHaveBeenCalled();
        expect(executionHandlers.handleOpenSznstarted).not.toHaveBeenCalled();
    });

    it('/openseason end on an already-closed season shows an error and does not write', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true, openSeason: false }]);
        typeAndSubmit(commandInput, '/openseason alice end');

        expect(
            await screen.findByText(/alice.?s open season is already ended/i)
        ).toBeInTheDocument();
        expect(dbCalls.setOpenSznOfPlayerToValueForRoom).not.toHaveBeenCalled();
        expect(executionHandlers.handleOpenSznended).not.toHaveBeenCalled();
    });

    it('a successful /revive passes the actual casing to handlePlayerRevive', async () => {
        dbCalls.fetchPlayersByStatusForRoom.mockResolvedValue(['Alice']);
        dbCalls.fetchAliveRosterForRoom.mockResolvedValue([
            { name: 'Alice', targets: [], assassins: [] },
        ]);
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: false }]);
        typeAndSubmit(commandInput, '/revive alice');

        await waitFor(() =>
            expect(dbCalls.updateIsAliveForPlayer).toHaveBeenCalledWith('alice', true, 'room-a')
        );
        expect(executionHandlers.handlePlayerRevive).toHaveBeenCalledWith(
            'Alice',
            expect.any(Function)
        );
    });

    it("/revive rebalances whoever else is also short of the room's cap, using their real stored casing", async () => {
        dbCalls.fetchPlayersByStatusForRoom.mockResolvedValue(['Alice']);
        dbCalls.fetchAliveRosterForRoom.mockResolvedValue([
            { name: 'Alice', targets: [], assassins: [] },
            { name: 'Bob', targets: ['Carol'], assassins: ['Carol'] },
            { name: 'Carol', targets: ['Bob'], assassins: ['Bob'] },
        ]);
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: false }]);
        typeAndSubmit(commandInput, '/revive alice');

        // 3 alive -> maxTargetsFor gives 1. Bob and Carol already have
        // theirs (mutually), so only Alice is actually short.
        await waitFor(() =>
            expect(mockRegenerate).toHaveBeenCalledWith(
                ['Alice'],
                ['Alice'],
                ['Alice', 'Bob', 'Carol'],
                'room-a'
            )
        );
    });
});

describe('/whisper (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)', () => {
    it('writes a playerMessages doc and logs a confirmation', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/whisper alice watch your back');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'whisper',
                    recipient: 'Alice',
                    text: 'watch your back',
                    standings: null,
                },
                'room-a'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Whisper sent to Alice: "watch your back"',
            'teal.400'
        );
    });

    it('rejects a whisper to a player not on the roster', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/whisper nobody hi');

        expect(await screen.findByText(/player nobody is invalid/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });

    it('rejects a whisper with a blank message', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/whisper alice');

        expect(await screen.findByText(/whisper message cannot be blank/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});

describe('/broadcast (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)', () => {
    it('writes a playerMessages doc and logs a confirmation', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/broadcast the game has started');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: 'the game has started',
                    standings: null,
                },
                'room-a'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Broadcast sent: "the game has started"',
            'teal.400'
        );
    });

    it('rejects a blank broadcast', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/broadcast');

        expect(await screen.findByText(/broadcast message cannot be blank/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});

describe('/leaderboard (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)', () => {
    it('writes the current standings and logs a confirmation', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice', isAlive: true, score: 10 },
            { name: 'Bob', isAlive: false, score: 20 },
        ]);
        typeAndSubmit(commandInput, '/leaderboard send');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'leaderboard',
                    recipient: null,
                    text: null,
                    standings: [
                        { name: 'Bob', score: 20, isAlive: false },
                        { name: 'Alice', score: 10, isAlive: true },
                    ],
                },
                'room-a'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Leaderboard sent to all players',
            'teal.400'
        );
    });

    it('sends only the top 3 standings, not the full roster', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice', isAlive: true, score: 10 },
            { name: 'Bob', isAlive: true, score: 40 },
            { name: 'Carol', isAlive: true, score: 30 },
            { name: 'Dave', isAlive: false, score: 20 },
        ]);
        typeAndSubmit(commandInput, '/leaderboard send');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'leaderboard',
                    recipient: null,
                    text: null,
                    standings: [
                        { name: 'Bob', score: 40, isAlive: true },
                        { name: 'Carol', score: 30, isAlive: true },
                        { name: 'Dave', score: 20, isAlive: false },
                    ],
                },
                'room-a'
            )
        );
    });

    it('rejects an invalid argument', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/leaderboard nonsense');

        expect(await screen.findByText(/nonsense is not a valid input/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });

    it('/leaderboard view calls handleShowLeaderboardView', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/leaderboard view');

        await waitFor(() => expect(executionHandlers.handleShowLeaderboardView).toHaveBeenCalled());
    });
});

describe('silent no-ops now give feedback (improvements item 21)', () => {
    it('/revive on a player who is not dead shows an error instead of doing nothing', async () => {
        dbCalls.fetchPlayersByStatusForRoom.mockResolvedValue([]); // nobody dead

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/revive alice');

        expect(await screen.findByText(/alice is not dead/i)).toBeInTheDocument();
        expect(dbCalls.updateIsAliveForPlayer).not.toHaveBeenCalled();
    });
});

describe('a thrown dbCalls error surfaces to the GM (improvements item 10)', () => {
    it('shows a toast instead of failing silently', async () => {
        // Before item 10, dbCalls functions swallowed errors and returned
        // undefined, so a failure here would previously do nothing visible.
        dbCalls.updatePointsForPlayer.mockRejectedValue(new Error('network down'));

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/add Alice 5');

        expect(await screen.findByText(/\/add failed: network down/i)).toBeInTheDocument();
    });
});

describe('a room whose game has ended stops accepting commands (docs/improvements.md item 15 — isGameActive was written but never read)', () => {
    it('disables the input and swaps the placeholder once isGameActive is false', () => {
        const commandInput = mountChatInput(defaultPlayers, false);

        expect(commandInput).toBeDisabled();
        expect(commandInput).toHaveAttribute('placeholder', 'This game has ended');
    });

    it('does not disable the input while the game is still active', () => {
        const commandInput = mountChatInput(defaultPlayers, true);

        expect(commandInput).not.toBeDisabled();
        expect(commandInput).toHaveAttribute('placeholder', 'Input Texts/Commands Here ');
    });

    it('ignores a click on the send icon once the game has ended', async () => {
        // The text input's own `disabled` attribute doesn't cover this
        // separate clickable icon — submitCommand itself has to check too.
        const commandInput = mountChatInput(defaultPlayers, false);
        fireEvent.change(commandInput, { target: { value: '/add Alice 5' } });

        await userEvent.click(screen.getByAltText('Send'));

        expect(dbCalls.updatePointsForPlayer).not.toHaveBeenCalled();
    });
});
