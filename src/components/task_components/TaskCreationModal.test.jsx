/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskCreation itself is unchanged and already covered by
 * TaskCreation.test.jsx — this only tests the modal shell around it
 * (docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskCreationModal from './TaskCreationModal';
import { gameContext } from '../Contexts';
import {
    addTaskForRoom,
    checkForTaskDupesForRoom,
    fetchTaskIndexThenIncrement,
} from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addTaskForRoom: jest.fn(),
    checkForTaskDupesForRoom: jest.fn(),
    fetchTaskIndexThenIncrement: jest.fn(),
}));

const handleNewTaskAdded = jest.fn();
const onClose = jest.fn();

const mountModal = (isOpen) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <TaskCreationModal
                    isOpen={isOpen}
                    onClose={onClose}
                    handleNewTaskAdded={handleNewTaskAdded}
                />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    fetchTaskIndexThenIncrement.mockResolvedValue(3);
    checkForTaskDupesForRoom.mockResolvedValue(false);
    addTaskForRoom.mockResolvedValue(undefined);
});

describe('TaskCreationModal', () => {
    it('renders the mission creation form when open', () => {
        mountModal(true);

        expect(screen.getByPlaceholderText('Task Title')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        mountModal(false);

        expect(screen.queryByPlaceholderText('Task Title')).not.toBeInTheDocument();
    });

    it('calls onClose when the Close button is clicked', async () => {
        mountModal(true);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('focuses the Task Title input on open, not the Close button (bug report: /mission start "does nothing")', async () => {
        // Chakra's Modal always moves focus into itself when it opens
        // (its focus trap requires *something* inside to be focused), and
        // without an explicit initialFocusRef it lands on the first
        // focusable descendant — ModalCloseButton here. /mission start
        // opens this modal synchronously, while the Enter keystroke that
        // submitted the command is still being dispatched; its keyup was
        // landing on the now-focused Close button, and a focused button's
        // native Enter-activates-on-keyup behavior clicked it, closing the
        // modal the instant it opened. Pointing initialFocusRef at the
        // Title input (a plain text input, with no activate-on-Enter
        // behavior of its own) avoids the whole class of bug regardless of
        // which key happens to still be in flight.
        mountModal(true);

        expect(await screen.findByPlaceholderText('Task Title')).toHaveFocus();
    });

    it('calls handleNewTaskAdded with the new task on a successful creation', async () => {
        mountModal(true);

        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the clue');
        await userEvent.selectOptions(screen.getByRole('combobox'), 'Revival Mission');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task Added')).toBeInTheDocument();
        expect(handleNewTaskAdded).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Find the clue', taskType: 'Revival Mission' })
        );
    });
});
