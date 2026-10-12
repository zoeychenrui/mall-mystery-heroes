/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * LeaderboardModal is presentational: GameEndedLeaderboardBubble (the
 * 'gameEndedLeaderboard' chat message's rendering) owns isOpen state and
 * hands down the full standings array, already sorted by
 * buildLeaderboardStandings.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeaderboardModal from './LeaderboardModal';

const onClose = jest.fn();
const standings = [
    { name: 'alice', score: 30, isAlive: true },
    { name: 'bob', score: 20, isAlive: false },
];

const mountModal = (props = {}) =>
    render(
        <ChakraProvider>
            <LeaderboardModal isOpen onClose={onClose} standings={standings} {...props} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('LeaderboardModal', () => {
    it('renders every player in standings, in order, with their score', () => {
        mountModal();

        expect(screen.getByText('1. alice — 30')).toBeInTheDocument();
        expect(screen.getByText(/2\. bob — 20/)).toBeInTheDocument();
    });

    it('marks an eliminated player as eliminated', () => {
        mountModal();

        expect(screen.getByText(/bob — 20 \(eliminated\)/)).toBeInTheDocument();
    });

    it('does not mark an alive player as eliminated', () => {
        mountModal();

        expect(screen.queryByText(/alice.*eliminated/)).not.toBeInTheDocument();
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('renders nothing when isOpen is false', () => {
        mountModal({ isOpen: false });

        expect(screen.queryByText('Leaderboard')).not.toBeInTheDocument();
    });
});
