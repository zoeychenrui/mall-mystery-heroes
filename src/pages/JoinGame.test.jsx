/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the join form: successful join (guest auth fires invisibly,
 * session persisted, navigates to the waiting screen) and each error path
 * joinRoom's Cloud Function can throw
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md),
 * plus the reconnect fallback that kicks in specifically when joinRoom
 * rejects with "This game has already started." — `joinRoom` and
 * `requestReconnect` are both thin Cloud Function wrappers, so both are
 * mocked directly rather than any Firestore call underneath them
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 * Explicit mock factories for 'firebase/auth', '../utils/firebase',
 * '../components/joinRoom', and '../components/requestReconnect' — see
 * RequireAuth.test.jsx for why. playerSession is left unmocked: it touches
 * only real jsdom localStorage, not Firebase.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import JoinGame from './JoinGame';
import { joinRoom } from '../components/joinRoom';
import { requestReconnect } from '../components/requestReconnect';
import { readPlayerSession } from '../utils/playerSession';
import { auth } from '../utils/firebase';

jest.mock('firebase/auth', () => ({
    signInAnonymously: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));
jest.mock('../components/joinRoom', () => ({ joinRoom: jest.fn() }));
jest.mock('../components/requestReconnect', () => ({ requestReconnect: jest.fn() }));

const renderJoinGame = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/join']}>
                <Routes>
                    <Route path="/join" element={<JoinGame />} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                    <Route
                        path="/rooms/:roomID/reconnecting/:requestId"
                        element={<div>Reconnecting page</div>}
                    />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

const fillAndSubmit = async (gameId, playerName) => {
    await userEvent.type(screen.getByPlaceholderText('Game ID'), gameId);
    await userEvent.type(screen.getByPlaceholderText('Your name'), playerName);
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    signInAnonymously.mockResolvedValue({ user: { uid: 'guest-uid' } });
    auth.currentUser = null;
});

describe('JoinGame', () => {
    it('joins and navigates to the waiting screen on success', async () => {
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(joinRoom).toHaveBeenCalledWith('FLUFFY42317', 'Alice');
        expect(readPlayerSession()).toEqual({ roomID: 'FLUFFY42317', playerName: 'Alice' });
    });

    it('does not call signInAnonymously when a GM is already signed in, but still joins', async () => {
        auth.currentUser = { uid: 'host-uid' };
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(signInAnonymously).not.toHaveBeenCalled();
        expect(joinRoom).toHaveBeenCalledWith('FLUFFY42317', 'Alice');
    });

    it('trims whitespace from the game ID before joining', async () => {
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('  Fluffy42317  ', 'Alice');

        await screen.findByText('Waiting page');
        expect(joinRoom).toHaveBeenCalledWith('FLUFFY42317', 'Alice');
    });

    it('shows an inline error and does not navigate when the room does not exist', async () => {
        joinRoom.mockRejectedValue(new Error('Room not found: Nope99999'));
        renderJoinGame();

        await fillAndSubmit('Nope99999', 'Alice');

        expect(await screen.findByText('Room not found: Nope99999')).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });

    it('shows an inline error when the room is no longer active', async () => {
        joinRoom.mockRejectedValue(new Error('This room is no longer active.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('This room is no longer active.')).toBeInTheDocument();
    });

    it('shows an inline error when the name is already taken', async () => {
        joinRoom.mockRejectedValue(new Error('Alice is already taken in this room.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Alice is already taken in this room.')).toBeInTheDocument();
    });

    it('limits the name input to 40 characters', () => {
        renderJoinGame();

        expect(screen.getByPlaceholderText('Your name')).toHaveAttribute('maxlength', '40');
    });

    it('shows the game ID in uppercase as it is typed, not just at submit', async () => {
        renderJoinGame();

        await userEvent.type(screen.getByPlaceholderText('Game ID'), 'wxkr');

        expect(screen.getByPlaceholderText('Game ID')).toHaveValue('WXKR');
    });
});

describe('the reconnect fallback', () => {
    it('requests a reconnect and navigates to the reconnecting route when joinRoom says the game already started', async () => {
        joinRoom.mockRejectedValue(new Error('This game has already started.'));
        requestReconnect.mockResolvedValue({ requestId: 'request-1' });
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        await waitFor(() => expect(requestReconnect).toHaveBeenCalledWith('FLUFFY42317', 'Alice'));
        expect(await screen.findByText('Reconnecting page')).toBeInTheDocument();
    });

    it('surfaces any other joinRoom error normally, without calling requestReconnect', async () => {
        joinRoom.mockRejectedValue(new Error('Fluffy42317 is already taken in this room.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(
            await screen.findByText('Fluffy42317 is already taken in this room.')
        ).toBeInTheDocument();
        expect(requestReconnect).not.toHaveBeenCalled();
    });

    it("surfaces requestReconnect's own rejection as the visible error", async () => {
        joinRoom.mockRejectedValue(new Error('This game has already started.'));
        requestReconnect.mockRejectedValue(new Error('No player named Alice in this room.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('No player named Alice in this room.')).toBeInTheDocument();
    });
});
