/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers Lobby's player roster: a live subscription, not a one-time fetch
 * (docs/improvements.md item 13 extended here from GameMasterView, which
 * this covers) — a player who joins from another device (e.g. self-join via
 * /join) now shows up without the GM reloading the page. Also covers the
 * single-column layout's new "Game ID" heading (previously "Lobby ID"),
 * Log Out, and Start Game/Remove Player still being present after the
 * 2026-08-14 simplified-lobby redesign
 * (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md), which
 * dropped the manual "Add Player" form entirely.
 *
 * TargetGenerator/PlayerRemove are exercised for real (not stubbed) since
 * neither does anything on mount that touches Firebase — they only act on
 * user interaction, which this file never triggers. Both import from
 * dbCalls.js, so the explicit mock factory below covers every function
 * either needs, the same reasoning as every other dbCalls mock in this
 * repo (see ChatInput.test.jsx).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import Lobby from './Lobby';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

// GameBoundaryButton pulls in BoundaryEditorModal, which imports
// publishGameBoundary/disableGameBoundary, which import 'firebase/functions'
// directly — that touches `fetch` (undefined in jsdom) at module-load time,
// same reason utils/firebase is stubbed above. The modal has its own
// thorough tests; stubbing it here keeps this file's concern to whether
// Lobby renders GameBoundaryButton with the right props, same reasoning as
// GameBoundaryButton.test.jsx's own stub of this module.
jest.mock('../components/map_components/BoundaryEditorModal', () => () => null);

// Lobby renders AbandonRoomButton, which now imports endGame from its own
// module (src/components/endGame.js) rather than dbCalls.js — that module
// calls httpsCallable from 'firebase/functions' at import time, which
// touches `fetch` (undefined in jsdom), same class of problem as the
// BoundaryEditorModal mock above.
jest.mock('../components/endGame', () => ({ endGame: jest.fn() }));

jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchAllPlayersQueryForRoom: jest.fn(() => 'players-query'),
    fetchRoomReferenceForRoom: jest.fn(() => 'room-ref'),
    removePlayerForRoom: jest.fn(),
    addLogForRoom: jest.fn(),
    markGameAsStarted: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));

const asPlayerDocs = (names) => names.map((name) => ({ data: () => ({ name }) }));

// PlayerRemove's <select> also renders each player's name as an <option>,
// so a bare getByText('Alice') is ambiguous (matches both the roster list
// item and the dropdown option) — scope to listitem role to read only the
// roster PlayerList actually renders.
const rosterNames = () => screen.getAllByRole('listitem').map((item) => item.textContent);

const mountLobby = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/lobby']}>
                <Routes>
                    <Route path="/rooms/:roomID/lobby" element={<Lobby />} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the player roster is a live subscription, not a one-time fetch', () => {
    it('shows players from the subscribed snapshot on mount', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                onNext({ docs: asPlayerDocs(['Alice', 'Bob']) });
            }
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    });

    it('shows a player who joins from another device without a reload', () => {
        let deliverPlayers;
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                deliverPlayers = onNext;
                onNext({ docs: asPlayerDocs(['Alice']) });
            }
            return () => {};
        });

        mountLobby();
        expect(screen.getByText('Players (1)')).toBeInTheDocument();

        // Simulates a player self-joining from a second device/tab — the
        // point of a live subscription is this needs no reload to show up.
        act(() => {
            deliverPlayers({ docs: asPlayerDocs(['Alice', 'Carol']) });
        });

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Carol']));
    });

    it('surfaces a subscription error instead of leaving the roster silently empty', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext, onError) => {
            // The room-doc subscription (added for gameBoundary) passes no
            // onError handler, unlike the players-query subscription this
            // test targets — only call onError for the latter, or this mock
            // crashes on the room-ref call with "onError is not a function".
            if (queryOrRef === 'room-ref') {
                return () => {};
            }
            onError(new Error('boom'));
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (0)')).toBeInTheDocument();
        expect(screen.getByText('Error updating arrayOfPlayers')).toBeInTheDocument();
    });
});

describe('the simplified layout', () => {
    it('shows the game ID instead of the old "Lobby ID" label', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Game ID: room-a')).toBeInTheDocument();
        expect(screen.queryByText(/Lobby ID/)).not.toBeInTheDocument();
    });

    it('has no manual "Add Player" form', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountLobby();

        expect(screen.queryByPlaceholderText('Enter Player Name')).not.toBeInTheDocument();
        expect(screen.queryByText('Add Player')).not.toBeInTheDocument();
    });

    it('still shows Start Game and, once players exist, Remove Player', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                onNext({ docs: asPlayerDocs(['Alice', 'Bob']) });
            }
            return () => {};
        });

        mountLobby();

        expect(screen.getByRole('button', { name: 'Begin Game' })).toBeInTheDocument();
        expect(screen.getByText('Select player to remove')).toBeInTheDocument();
    });

    it('always shows Abandon Room, even with no players joined yet', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountLobby();

        expect(screen.getByRole('button', { name: 'Abandon Room' })).toBeInTheDocument();
    });

    it('logs out when Log Out is clicked', async () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: undefined }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });
        signOut.mockResolvedValue();

        mountLobby();

        await act(async () => {
            screen.getByRole('button', { name: 'Log Out' }).click();
        });

        expect(signOut).toHaveBeenCalled();
    });

    it('shows Set Game Area, and Edit Game Area once a boundary exists', () => {
        onSnapshot.mockImplementation((queryOrRef, onNext) => {
            if (queryOrRef === 'room-ref') {
                onNext({ data: () => ({ gameBoundary: { enabled: true, revision: 1 } }) });
            } else {
                onNext({ docs: [] });
            }
            return () => {};
        });

        mountLobby();

        expect(screen.getByRole('button', { name: 'Edit Game Area' })).toBeInTheDocument();
    });
});
