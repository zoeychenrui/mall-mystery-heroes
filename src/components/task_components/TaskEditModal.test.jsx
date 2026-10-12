/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskEditModal edits an existing mission and, when its pointValue
 * changes on a Task with existing completions, retroactively adjusts
 * those players' scores by the delta
 * (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
 * Explicit dbCalls mock factory, not auto-mock — see ChatInput.test.jsx
 * for why.
 */
import React from 'react';
import { Accordion, ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskEditModal from './TaskEditModal';
import TaskAccordion from './TaskAccordion';
import { gameContext, executionContext } from '../Contexts';
import {
    updateTaskForRoom,
    updatePointsForPlayer,
    addPlayerMessageForRoom,
} from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    updateTaskForRoom: jest.fn(),
    updatePointsForPlayer: jest.fn(),
    addPlayerMessageForRoom: jest.fn(),
    // TaskAccordion — the real parent, rendered unstubbed by the reopen
    // test below — imports this too.
    deleteTaskForRoom: jest.fn(),
}));

const onClose = jest.fn();
const addLog = jest.fn();

const baseTask = {
    taskIndex: 1,
    title: 'Find the clue',
    description: 'Look around',
    taskType: 'Task',
    pointValue: 10,
    maxCompletions: null,
    isComplete: false,
    completedBy: [],
};

const renderModal = (task = baseTask) => (
    <ChakraProvider>
        <TaskEditModal isOpen onClose={onClose} task={task} roomID="room-a" addLog={addLog} />
    </ChakraProvider>
);

const mountModal = (task = baseTask) => render(renderModal(task));

beforeEach(() => {
    jest.clearAllMocks();
    updateTaskForRoom.mockResolvedValue(undefined);
    updatePointsForPlayer.mockResolvedValue(undefined);
    addPlayerMessageForRoom.mockResolvedValue(undefined);
});

describe('TaskEditModal', () => {
    it('applies the same blank-description default as TaskCreation when the description is cleared', async () => {
        // TaskCreation.js's handleAddTask writes 'No description provided'
        // for a blank description; TaskEditModal previously wrote whatever
        // the field held verbatim, including '' (docs/improvements.md item
        // 64).
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Look around'));
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ description: 'No description provided' }),
            'room-a'
        );
    });

    it('submits updateTaskForRoom with the edited field values', async () => {
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the second clue');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ title: 'Find the second clue' }),
            'room-a'
        );
        expect(onClose).toHaveBeenCalled();
    });

    it('does not show a score-adjustment notice when pointValue is unchanged', async () => {
        mountModal({ ...baseTask, completedBy: ['alice', 'bob'] });

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.queryByText(/adjust/i)).not.toBeInTheDocument();
        expect(updatePointsForPlayer).not.toHaveBeenCalled();
    });

    it('shows a score-adjustment notice and applies it to every completing player when pointValue changes', async () => {
        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(
            await screen.findByText(/adjust 2 players. scores by \+5 each/i)
        ).toBeInTheDocument();
        // The write must not have happened yet — the notice is a distinct
        // confirmation step, not an automatic silent recompute.
        expect(updateTaskForRoom).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            // A string, matching how TaskCreation.js stores it — see the
            // pointValue test below.
            expect.objectContaining({ pointValue: '15' }),
            'room-a'
        );
        expect(updatePointsForPlayer).toHaveBeenCalledWith('alice', 5, 'room-a');
        expect(updatePointsForPlayer).toHaveBeenCalledWith('bob', 5, 'room-a');
        expect(onClose).toHaveBeenCalled();
    });

    it('disables the task type select once anyone has completed the mission', () => {
        mountModal({ ...baseTask, completedBy: ['alice'] });

        expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('does not disable the task type select when nobody has completed the mission yet', () => {
        mountModal({ ...baseTask, completedBy: [] });

        expect(screen.getByRole('combobox')).toBeEnabled();
    });

    it('shows an error and keeps the modal open when updateTaskForRoom rejects', async () => {
        updateTaskForRoom.mockRejectedValue(new Error('network down'));
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows an error and keeps the modal open when a mid-loop updatePointsForPlayer rejects', async () => {
        updatePointsForPlayer.mockRejectedValueOnce(new Error('player not found'));
        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText(/adjust 2 players. scores by \+5 each/i);
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText(/player not found/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('applies the score adjustment one player at a time, stopping at the first rejection instead of firing every call upfront', async () => {
        // Distinguishes the required sequential/fail-stop loop from a
        // Promise.all-based rewrite: with three players and the SECOND
        // one rejecting, a sequential for-of/await loop calls the first
        // player, awaits it to completion, calls the second, awaits its
        // rejection, and stops there, never calling the third. A
        // Promise.all(...map(...)) rewrite would instead invoke all three
        // updatePointsForPlayer calls synchronously up front (bob and
        // carol included) regardless of alice's outcome, which both the
        // call-count/argument assertions and the callOrder assertion below
        // would catch.
        const callOrder = [];
        updatePointsForPlayer.mockImplementation((player) => {
            callOrder.push(`start:${player}`);
            if (player === 'bob') {
                return Promise.reject(new Error('player not found')).finally(() => {
                    callOrder.push('end:bob');
                });
            }
            return Promise.resolve().then(() => {
                callOrder.push(`end:${player}`);
            });
        });

        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob', 'carol'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText(/adjust 3 players. scores by \+5 each/i);
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText(/player not found/i)).toBeInTheDocument();

        // Alice (before the failure) got her adjustment; bob (the
        // rejecting call) was attempted; carol (after the failure) was
        // never attempted at all.
        expect(updatePointsForPlayer).toHaveBeenCalledWith('alice', 5, 'room-a');
        expect(updatePointsForPlayer).toHaveBeenCalledWith('bob', 5, 'room-a');
        expect(updatePointsForPlayer).not.toHaveBeenCalledWith('carol', 5, 'room-a');
        expect(updatePointsForPlayer).toHaveBeenCalledTimes(2);

        // Alice's call must have fully started AND settled before bob's
        // call even starts — proof of true sequential execution. A
        // Promise.all rewrite would show both starts back-to-back before
        // either settles (['start:alice', 'start:bob', ...]).
        expect(callOrder).toEqual(['start:alice', 'end:alice', 'start:bob', 'end:bob']);
    });

    it('never re-awards a player who already succeeded when Confirm is retried after a mid-loop failure', async () => {
        // updatePointsForPlayer is additive (Firestore increment()), and
        // a failed attempt deliberately leaves pendingAdjustment set so
        // the GM can click Confirm again. The retry must resume, not
        // restart: alice already banked her +5 on the first attempt, so a
        // second call for her would silently double her score.
        let bobAttempts = 0;
        updatePointsForPlayer.mockImplementation((player) => {
            if (player === 'bob') {
                bobAttempts += 1;
                if (bobAttempts === 1) return Promise.reject(new Error('player not found'));
            }
            return Promise.resolve();
        });

        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText(/adjust 2 players. scores by \+5 each/i);

        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(await screen.findByText(/player not found/i)).toBeInTheDocument();

        // The retry — same pendingAdjustment, same Confirm button.
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();

        const callsFor = (player) =>
            updatePointsForPlayer.mock.calls.filter(([name]) => name === player);
        expect(callsFor('alice')).toEqual([['alice', 5, 'room-a']]);
        expect(callsFor('bob')).toEqual([
            ['bob', 5, 'room-a'],
            ['bob', 5, 'room-a'],
        ]);
        // The mission document write succeeded the first time through, so
        // the retry must not repeat it either.
        expect(updateTaskForRoom).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });

    it('starts a fresh attempt when Save is clicked again after a failed one', async () => {
        // The skip-on-retry bookkeeping is scoped to one pending
        // adjustment. Clicking Save again is a new attempt whose task
        // write has not happened yet, so it must not be skipped.
        updateTaskForRoom.mockRejectedValueOnce(new Error('network down'));
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/network down/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledTimes(2);
    });

    it('keeps titleTrimmedLowerCase in step with an edited title', async () => {
        // checkForTaskDupesForRoom queries only titleTrimmedLowerCase, so
        // a rename that left it behind would permanently desync the
        // duplicate-title index from the visible title.
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Retrieve The Key');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({
                title: 'Retrieve The Key',
                titleTrimmedLowerCase: 'retrievethekey',
            }),
            'room-a'
        );
    });

    it('stores pointValue as a string, matching how TaskCreation stores it', async () => {
        // docs/data-model.md: pointValue is the raw string from the
        // Chakra NumberInput, read back with parseInt. Coercing it to a
        // number on the edit path alone would leave the same field
        // holding two different types depending on edit history.
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '25');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom.mock.calls[0][1].pointValue).toBe('25');
    });

    it('rejects a blank title instead of saving one', async () => {
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task title cannot be blank/i)).toBeInTheDocument();
        expect(updateTaskForRoom).not.toHaveBeenCalled();
    });

    it('rejects a Task worth 0 points instead of saving one', async () => {
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '0');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task cannot have 0 points/i)).toBeInTheDocument();
        expect(updateTaskForRoom).not.toHaveBeenCalled();
    });

    it('disables the point input and writes 0 points once Revival Mission is selected', async () => {
        mountModal();

        await userEvent.selectOptions(screen.getByRole('combobox'), 'Revival Mission');

        expect(screen.getByLabelText(/point value/i)).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        // 10 was in the field before the type changed; a Revival Mission
        // is worth nothing regardless.
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ taskType: 'Revival Mission', pointValue: '0' }),
            'room-a'
        );
    });

    it('does not save a task type changed before a completion landed', async () => {
        // The Select is disabled once completedBy is non-empty, but a
        // completion can land (another GM's view, a /mission done in
        // chat) after the GM has already changed the dropdown — the
        // already-changed state must not be written.
        const { rerender } = render(renderModal());

        await userEvent.selectOptions(screen.getByRole('combobox'), 'Revival Mission');
        rerender(renderModal({ ...baseTask, completedBy: ['alice'] }));

        // The dropdown itself must reflect the locked-back value once
        // completions land, not the GM's now-discarded selection — showing
        // "Revival Mission" here while Save silently writes "Task" would
        // be its own, separate bug even though the write is correct.
        expect(screen.getByRole('combobox')).toHaveValue('Task');

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ taskType: 'Task' }),
            'room-a'
        );
    });

    it('logs the edit to the GM log and announces it in the player chat', async () => {
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the second clue');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(addLog).toHaveBeenCalledWith(
            'Mission "Find the second clue" was edited',
            'blue.400'
        );
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Mission Find the second clue was edited',
                standings: null,
            },
            'room-a'
        );
    });
});

describe('TaskEditModal reopened from TaskAccordion', () => {
    // The real parent, unstubbed — the point of this fix is that
    // TaskAccordion unmounts the modal on close, so a stub would prove
    // nothing. TaskAccordion.test.jsx covers the rest of that component
    // with the modal stubbed out.
    const mountAccordion = (task = baseTask) =>
        render(
            <ChakraProvider>
                <gameContext.Provider value={{ roomID: 'room-a' }}>
                    <executionContext.Provider value={{ addLog: jest.fn() }}>
                        <Accordion allowToggle defaultIndex={0}>
                            <TaskAccordion task={task} />
                        </Accordion>
                    </executionContext.Provider>
                </gameContext.Provider>
            </ChakraProvider>
        );

    it('discards edits abandoned with Close instead of restoring them on reopen', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Edit', hidden: true }));
        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'GARBAGE EDIT');
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        await userEvent.click(screen.getByRole('button', { name: 'Edit', hidden: true }));

        expect(screen.getByPlaceholderText('Task Title')).toHaveValue('Find the clue');
        expect(screen.queryByDisplayValue('GARBAGE EDIT')).not.toBeInTheDocument();

        // And the abandoned text is not what a subsequent Save writes.
        // The async assertion below (not an act() wrapper around the click)
        // is how this repo waits on an async handler — see
        // MessageComposer.test.jsx's header for why manual act-wrapping of
        // userEvent is the anti-pattern `testing-library/no-unnecessary-act`
        // flags. Saving here does print one "not wrapped in act(...)"
        // warning, because a successful save calls the real parent's
        // onClose, which sets TaskAccordion state from inside applyUpdate's
        // async continuation; that is the same known user-event@13.5.0 /
        // React 18 characteristic documented there, not a flaky test.
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/task updated/i)).toBeInTheDocument();
        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ title: 'Find the clue' }),
            'room-a'
        );
    });
});
