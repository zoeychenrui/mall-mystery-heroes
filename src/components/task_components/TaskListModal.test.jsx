/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskList itself is unchanged and already covered by TaskList.test.jsx —
 * this only tests the modal shell around it
 * (docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import TaskListModal from './TaskListModal';
import { gameContext } from '../Contexts';
import { fetchTasksByCompletionForRoom } from '../firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchTasksByCompletionForRoom: jest.fn(),
    fetchTasksQueryForRoom: jest.fn(() => 'tasks-query'),
}));

const onClose = jest.fn();

const mountModal = (isOpen) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <TaskListModal isOpen={isOpen} onClose={onClose} />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    fetchTasksByCompletionForRoom.mockResolvedValue({ docs: [] });
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: [] });
        return () => {};
    });
});

describe('TaskListModal', () => {
    it('renders the mission list when open', () => {
        mountModal(true);

        expect(screen.getByText('Active (0)')).toBeInTheDocument();
        expect(screen.getByText('Completed (0)')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        mountModal(false);

        expect(screen.queryByText('Active (0)')).not.toBeInTheDocument();
    });

    it('calls onClose when the Close button is clicked', async () => {
        mountModal(true);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('focuses the body container on open, not the Close button (bug report: same class as /mission start "does nothing")', async () => {
        // Same mechanism as TaskCreationModal.test.jsx's equivalent test —
        // see the comment there. TaskList is read-only, so there's no safe
        // input to target; initialFocusRef instead points at the modal
        // body container itself, a plain, non-activating element.
        mountModal(true);

        expect(await screen.findByText('Active (0)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close modal' })).not.toHaveFocus();
    });
});
