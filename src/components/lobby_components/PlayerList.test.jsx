/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * PlayerList renders the room's joined player names as a single centered
 * column (2026-08-14 simplified-lobby redesign) — previously split into
 * two side-by-side columns for a wide split-screen layout that no longer
 * exists (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import PlayerList from './PlayerList';

describe('PlayerList', () => {
    it('renders every name once, in a single list, in order', () => {
        render(
            <ChakraProvider>
                <PlayerList arrayOfPlayers={['Alice', 'Bob', 'Carol']} />
            </ChakraProvider>
        );

        expect(screen.getAllByRole('list')).toHaveLength(1);
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'Alice',
            'Bob',
            'Carol',
        ]);
    });

    it('renders no list items when there are no players', () => {
        render(
            <ChakraProvider>
                <PlayerList arrayOfPlayers={[]} />
            </ChakraProvider>
        );

        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
});
