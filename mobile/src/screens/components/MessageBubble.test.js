/**
 * Component test for the 'gameEndedLeaderboard' branch of MessageBubble —
 * the top three standings inline, with a "View Full Leaderboard" button
 * that opens LeaderboardModal. Presentational: no Firebase mocks needed.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
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

    // Real-device regression (same bug class as ee83926's map fix): this
    // Modal is full-screen and transparent, so it renders in its own
    // native window that bypasses whatever SafeAreaView wraps the rest of
    // the app — without accounting for the top inset, the close button
    // would sit under the status bar/notch, same as the map once did.
    it("pads the close button by the top safe-area inset, so it clears the status bar/notch", async () => {
        await render(
            <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 0, left: 0, right: 0 }}>
                <MessageBubble message={MESSAGE} playerName="Alice" />
            </SafeAreaInsetsContext.Provider>
        );

        await fireEvent.press(screen.getByText('View Full Leaderboard'));

        const closeButton = screen.getByLabelText('Close leaderboard');
        expect(closeButton.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ top: 63 })])
        );
    });
});
