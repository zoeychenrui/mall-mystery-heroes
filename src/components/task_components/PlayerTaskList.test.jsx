/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Read-only sibling of TaskList.test.jsx — same subscription/fetch
 * behavior, takes roomID as a prop instead of gameContext.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import PlayerTaskList from './PlayerTaskList';
import { fetchTasksByCompletionForRoom } from '../firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchTasksByCompletionForRoom: jest.fn(),
    fetchTasksQueryForRoom: jest.fn(() => 'tasks-query'),
}));

const asTaskDocs = (tasks) => ({ docs: tasks.map((task) => ({ data: () => task })) });

const mountTaskList = () =>
    render(
        <ChakraProvider>
            <PlayerTaskList roomID="room-a" />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: [] });
        return () => {};
    });
});

describe('PlayerTaskList', () => {
    it('splits tasks into active and completed tabs', async () => {
        fetchTasksByCompletionForRoom.mockImplementation((isComplete) =>
            Promise.resolve(
                isComplete
                    ? asTaskDocs([
                          {
                              title: 'Old task',
                              taskIndex: 1,
                              pointValue: 5,
                              description: 'done',
                              taskType: 'Task',
                              isComplete: true,
                              completedBy: ['alice'],
                          },
                      ])
                    : asTaskDocs([
                          {
                              title: 'Find the clue',
                              taskIndex: 2,
                              pointValue: 10,
                              description: 'look around',
                              taskType: 'Task',
                              isComplete: false,
                              completedBy: [],
                          },
                      ])
            )
        );

        mountTaskList();

        expect(await screen.findByText(/2\. Find the clue/)).toBeInTheDocument();
        expect(screen.getByText('Active (1)')).toBeInTheDocument();
        expect(screen.getByText('Completed (1)')).toBeInTheDocument();
    });

    it('shows an alert and does not crash when fetchTasksByCompletionForRoom rejects', async () => {
        fetchTasksByCompletionForRoom.mockRejectedValue(new Error('network down'));

        mountTaskList();

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(screen.getByText('Active (0)')).toBeInTheDocument();
        expect(screen.getByText('Completed (0)')).toBeInTheDocument();
    });
});
