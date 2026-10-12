/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 3. Explicit mock factories for both
 * 'firebase/auth' and '../utils/firebase' — the real utils/firebase.js does
 * real Firebase init at import time (getFunctions() touches `fetch`,
 * undefined in jsdom), same reason ChatInput.test.jsx needs one.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import RequireAuth from './RequireAuth';

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

const renderAtDashboard = () =>
    render(
        <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
                <Route path="/" element={<div>Home page</div>} />
                <Route
                    path="/dashboard"
                    element={
                        <RequireAuth>
                            <div>Protected content</div>
                        </RequireAuth>
                    }
                />
            </Routes>
        </MemoryRouter>
    );

beforeEach(() => {
    onAuthStateChanged.mockReset();
});

it('shows a spinner before the auth state is known', () => {
    onAuthStateChanged.mockImplementation(() => () => {}); // never calls back
    renderAtDashboard();

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
});

it('renders the protected content once a signed-in user is reported', () => {
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback({ uid: 'host-uid' });
        return () => {};
    });

    renderAtDashboard();

    expect(screen.getByText('Protected content')).toBeInTheDocument();
});

it('redirects to / when no user is signed in', () => {
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback(null);
        return () => {};
    });

    renderAtDashboard();

    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
});
