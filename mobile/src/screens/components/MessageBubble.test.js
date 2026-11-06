/**
 * Component test for the 'gameEndedLeaderboard' branch of MessageBubble —
 * the top three standings inline, with a "View Full Leaderboard" button
 * that opens LeaderboardModal. Presentational: no Firebase mocks needed.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import MessageBubble from './MessageBubble';

const STANDINGS = [
    { name: 'Alice', score: 30, isAlive: true },
    { name: 'Bob', score: 20, isAlive: false },
    { name: 'Cara', score: 15, isAlive: true },
    { name: 'Dan', score: 5, isAlive: true },
];

const MESSAGE = { type: 'gameEndedLeaderboard', standings: STANDINGS, timestamp: null };

describe('MessageBubble gameEndedLeaderboard', () => {
    it('shows only the top three standings inline', async () => {
        await render(<MessageBubble message={MESSAGE} playerName="Alice" />);

        expect(screen.getByText('1. Alice — 30')).toBeTruthy();
        expect(screen.getByText('2. Bob — 20 (eliminated)')).toBeTruthy();
        expect(screen.getByText('3. Cara — 15')).toBeTruthy();
        expect(screen.queryByText('4. Dan — 5')).toBeNull();
    });

    it('opens the full leaderboard when "View Full Leaderboard" is pressed', async () => {
        await render(<MessageBubble message={MESSAGE} playerName="Alice" />);

        expect(screen.queryByText('4. Dan — 5')).toBeNull();
        fireEvent.press(screen.getByText('View Full Leaderboard'));

        expect(await screen.findByText('4. Dan — 5')).toBeTruthy();
    });
});
