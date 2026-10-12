/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Removing a player is destructive and irreversible (a plain deleteDoc,
 * no snapshot) — this now requires confirmation via an AlertDialog,
 * matching ResetTargetsButton.js's existing pattern for the same reason
 * (docs/superpowers/specs/2026-08-17-audit-batch-a-fixes-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerRemove from './PlayerRemove';
import { removePlayerForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    removePlayerForRoom: jest.fn(),
}));

const onPlayerRemoved = jest.fn();

const mountPlayerRemove = (arrayOfPlayers = ['alice', 'bob']) =>
    render(
        <ChakraProvider>
            <PlayerRemove
                onPlayerRemoved={onPlayerRemoved}
                arrayOfPlayers={arrayOfPlayers}
                roomID="room-a"
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    removePlayerForRoom.mockResolvedValue(undefined);
});

describe('PlayerRemove', () => {
    it('shows an error and does not open the dialog when no player is selected', async () => {
        mountPlayerRemove();

        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

        expect(await screen.findByText('must select player')).toBeInTheDocument();
        expect(removePlayerForRoom).not.toHaveBeenCalled();
    });

    it('opens a confirmation dialog instead of removing immediately', async () => {
        mountPlayerRemove();

        await userEvent.selectOptions(screen.getByRole('combobox'), 'alice');
        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

        expect(screen.getByText(/remove alice/i)).toBeInTheDocument();
        expect(removePlayerForRoom).not.toHaveBeenCalled();
    });

    it('removes the player only after Confirm is clicked', async () => {
        mountPlayerRemove();

        await userEvent.selectOptions(screen.getByRole('combobox'), 'alice');
        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(removePlayerForRoom).toHaveBeenCalledWith('alice', 'room-a');
        expect(onPlayerRemoved).toHaveBeenCalledWith('alice');
    });

    it('removes nothing when Go Back is clicked', async () => {
        mountPlayerRemove();

        await userEvent.selectOptions(screen.getByRole('combobox'), 'alice');
        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
        await userEvent.click(screen.getByRole('button', { name: 'Go Back' }));

        expect(removePlayerForRoom).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.queryByText(/remove alice/i)).not.toBeInTheDocument();
        });
    });
});
