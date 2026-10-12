/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 30: App.js had no catch-all `*` route,
 * so an unrecognized URL rendered a blank page. NotFound is that route's
 * element — a plain presentational component, no Firebase/context needed.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFound from './NotFound';

const mountNotFound = () =>
    render(
        <ChakraProvider>
            <MemoryRouter>
                <NotFound />
            </MemoryRouter>
        </ChakraProvider>
    );

describe('NotFound', () => {
    it('renders a 404 message and a link back home', () => {
        mountNotFound();

        expect(screen.getByText('404')).toBeInTheDocument();
        const homeLink = screen.getByRole('link', { name: /back to home/i });
        expect(homeLink).toHaveAttribute('href', '/');
    });
});
