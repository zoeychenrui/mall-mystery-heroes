/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * PlayerTaskList itself is unchanged and already covered by
 * PlayerTaskList.test.jsx — this only tests the modal shell around it.
 * Unlike TaskListModal.test.jsx, this modal opens from a plain button
 * click (PlayerGame.js's "View Missions" button), not a command-bar Enter
 * keystroke, so there's no focus-trap mechanism to test here.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import PlayerTaskListModal from './PlayerTaskListModal';
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
            <PlayerTaskListModal isOpen={isOpen} onClose={onClose} roomID="room-a" />
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

describe('PlayerTaskListModal', () => {
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
});
