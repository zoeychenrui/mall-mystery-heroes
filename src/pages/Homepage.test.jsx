/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the Host Game / Join Game buttons and the localStorage
 * redirect-on-mount for a returning player
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * The redirect only fires when a stored session is backed by an actual
 * signed-in Firebase user (final-review fix: without that check, Homepage
 * and RequireAuth can form an infinite redirect loop when the localStorage
 * session outlives Firebase Auth's own state). Firebase Auth restores that
 * user asynchronously, so Homepage subscribes via onAuthStateChanged
 * exactly like RequireAuth does — 'firebase/auth' and '../utils/firebase'
 * are mocked here the same way RequireAuth.test.jsx mocks them, controlling
 * what the onAuthStateChanged callback receives in each test.
 * playerSession.js itself is left unmocked: it touches only real
 * (jsdom-provided) localStorage.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { getDoc, getDocs } from 'firebase/firestore';
import Homepage from './Homepage';
import { readPlayerSession, writePlayerSession } from '../utils/playerSession';

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
    collectionGroup: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    getDoc: jest.fn(),
    getDocs: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {}, db: {} }));

const renderHomepage = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Homepage />} />
                    <Route path="/login" element={<div>Login page</div>} />
                    <Route path="/join" element={<div>Join page</div>} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    localStorage.clear();
    getDoc.mockReset();
    getDocs.mockReset();
    onAuthStateChanged.mockReset();
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback(null);
        return () => {};
    });
});

describe('Homepage', () => {
    it('shows Host Game and Join Game buttons when no session is stored', () => {
        renderHomepage();

        expect(screen.getByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
    });

    it('navigates to /login when Host Game is clicked', async () => {
        renderHomepage();

        await userEvent.click(screen.getByRole('button', { name: 'Host Game' }));

        expect(screen.getByText('Login page')).toBeInTheDocument();
    });

    it('navigates to /join when Join Game is clicked', async () => {
        renderHomepage();

        await userEvent.click(screen.getByRole('button', { name: 'Join Game' }));

        expect(screen.getByText('Join page')).toBeInTheDocument();
    });

    it('redirects straight to the waiting screen when a player session is stored and Firebase Auth reports a signed-in user', () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'test-uid' });
            return () => {};
        });
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByText('Waiting page')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Host Game' })).not.toBeInTheDocument();
    });

    it('shows the Host/Join buttons (no redirect loop) when a session is stored but Firebase Auth reports no signed-in user', () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback(null);
            return () => {};
        });
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });

    it('recovers and redirects when no session is stored but a matching player doc is found by uid', async () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'recovered-uid' });
            return () => {};
        });
        getDocs.mockResolvedValue({
            empty: false,
            docs: [
                {
                    data: () => ({ name: 'Alice', uid: 'recovered-uid' }),
                    ref: { parent: { parent: { id: 'Fluffy42317' } } },
                },
            ],
        });

        renderHomepage();

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(readPlayerSession()).toEqual({ roomID: 'Fluffy42317', playerName: 'Alice' });
    });

    it('recovers into the still-active room when the uid matches player docs in several rooms', async () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'recovered-uid' });
            return () => {};
        });
        getDocs.mockResolvedValue({
            empty: false,
            docs: [
                {
                    data: () => ({ name: 'Alice', uid: 'recovered-uid' }),
                    ref: { parent: { parent: { id: 'EndedRoom1' } } },
                },
                {
                    data: () => ({ name: 'Alicia', uid: 'recovered-uid' }),
                    ref: { parent: { parent: { id: 'ActiveRoom2' } } },
                },
            ],
        });
        // Keyed on the *room* ref Homepage passes to getDoc
        // (playerDoc.ref.parent.parent), not the player doc's own ref.
        getDoc.mockImplementation(async (roomRef) => ({
            exists: () => true,
            data: () => ({ isGameActive: roomRef.id === 'ActiveRoom2' }),
        }));

        renderHomepage();

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(readPlayerSession()).toEqual({ roomID: 'ActiveRoom2', playerName: 'Alicia' });
    });

    it('falls back to the first candidate when none of the matching rooms is still active', async () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'recovered-uid' });
            return () => {};
        });
        getDocs.mockResolvedValue({
            empty: false,
            docs: [
                {
                    data: () => ({ name: 'Alice', uid: 'recovered-uid' }),
                    ref: { parent: { parent: { id: 'EndedRoom1' } } },
                },
                {
                    data: () => ({ name: 'Alicia', uid: 'recovered-uid' }),
                    ref: { parent: { parent: { id: 'EndedRoom2' } } },
                },
            ],
        });
        getDoc.mockResolvedValue({ exists: () => true, data: () => ({ isGameActive: false }) });

        renderHomepage();

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(readPlayerSession()).toEqual({ roomID: 'EndedRoom1', playerName: 'Alice' });
    });

    it('recovers without reading any room doc when only one candidate comes back', async () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'recovered-uid' });
            return () => {};
        });
        getDocs.mockResolvedValue({
            empty: false,
            docs: [
                {
                    data: () => ({ name: 'Alice', uid: 'recovered-uid' }),
                    ref: { parent: { parent: { id: 'Fluffy42317' } } },
                },
            ],
        });

        renderHomepage();

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('shows the Host/Join buttons when no session is stored and no matching player doc is found', async () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'stranger-uid' });
            return () => {};
        });
        getDocs.mockResolvedValue({ empty: true, docs: [] });

        renderHomepage();

        expect(await screen.findByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });

    it('shows the Host/Join buttons, not an error, when the recovery query itself fails', async () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'stranger-uid' });
            return () => {};
        });
        getDocs.mockRejectedValue(new Error('network error'));

        renderHomepage();

        expect(await screen.findByRole('button', { name: 'Host Game' })).toBeInTheDocument();
    });
});
