/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Read-only sibling of TaskAccordion.test.jsx — same fields, no
 * Edit/Delete controls to test, so this file is much shorter.
 */
import React from 'react';
import { ChakraProvider, Accordion } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import PlayerTaskAccordion from './PlayerTaskAccordion';

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

const mountAccordion = (task = baseTask) =>
    render(
        <ChakraProvider>
            <Accordion allowToggle defaultIndex={0}>
                <PlayerTaskAccordion task={task} />
            </Accordion>
        </ChakraProvider>
    );

describe('PlayerTaskAccordion', () => {
    it('shows the mission title, index, and point value in the header', () => {
        mountAccordion();

        expect(screen.getByText(/1\. Find the clue/)).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('shows the description, task type, and completion count in the body', () => {
        mountAccordion();

        expect(screen.getByText('Description: Look around', { hidden: true })).toBeInTheDocument();
        expect(screen.getByText('Task Type: Task', { hidden: true })).toBeInTheDocument();
        expect(screen.getByText('Completions: 0', { hidden: true })).toBeInTheDocument();
        expect(screen.getByText('Incomplete', { hidden: true })).toBeInTheDocument();
    });

    it('shows a completions cap when maxCompletions is set', () => {
        mountAccordion({ ...baseTask, maxCompletions: 3, completedBy: ['alice'] });

        expect(screen.getByText('Completions: 1 / 3', { hidden: true })).toBeInTheDocument();
    });

    it('lists who completed it once the mission is complete', () => {
        mountAccordion({ ...baseTask, isComplete: true, completedBy: ['alice', 'bob'] });

        expect(screen.getByText('Completed By: alice, bob', { hidden: true })).toBeInTheDocument();
    });

    it('renders no Edit or Delete controls', () => {
        mountAccordion();

        expect(
            screen.queryByRole('button', { name: 'Edit', hidden: true })
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Delete', hidden: true })
        ).not.toBeInTheDocument();
    });
});
