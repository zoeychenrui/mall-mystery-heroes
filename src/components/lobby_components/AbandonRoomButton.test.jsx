/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Abandoning a room is the Lobby-phase counterpart to Endgamebutton.js —
 * the only way to leave a room that hasn't started yet used to be Start
 * Game then End Game, since Endgamebutton only renders once the game has
 * actually started. This reuses the exact same generic endGame write, but
 * skips Endgamebutton's player-facing "please head back"/leaderboard
 * announcements entirely, since nobody has played anything yet
 * (docs/superpowers/specs/2026-08-08-dashboard-removal-design.md covers
 * the returning-host redirect this button's navigate('/dashboard') feeds
 * into afterward).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AbandonRoomButton from './AbandonRoomButton';
import { endGame } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    endGame: jest.fn(),
}));

const mountAbandonRoomButton = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/lobby']}>
                <Routes>
                    <Route
                        path="/rooms/:roomID/lobby"
                        element={<AbandonRoomButton roomID="room-a" />}
                    />
                    <Route path="/dashboard" element={<div>Dashboard page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    endGame.mockResolvedValue(undefined);
});

describe('AbandonRoomButton', () => {
    it('opens a confirmation dialog instead of abandoning immediately', async () => {
        mountAbandonRoomButton();

        await userEvent.click(screen.getByRole('button', { name: 'Abandon Room' }));

        expect(screen.getByText(/abandon this room/i)).toBeInTheDocument();
        expect(endGame).not.toHaveBeenCalled();
    });

    it('calls endGame and navigates to the dashboard only after Confirm is clicked', async () => {
        mountAbandonRoomButton();

        await userEvent.click(screen.getByRole('button', { name: 'Abandon Room' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(endGame).toHaveBeenCalledWith('room-a');
        expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
    });

    it('abandons nothing when Go Back is clicked', async () => {
        mountAbandonRoomButton();

        await userEvent.click(screen.getByRole('button', { name: 'Abandon Room' }));
        await userEvent.click(screen.getByRole('button', { name: 'Go Back' }));

        expect(endGame).not.toHaveBeenCalled();
        expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
    });

    it('shows an error and does not navigate when endGame is rejected', async () => {
        endGame.mockRejectedValue(new Error('Room not found: room-a'));
        mountAbandonRoomButton();

        await userEvent.click(screen.getByRole('button', { name: 'Abandon Room' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(await screen.findByText('Room not found: room-a')).toBeInTheDocument();
        expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
    });
});
