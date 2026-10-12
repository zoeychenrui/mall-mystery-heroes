/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * First test coverage for this component: it was unreachable dead code
 * (docs/improvements.md item 15 — the whole mission panel was commented out
 * in GameMasterView) until this session restored it. Explicit dbCalls mock
 * factory, not auto-mock — see ChatInput.test.jsx for why.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskCreation from './TaskCreation';
import { gameContext, taskContext } from '../Contexts';
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

const mountTaskCreation = () =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <taskContext.Provider value={{ handleNewTaskAdded }}>
                    <TaskCreation />
                </taskContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    fetchTaskIndexThenIncrement.mockResolvedValue(3);
    checkForTaskDupesForRoom.mockResolvedValue(false);
    addTaskForRoom.mockResolvedValue(undefined);
});

// Revival Mission auto-zeroes and disables the points field, so these tests
// don't need to drive Chakra's NumberInput to cover the core create flow.
const fillOutRevivalMissionTask = async (title) => {
    await userEvent.type(screen.getByPlaceholderText('Task Title'), title);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Revival Mission');
};

describe('TaskCreation (improvements item 15)', () => {
    it('creates a task end to end and clears the form', async () => {
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task Added')).toBeInTheDocument();
        expect(checkForTaskDupesForRoom).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Find the clue', taskType: 'Revival Mission' }),
            'room-a'
        );
        expect(addTaskForRoom).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Find the clue', taskIndex: 3 }),
            'room-a'
        );
        expect(handleNewTaskAdded).toHaveBeenCalled();
        await waitFor(() => expect(screen.getByPlaceholderText('Task Title')).toHaveValue(''));
    });

    it('shows an error and does not create the task when a duplicate exists', async () => {
        checkForTaskDupesForRoom.mockResolvedValue(true);
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task already exists')).toBeInTheDocument();
        expect(addTaskForRoom).not.toHaveBeenCalled();
        expect(handleNewTaskAdded).not.toHaveBeenCalled();
    });

    it('shows an error toast instead of creating the task when addTaskForRoom rejects', async () => {
        addTaskForRoom.mockRejectedValue(new Error('network down'));
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(handleNewTaskAdded).not.toHaveBeenCalled();
    });

    it('requires a task type to be selected', async () => {
        mountTaskCreation();

        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task type must be selected')).toBeInTheDocument();
        expect(addTaskForRoom).not.toHaveBeenCalled();
    });
});

describe('a failed submission does not burn a task index (bug report)', () => {
    it('does not fetch a task index when no task type is selected', async () => {
        mountTaskCreation();

        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task type must be selected')).toBeInTheDocument();
        expect(fetchTaskIndexThenIncrement).not.toHaveBeenCalled();
    });

    it('does not fetch a task index when the task is a duplicate', async () => {
        checkForTaskDupesForRoom.mockResolvedValue(true);
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task already exists')).toBeInTheDocument();
        expect(fetchTaskIndexThenIncrement).not.toHaveBeenCalled();
    });

    it('only fetches a task index once every check has passed', async () => {
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(addTaskForRoom).toHaveBeenCalled());
        expect(fetchTaskIndexThenIncrement).toHaveBeenCalledTimes(1);
    });
});

describe('optional completion cap (bug report)', () => {
    it('includes maxCompletions in the created task when set', async () => {
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.type(screen.getByPlaceholderText('Max completions'), '5');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(addTaskForRoom).toHaveBeenCalledWith(
                expect.objectContaining({ maxCompletions: 5 }),
                'room-a'
            )
        );
    });

    it('defaults maxCompletions to null (unlimited) when left blank', async () => {
        mountTaskCreation();

        await fillOutRevivalMissionTask('Find the clue');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(addTaskForRoom).toHaveBeenCalledWith(
                expect.objectContaining({ maxCompletions: null }),
                'room-a'
            )
        );
    });
});
