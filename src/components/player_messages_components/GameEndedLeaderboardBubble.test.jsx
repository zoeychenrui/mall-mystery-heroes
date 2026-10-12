/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Renders the top 3 of a game-end standings snapshot inline, with a
 * button opening the full LeaderboardModal — extracted out of
 * MessageBubble.js since it's the one message type needing its own local
 * state (the modal's open/closed), unlike every other type there.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameEndedLeaderboardBubble from './GameEndedLeaderboardBubble';

const standings = [
    { name: 'Carol', score: 30, isAlive: true },
    { name: 'Alice', score: 20, isAlive: true },
    { name: 'Dave', score: 10, isAlive: false },
    { name: 'Bob', score: 5, isAlive: true },
];

describe('GameEndedLeaderboardBubble', () => {
    it('shows only the top 3 standings inline', () => {
        render(
            <ChakraProvider>
                <GameEndedLeaderboardBubble standings={standings} />
            </ChakraProvider>
        );

        expect(screen.getByText(/1\. Carol.*30/)).toBeInTheDocument();
        expect(screen.getByText(/2\. Alice.*20/)).toBeInTheDocument();
        expect(screen.getByText(/3\. Dave.*10/)).toBeInTheDocument();
        expect(screen.queryByText(/Bob/)).not.toBeInTheDocument();
    });

    it('opens a modal with the full standings when the button is clicked', async () => {
        render(
            <ChakraProvider>
                <GameEndedLeaderboardBubble standings={standings} />
            </ChakraProvider>
        );

        expect(screen.queryByText('Leaderboard')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'View Full Leaderboard' }));

        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        expect(screen.getByText(/4\. Bob.*5/)).toBeInTheDocument();
    });

    it('renders nothing crashing when standings is empty', () => {
        render(
            <ChakraProvider>
                <GameEndedLeaderboardBubble standings={[]} />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'View Full Leaderboard' })).toBeInTheDocument();
    });
});
