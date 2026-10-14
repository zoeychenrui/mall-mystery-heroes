/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * The mystery box's full-screen result display (POWER_UPS_SPEC.md): the
 * reward centered with Close beneath it, plus a player picker when the
 * rolled item needs a target.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MysteryBoxReveal from './MysteryBoxReveal';

const renderReveal = (props = {}) =>
    render(
        <ChakraProvider>
            <MysteryBoxReveal
                isOpen
                label="+5 points"
                needsTarget={false}
                pickablePlayers={[{ name: 'Bob' }, { name: 'Carol' }]}
                onClaim={jest.fn()}
                onClose={jest.fn()}
                {...props}
            />
        </ChakraProvider>
    );

describe('MysteryBoxReveal', () => {
    it('shows the reward with a Close button that closes it', async () => {
        const onClose = jest.fn();
        renderReveal({ onClose });

        expect(screen.getByText('+5 points')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows no picker for a reward that needs no player', () => {
        renderReveal();
        expect(screen.queryByLabelText('Pick a player for your reward')).not.toBeInTheDocument();
    });

    it('asks for a player when the reward needs one, and uses it on them', async () => {
        const onClaim = jest.fn().mockResolvedValue(undefined);
        renderReveal({ label: "Block a player's camera", needsTarget: true, onClaim });

        const use = screen.getByRole('button', { name: 'Use' });
        expect(use).toBeDisabled();

        await userEvent.selectOptions(
            screen.getByLabelText('Pick a player for your reward'),
            'Carol'
        );
        await userEvent.click(use);

        expect(onClaim).toHaveBeenCalledWith('Carol');
    });

    it('shows the error and stays open when using it fails', async () => {
        const onClaim = jest.fn().mockRejectedValue(new Error('Pick another alive player'));
        const onClose = jest.fn();
        renderReveal({ label: 'Global ping', needsTarget: true, onClaim, onClose });

        await userEvent.selectOptions(
            screen.getByLabelText('Pick a player for your reward'),
            'Bob'
        );
        await userEvent.click(screen.getByRole('button', { name: 'Use' }));

        expect(await screen.findByText('Pick another alive player')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Use' })).toBeEnabled());
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders nothing when closed', () => {
        renderReveal({ isOpen: false });
        expect(screen.queryByText('+5 points')).not.toBeInTheDocument();
    });
});
