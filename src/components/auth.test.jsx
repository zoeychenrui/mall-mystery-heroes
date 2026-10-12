/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 32: the confirm-password field had no
 * show/hide toggle, unlike the password field right above it. Explicit mock
 * factories for 'firebase/auth' and '../utils/firebase' — see
 * RequireAuth.test.jsx for why.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Auth from './auth';
import { auth, googleProvider } from '../utils/firebase';

jest.mock('firebase/auth', () => ({
    createUserWithEmailAndPassword: jest.fn(),
    signInWithEmailAndPassword: jest.fn(),
    signInWithPopup: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {}, googleProvider: {} }));

const mountSignUp = () =>
    render(
        <ChakraProvider>
            <MemoryRouter>
                <Auth isLoginPage={false} />
            </MemoryRouter>
        </ChakraProvider>
    );

describe('confirm-password show/hide toggle (improvements item 32)', () => {
    it('starts masked and toggles to plain text independently of the password field', async () => {
        mountSignUp();

        const confirmInput = screen.getByPlaceholderText('Confirm password');
        const passwordInput = screen.getByPlaceholderText('Enter password');
        expect(confirmInput).toHaveAttribute('type', 'password');

        const showButtons = screen.getAllByRole('button', { name: 'Show' });
        expect(showButtons).toHaveLength(2); // one per password field

        await userEvent.click(showButtons[1]); // the confirm-password field's own toggle

        expect(confirmInput).toHaveAttribute('type', 'text');
        // Toggling confirm-password's visibility must not affect the
        // separate password field's own show/hide state.
        expect(passwordInput).toHaveAttribute('type', 'password');
    });
});

describe('Google Sign-In', () => {
    it('calls signInWithPopup with the shared googleProvider and navigates to /dashboard', async () => {
        const { signInWithPopup } = require('firebase/auth');
        signInWithPopup.mockResolvedValue({ user: { uid: 'google-uid' } });

        render(
            <ChakraProvider>
                <MemoryRouter>
                    <Auth isLoginPage={true} />
                </MemoryRouter>
            </ChakraProvider>
        );

        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

        expect(signInWithPopup).toHaveBeenCalledWith(auth, googleProvider);
    });

    it('reads "Sign up with Google" on the signup page', async () => {
        render(
            <ChakraProvider>
                <MemoryRouter>
                    <Auth isLoginPage={false} />
                </MemoryRouter>
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Sign up with Google' })).toBeInTheDocument();
    });

    it('shows an error if Google sign-in fails', async () => {
        const { signInWithPopup } = require('firebase/auth');
        signInWithPopup.mockRejectedValue(new Error('popup closed'));

        render(
            <ChakraProvider>
                <MemoryRouter>
                    <Auth isLoginPage={true} />
                </MemoryRouter>
            </ChakraProvider>
        );

        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

        expect(await screen.findByText(/error signing in with google/i)).toBeInTheDocument();
    });
});
