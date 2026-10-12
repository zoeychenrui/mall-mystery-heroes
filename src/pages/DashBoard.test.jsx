/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * DashBoard.js has no visible UI now — it resolves where a signed-in GM
 * belongs (their existing active room, or a freshly created one) and
 * redirects immediately (docs/superpowers/specs/2026-08-08-dashboard-
 * removal-design.md). Explicit mock factories for 'firebase/firestore',
 * '../utils/firebase', and '../components/firebase_calls/dbCalls' — see
 * RequireAuth.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setDoc } from 'firebase/firestore';
import DashBoard from './DashBoard';
import { checkForRoomIDDupes, fetchActiveRoomForHost } from '../components/firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    setDoc: jest.fn(),
    doc: jest.fn((db, collectionName, id) => ({ id })),
    serverTimestamp: jest.fn(() => 'server-timestamp-sentinel'),
}));
jest.mock('../utils/firebase', () => ({
    auth: { currentUser: { uid: 'host-uid' } },
    db: {},
}));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    checkForRoomIDDupes: jest.fn(),
    fetchActiveRoomForHost: jest.fn(),
}));

const renderDashBoard = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/dashboard']}>
                <Routes>
                    <Route path="/dashboard" element={<DashBoard />} />
                    <Route path="/rooms/:roomID/lobby" element={<div>Lobby page</div>} />
                    <Route
                        path="/rooms/:roomID/GameMasterView"
                        element={<div>GameMasterView page</div>}
                    />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    setDoc.mockResolvedValue(undefined);
});

describe('DashBoard', () => {
    it('redirects to the lobby when an existing room has not started', async () => {
        fetchActiveRoomForHost.mockResolvedValue({ id: 'Fluffy42317', gameStarted: false });

        renderDashBoard();

        expect(await screen.findByText('Lobby page')).toBeInTheDocument();
        expect(checkForRoomIDDupes).not.toHaveBeenCalled();
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('redirects to GameMasterView when the existing room has already started', async () => {
        fetchActiveRoomForHost.mockResolvedValue({ id: 'Fluffy42317', gameStarted: true });

        renderDashBoard();

        expect(await screen.findByText('GameMasterView page')).toBeInTheDocument();
    });

    it('creates a new room and redirects to its lobby when no active room exists', async () => {
        fetchActiveRoomForHost.mockResolvedValue(null);
        checkForRoomIDDupes.mockResolvedValue(true);

        renderDashBoard();

        expect(await screen.findByText('Lobby page')).toBeInTheDocument();
        expect(setDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                hostId: 'host-uid',
                isGameActive: true,
                gameStarted: false,
                joinedUids: [],
                taskIndex: 1,
                storageReference: [],
                createdAt: 'server-timestamp-sentinel',
            })
        );
    });
});
