/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskAccordion now owns Edit (opens TaskEditModal) and Delete (opens an
 * inline confirmation dialog, matching PlayerRemove.js's pattern) for
 * each mission
 * (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
 * TaskEditModal is stubbed — it has its own dedicated test file
 * (TaskEditModal.test.jsx) — matching how PlayerGame.test.jsx stubs
 * MessageFeed/MessageComposer.
 *
 * Edit/Delete queries pass `{ hidden: true }`: AccordionPanel content sits
 * behind Chakra's Collapse, which drives visibility through a framer-motion
 * animation that needs a real animation-frame tick to flip its inline style
 * off `display: none` — a tick that never arrives in jsdom's synchronous
 * render/query cycle, even though the panel is genuinely expanded
 * (`defaultIndex={0}`, `AccordionButton`'s `aria-expanded="true"` from the
 * first render). `hidden: true` only bypasses Testing Library's
 * accessibility-tree visibility filter for the query itself; it does not
 * change what TaskAccordion renders or claim the row is collapsed. The
 * AlertDialog's own buttons (Confirm/Go Back) don't need it — Chakra's
 * Modal-based dialogs render fully interactive without this animation gate,
 * as PlayerRemove.test.jsx/TaskEditModal.test.jsx already show.
 */
import React from 'react';
import { ChakraProvider, Accordion } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskAccordion from './TaskAccordion';
import { gameContext, executionContext } from '../Contexts';
import { deleteTaskForRoom, addPlayerMessageForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    deleteTaskForRoom: jest.fn(),
    addPlayerMessageForRoom: jest.fn(),
}));
jest.mock(
    './TaskEditModal',
    () => (props) => (props.isOpen ? <div>task-edit-modal-stub task={props.task.title}</div> : null)
);

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

const executionHandlers = { addLog: jest.fn() };

const mountAccordion = (task = baseTask) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <Accordion allowToggle defaultIndex={0}>
                        <TaskAccordion task={task} />
                    </Accordion>
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    deleteTaskForRoom.mockResolvedValue(undefined);
    addPlayerMessageForRoom.mockResolvedValue(undefined);
});

describe('TaskAccordion', () => {
    it('opens TaskEditModal with the current task when Edit is clicked', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Edit', hidden: true }));

        // Scoped to the modal stub itself (not a bare /Find the clue/ query)
        // because the still-visible AccordionButton header ("1. Find the
        // clue") also matches that text — two independent DOM subtrees, so
        // an unscoped query is ambiguous regardless of the stub.
        const modalStub = screen.getByText(/task-edit-modal-stub/);
        expect(modalStub).toBeInTheDocument();
        expect(modalStub).toHaveTextContent('Find the clue');
    });

    it('opens a confirmation dialog when Delete is clicked, without deleting immediately', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));

        expect(screen.getByText(/delete find the clue/i)).toBeInTheDocument();
        expect(deleteTaskForRoom).not.toHaveBeenCalled();
    });

    it('mentions the completion count in the confirmation dialog when the mission has completions', async () => {
        mountAccordion({ ...baseTask, completedBy: ['alice', 'bob'] });

        await userEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));

        expect(screen.getByText(/2 player/i)).toBeInTheDocument();
    });

    it('does not mention completions in the confirmation dialog when nobody has completed the mission', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));

        expect(screen.queryByText(/player.*completed/i)).not.toBeInTheDocument();
    });

    it('calls deleteTaskForRoom only after Confirm is clicked', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(deleteTaskForRoom).toHaveBeenCalledWith(1, 'room-a');
    });

    it('deletes nothing when Go Back is clicked', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));
        await userEvent.click(screen.getByRole('button', { name: 'Go Back' }));

        expect(deleteTaskForRoom).not.toHaveBeenCalled();
    });

    it('logs the deletion to the GM log and announces it in the player chat', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete', hidden: true }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'Mission "Find the clue" was deleted',
                'red.400'
            )
        );
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Mission Find the clue was deleted',
                standings: null,
            },
            'room-a'
        );
    });
});
