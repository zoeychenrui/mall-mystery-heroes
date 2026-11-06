/**
 * Component test for MissionsModal — the RN port of
 * src/components/task_components/PlayerTaskListModal.js. Read-only and
 * presentational: no Firebase dependency, so no Firebase mocks here.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import MissionsModal from './MissionsModal';

const MISSIONS = [
    {
        title: 'Coffee Run',
        description: 'Buy a coffee for a stranger.',
        taskType: 'photo',
        pointValue: 10,
        maxCompletions: 2,
    },
    {
        title: 'Lost Keys',
        description: 'Find the keys hidden by the GM.',
        taskType: 'hunt',
        pointValue: 25,
        maxCompletions: 0,
    },
];

const renderModal = async (props = {}) =>
    render(<MissionsModal isOpen onClose={jest.fn()} missions={MISSIONS} {...props} />);

describe('MissionsModal', () => {
    it('renders each mission title and description', async () => {
        await renderModal();

        expect(screen.getByText('Coffee Run')).toBeTruthy();
        expect(screen.getByText('Buy a coffee for a stranger.')).toBeTruthy();
        expect(screen.getByText('Lost Keys')).toBeTruthy();
        expect(screen.getByText('Find the keys hidden by the GM.')).toBeTruthy();
    });

    it('shows the task-type, point-value and completion-limit line, matching MessageBubble', async () => {
        await renderModal();

        expect(screen.getByText('photo · 10 points · Limited to 2 players')).toBeTruthy();
        expect(screen.getByText('hunt · 25 points · Unlimited players')).toBeTruthy();
    });

    it('shows an empty state when there are no missions', async () => {
        await renderModal({ missions: [] });

        expect(screen.getByText('No missions yet.')).toBeTruthy();
    });

    it('calls onClose when the close button is pressed', async () => {
        const onClose = jest.fn();
        await renderModal({ onClose });

        fireEvent.press(screen.getByLabelText('Close missions'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
