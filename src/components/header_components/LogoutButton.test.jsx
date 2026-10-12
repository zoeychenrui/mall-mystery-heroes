/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the Log Out button GameMasterView needs now that DashBoard no
 * longer offers one (docs/superpowers/specs/2026-08-08-dashboard-removal-
 * design.md) — a GM whose game has already started is redirected straight
 * here, bypassing Lobby.js's own separate Log Out button entirely.
 * Explicit mock factories for 'firebase/auth' and '../../utils/firebase' —
 * see RequireAuth.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import LogoutButton from './LogoutButton';

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../../utils/firebase', () => ({ auth: {} }));

const renderLogoutButton = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/GameMasterView']}>
                <Routes>
                    <Route path="/rooms/:roomID/GameMasterView" element={<LogoutButton />} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue(undefined);
});

describe('LogoutButton', () => {
    it('signs out and navigates home when clicked', async () => {
        renderLogoutButton();

        await userEvent.click(screen.getByRole('button', { name: 'Log Out' }));

        expect(signOut).toHaveBeenCalled();
        expect(await screen.findByText('Home page')).toBeInTheDocument();
    });
});
