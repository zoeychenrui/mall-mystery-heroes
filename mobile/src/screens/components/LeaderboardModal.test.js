/**
 * Component test for LeaderboardModal — one of GameScreen's five
 * swipeable pages (the Clash-Royale-style redesign), not a popup despite
 * the filename. Read-only and presentational: no Firebase dependency, so
 * no Firebase mocks here.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen } from '@testing-library/react-native';
import LeaderboardModal from './LeaderboardModal';

// Already sorted, the shape buildLeaderboardStandings returns.
const STANDINGS = [
    { name: 'Alice', score: 30, isAlive: true },
    { name: 'Bob', score: 20, isAlive: false },
    { name: 'Cara', score: 5, isAlive: true },
];

const renderModal = async (props = {}) =>
    render(<LeaderboardModal standings={STANDINGS} {...props} />);

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

    it('shows an empty state before the players list has any standings yet (e.g. the waiting room)', async () => {
        await renderModal({ standings: [] });

        expect(screen.getByText('No standings yet.')).toBeTruthy();
    });
});
