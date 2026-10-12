/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 10: `endGame` now throws on failure
 * rather than swallowing, and this button used to fire-and-forget the call
 * then navigate away unconditionally — a failure was invisible and the GM
 * would land on /dashboard believing the game had ended when it hadn't.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Endgamebutton from './Endgamebutton';
import { gameContext } from '../Contexts';
import {
    endGame,
    fetchAllPlayersDataForRoom,
    addPlayerMessageForRoom,
} from '../firebase_calls/dbCalls';

const mockNavigate = jest.fn();

jest.mock('../firebase_calls/dbCalls', () => ({
    endGame: jest.fn(),
    fetchAllPlayersDataForRoom: jest.fn(),
    addPlayerMessageForRoom: jest.fn(),
}));
jest.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

const mountEndgamebutton = () =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <Endgamebutton />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    endGame.mockResolvedValue(undefined);
    fetchAllPlayersDataForRoom.mockResolvedValue([
        { name: 'Alice', score: 20, isAlive: true },
        { name: 'Bob', score: 30, isAlive: false },
    ]);
    addPlayerMessageForRoom.mockResolvedValue(undefined);
});

const confirmEndGame = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'End Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm End Game' }));
};

describe('Endgamebutton (improvements item 10)', () => {
    it('navigates to /dashboard once endGame resolves', async () => {
        mountEndgamebutton();

        await confirmEndGame();

        expect(endGame).toHaveBeenCalledWith('room-a');
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
    });

    it('shows an alert and does not navigate when endGame rejects', async () => {
        endGame.mockRejectedValue(new Error('network down'));
        mountEndgamebutton();

        await confirmEndGame();

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});

describe('game-end broadcasts (pinned come-back message + top-3 leaderboard)', () => {
    it('posts the pinned come-back message and the leaderboard broadcast, in that order', async () => {
        mountEndgamebutton();

        await confirmEndGame();

        await waitFor(() => expect(addPlayerMessageForRoom).toHaveBeenCalledTimes(2));
        expect(addPlayerMessageForRoom).toHaveBeenNthCalledWith(
            1,
            {
                type: 'gameEnded',
                recipient: null,
                text: 'Please head back to the starting area.',
                standings: null,
            },
            'room-a'
        );
        expect(addPlayerMessageForRoom).toHaveBeenNthCalledWith(
            2,
            {
                type: 'gameEndedLeaderboard',
                recipient: null,
                text: null,
                standings: [
                    { name: 'Bob', score: 30, isAlive: false },
                    { name: 'Alice', score: 20, isAlive: true },
                ],
            },
            'room-a'
        );
    });

    it('still navigates even if posting the broadcasts fails, since the game already ended', async () => {
        fetchAllPlayersDataForRoom.mockRejectedValue(new Error('network error'));
        mountEndgamebutton();

        await confirmEndGame();

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
    });
});
