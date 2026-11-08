/**
 * Component test for MissionsModal — the RN port of
 * src/components/task_components/PlayerTaskListModal.js, PlayerTaskList.js
 * and PlayerTaskAccordion.js. Read-only and presentational: no Firebase
 * dependency, so no Firebase mocks here.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import MissionsModal from './MissionsModal';
// Despite the filename, this is now one of GameScreen's five swipeable
// pages (the Clash-Royale-style redesign), not a popup — no isOpen/onClose.

const MISSIONS = [
    {
        taskIndex: 1,
        title: 'Coffee Run',
        description: 'Buy a coffee for a stranger.',
        taskType: 'photo',
        pointValue: 10,
        maxCompletions: 2,
        isComplete: false,
        completedBy: ['Dana'],
    },
    {
        taskIndex: 2,
        title: 'Lost Keys',
        description: 'Find the keys hidden by the GM.',
        taskType: 'hunt',
        pointValue: 25,
        maxCompletions: 0,
        isComplete: false,
        completedBy: [],
    },
    {
        taskIndex: 3,
        title: 'Ring Hunt',
        description: 'Locate the lost ring.',
        taskType: 'photo',
        pointValue: 15,
        maxCompletions: 1,
        isComplete: true,
        completedBy: ['Eli'],
    },
    {
        taskIndex: 4,
        title: 'Shared Clue',
        description: 'Decode the shared clue.',
        taskType: 'hunt',
        pointValue: 5,
        maxCompletions: 0,
        isComplete: true,
        completedBy: ['Fay', 'Gus'],
    },
];

const renderModal = async (props = {}) => render(<MissionsModal missions={MISSIONS} {...props} />);

describe('MissionsModal', () => {
    it('renders the Active tab by default, showing only incomplete missions', async () => {
        await renderModal();

        expect(screen.getByText('Coffee Run')).toBeTruthy();
        expect(screen.getByText('Lost Keys')).toBeTruthy();
        expect(screen.queryByText('Ring Hunt')).toBeNull();
        expect(screen.queryByText('Shared Clue')).toBeNull();
    });

    it('labels each tab with its live count', async () => {
        await renderModal();

        expect(screen.getByText('Active (2)')).toBeTruthy();
        expect(screen.getByText('Completed (2)')).toBeTruthy();
    });

    it('keeps the task-type, point-value and completion-limit line', async () => {
        await renderModal();

        expect(screen.getByText('photo · 10 points · Limited to 2 players')).toBeTruthy();
        expect(screen.getByText('hunt · 25 points · Unlimited players')).toBeTruthy();
    });

    it('renders the description for each mission', async () => {
        await renderModal();

        expect(screen.getByText('Buy a coffee for a stranger.')).toBeTruthy();
        expect(screen.getByText('Find the keys hidden by the GM.')).toBeTruthy();
    });

    it('shows the completions counter and "Incomplete" on active missions', async () => {
        await renderModal();

        expect(screen.getByText('Completions: 1 / 2')).toBeTruthy();
        expect(screen.getByText('Completions: 0')).toBeTruthy();
        expect(screen.getAllByText('Incomplete')).toHaveLength(2);
    });

    it('switches to the Completed tab and shows completed-by names', async () => {
        await renderModal();

        await fireEvent.press(screen.getByText('Completed (2)'));

        expect(screen.getByText('Ring Hunt')).toBeTruthy();
        expect(screen.getByText('Shared Clue')).toBeTruthy();
        expect(screen.queryByText('Coffee Run')).toBeNull();
        expect(screen.queryByText('Lost Keys')).toBeNull();
        expect(screen.getByText('Completed By: Eli')).toBeTruthy();
        expect(screen.getByText('Completed By: Fay, Gus')).toBeTruthy();
        expect(screen.getByText('Completions: 1 / 1')).toBeTruthy();
        expect(screen.getByText('Completions: 2')).toBeTruthy();
    });

    it('shows an empty state per tab when there are no missions in it', async () => {
        await renderModal({ missions: MISSIONS.filter((m) => m.isComplete) });

        expect(screen.getByText('No active missions.')).toBeTruthy();
        await fireEvent.press(screen.getByText('Completed (2)'));
        expect(screen.queryByText('No completed missions.')).toBeNull();
    });

    it('shows the completed empty state when nothing is completed', async () => {
        await renderModal({ missions: MISSIONS.filter((m) => !m.isComplete) });

        await fireEvent.press(screen.getByText('Completed (0)'));

        expect(screen.getByText('No completed missions.')).toBeTruthy();
    });
});
