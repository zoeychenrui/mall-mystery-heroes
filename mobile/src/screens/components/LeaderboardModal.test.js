/**
 * Component test for LeaderboardModal — the RN port of
 * src/components/game_end_components/LeaderboardModal.js. Read-only and
 * presentational: no Firebase dependency, so no Firebase mocks here.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import LeaderboardModal from './LeaderboardModal';

// Already sorted, the shape buildLeaderboardStandings returns.
const STANDINGS = [
    { name: 'Alice', score: 30, isAlive: true },
    { name: 'Bob', score: 20, isAlive: false },
    { name: 'Cara', score: 5, isAlive: true },
];

const renderModal = async (props = {}) =>
    render(<LeaderboardModal isOpen onClose={jest.fn()} standings={STANDINGS} {...props} />);

describe('LeaderboardModal', () => {
    it('renders each entry as "{rank}. {name} — {score}"', async () => {
        await renderModal();

        expect(screen.getByText('1. Alice — 30')).toBeTruthy();
        expect(screen.getByText('3. Cara — 5')).toBeTruthy();
    });

    it('appends " (eliminated)" only to players who are not alive', async () => {
        await renderModal();

        expect(screen.getByText('2. Bob — 20 (eliminated)')).toBeTruthy();
        expect(screen.queryByText('1. Alice — 30 (eliminated)')).toBeNull();
    });

    it('calls onClose when the close button is pressed', async () => {
        const onClose = jest.fn();
        await renderModal({ onClose });

        fireEvent.press(screen.getByLabelText('Close leaderboard'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
