/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * First test coverage for this component: it was unreachable dead code
 * (docs/improvements.md item 15 — the whole mission panel was commented out
 * in GameMasterView) until this session restored it.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import TaskList from './TaskList';
import { gameContext, executionContext } from '../Contexts';
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
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={{ addLog: jest.fn() }}>
                    <TaskList />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    // The component's own onSnapshot listener is what triggers the fetch —
    // simulate Firestore firing it once immediately on mount, same pattern
    // as PhotosDisplay.test.jsx.
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: [] });
        return () => {};
    });
});

describe('TaskList (improvements item 15)', () => {
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
