/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * PlayersList became presentational when GameMasterView took over the live
 * subscription it used to own itself (docs/improvements.md item 13) — this
 * is what makes it testable with a plain `players` prop and zero Firestore
 * mocking.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import PlayersList from './PlayersList';

const mountPlayersList = (players) =>
    render(
        <ChakraProvider>
            <PlayersList players={players} />
        </ChakraProvider>
    );

describe('PlayersList', () => {
    // Must run before any other test in this file mounts a multi-player
    // list: React only warns about a missing `key` once per process, so a
    // spy set up after an earlier unspied render would see nothing and this
    // test would pass even if the bug came back.
    it('gives each rendered row a stable key instead of none', () => {
        // Pre-existing bug, surfaced now that this component is actually
        // rendered in a test: the mapped rows had no `key` prop at all,
        // which React warns about via console.error.
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        mountPlayersList([
            { name: 'Alice', score: 10, targets: [], isAlive: true, openSeason: false },
            { name: 'Bob', score: 5, targets: [], isAlive: true, openSeason: false },
        ]);

        const keyWarnings = consoleError.mock.calls.filter((call) =>
            String(call[0]).includes('unique "key" prop')
        );
        expect(keyWarnings).toHaveLength(0);
        consoleError.mockRestore();
    });

    it('renders each player with their rank, name, score, and targets', () => {
        mountPlayersList([
            { name: 'Alice', score: 10, targets: ['Bob'], isAlive: true, openSeason: false },
            { name: 'Bob', score: 5, targets: [], isAlive: true, openSeason: false },
        ]);

        expect(screen.getByText('1. Alice')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('Bob', { selector: 'div' })).toBeInTheDocument(); // Alice's target
        expect(screen.getByText('2. Bob')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('renders nothing when there are no players', () => {
        mountPlayersList([]);

        expect(screen.queryByText(/\d+\. /)).not.toBeInTheDocument();
    });

    it('renders multiple targets for a player with more than one', () => {
        mountPlayersList([
            {
                name: 'Alice',
                score: 0,
                targets: ['Bob', 'Carol'],
                isAlive: true,
                openSeason: false,
            },
        ]);

        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Carol')).toBeInTheDocument();
    });
});
