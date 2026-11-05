/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * The power-ups shop panel (POWER_UPS_SPEC.md): every item renders, the
 * player's live points show at the top, purchase rules disable Buy,
 * buying calls purchasePowerUp, cooldowns stored on the player doc show
 * as a cover, and the player picker lists only other alive players.
 * purchasePowerUp is mocked so the test can see what the panel asked for;
 * its server-side behavior is covered by
 * purchasePowerUpCallable.integration.test.js.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PowerUpShopModal from './PowerUpShopModal';
import { POWER_UPS } from '../../game/powerUps';
import { claimMysteryReward, purchasePowerUp } from '../purchasePowerUp';

jest.mock('../purchasePowerUp', () => ({
    purchasePowerUp: jest.fn(),
    claimMysteryReward: jest.fn(),
}));

const players = [
    { name: 'Me', isAlive: true },
    { name: 'Alice', isAlive: true },
    { name: 'Bob', isAlive: false },
];

const shop = (props = {}) => (
    <ChakraProvider>
        <PowerUpShopModal
            isOpen
            onClose={jest.fn()}
            roomID="room-1"
            score={100}
            players={players}
            playerName="me"
            {...props}
        />
    </ChakraProvider>
);

const renderShop = (props = {}) => render(shop(props));

describe('PowerUpShopModal', () => {
    beforeEach(() => {
        purchasePowerUp.mockResolvedValue({});
        claimMysteryReward.mockResolvedValue(undefined);
    });

    it('shows every item in the catalog', () => {
        renderShop();
        for (const item of POWER_UPS) {
            expect(screen.getByText(item.name)).toBeInTheDocument();
        }
    });

    it("shows the player's points at the top", () => {
        renderShop({ score: 12 });
        expect(screen.getByText('Your points: 12')).toBeInTheDocument();
    });

    it('updates the points shown when the score changes after a purchase', () => {
        // The server deducts the points; the new score reaches the shop as a
        // new prop from PlayerGame's live player-doc subscription.
        const { rerender } = renderShop({ score: 25 });
        rerender(shop({ score: 5 }));
        expect(screen.getByText('Your points: 5')).toBeInTheDocument();
        expect(screen.queryByText('Your points: 25')).not.toBeInTheDocument();
    });

    it('disables an item the player cannot afford', () => {
        renderShop({ score: 0 });
        expect(screen.getByRole('button', { name: 'Buy Horcrux' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Buy Mystery Box' })).toBeDisabled();
    });

    it('disables location items when zones are off', () => {
        renderShop({ zonesEnabled: false });

        for (const itemName of [
            'Assassin Ping',
            'Target Ping',
            'Global Player Ping',
            'Global Random Ping',
        ]) {
            expect(screen.getByRole('button', { name: `Buy ${itemName}` })).toBeDisabled();
        }
        expect(screen.getAllByText('Zones are not enabled')).toHaveLength(4);
        expect(screen.getByRole('button', { name: 'Buy Mystery Box' })).toBeEnabled();
    });

    it('calls purchasePowerUp when Buy is clicked', async () => {
        renderShop();

        await userEvent.click(screen.getByRole('button', { name: 'Buy Horcrux' }));

        expect(purchasePowerUp).toHaveBeenCalledWith({
            roomId: 'room-1',
            itemId: 'horcrux',
            targetName: undefined,
        });
    });

    it('disables Buy while that purchase is in flight', async () => {
        let finish;
        purchasePowerUp.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        renderShop();
        const buy = screen.getByRole('button', { name: 'Buy Horcrux' });

        await userEvent.click(buy);
        expect(buy).toBeDisabled();

        await act(async () => finish());
        expect(buy).toBeEnabled();
    });

    it('covers an item whose stored cooldown has not ended yet', () => {
        renderShop({ cooldowns: { horcrux: Date.now() + 45000 } });

        expect(screen.getByText('0:45')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Buy Horcrux' })).toBeDisabled();
    });

    it('reads a Firestore Timestamp cooldown from the player doc', () => {
        const endsAt = Date.now() + 90000;
        renderShop({ cooldowns: { 'ping-targets': { toMillis: () => endsAt } } });

        expect(screen.getByText('1:30')).toBeInTheDocument();
    });

    it('shows the error and leaves Buy enabled when the purchase fails', async () => {
        purchasePowerUp.mockRejectedValue(new Error('server said no'));
        renderShop();

        await userEvent.click(screen.getByRole('button', { name: 'Buy Horcrux' }));

        expect(await screen.findByText('server said no')).toBeInTheDocument();
        // The toast fires in `catch`, one step before `finally` re-enables Buy.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Buy Horcrux' })).toBeEnabled()
        );
    });

    it('requires picking a player for a targeted item', async () => {
        const item = POWER_UPS.find((p) => p.id === 'global-ping-picked');
        renderShop();
        const buy = screen.getByRole('button', { name: `Buy ${item.name}` });
        expect(buy).toBeDisabled();

        await userEvent.selectOptions(screen.getByLabelText(`Player for ${item.name}`), 'Alice');
        expect(buy).toBeEnabled();

        await userEvent.click(buy);
        expect(purchasePowerUp).toHaveBeenCalledWith({
            roomId: 'room-1',
            itemId: 'global-ping-picked',
            targetName: 'Alice',
        });
    });

    it('lists only other alive players in the picker', () => {
        const item = POWER_UPS.find((p) => p.id === 'block-camera');
        renderShop();
        const picker = screen.getByLabelText(`Player for ${item.name}`);

        expect(within(picker).getByRole('option', { name: 'Alice' })).toBeInTheDocument();
        // Yourself (matched case-insensitively) and dead players are excluded.
        expect(within(picker).queryByRole('option', { name: 'Me' })).not.toBeInTheDocument();
        expect(within(picker).queryByRole('option', { name: 'Bob' })).not.toBeInTheDocument();
    });

    describe('abilities', () => {
        it('shows a mystery box result on the full-screen reveal', async () => {
            purchasePowerUp.mockResolvedValue({
                mysteryBox: { label: '+5 points', needsTarget: false },
            });
            renderShop();

            await userEvent.click(screen.getByRole('button', { name: 'Buy Mystery Box' }));

            expect(await screen.findByText('+5 points')).toBeInTheDocument();
            await userEvent.click(screen.getByRole('button', { name: 'Close' }));
            await waitFor(() => expect(screen.queryByText('+5 points')).not.toBeInTheDocument());
        });

        it('claims a rolled item that needs a player on the picked player', async () => {
            purchasePowerUp.mockResolvedValue({
                mysteryBox: { label: "Block a player's camera", needsTarget: true },
            });
            renderShop();

            await userEvent.click(screen.getByRole('button', { name: 'Buy Mystery Box' }));
            await userEvent.selectOptions(
                await screen.findByLabelText('Pick a player for your reward'),
                'Alice'
            );
            await userEvent.click(screen.getByRole('button', { name: 'Use' }));

            expect(claimMysteryReward).toHaveBeenCalledWith({
                roomId: 'room-1',
                targetName: 'Alice',
            });
        });

        it('offers an unclaimed mystery reward again', async () => {
            renderShop({ pendingMysteryItem: 'global-ping-picked' });

            expect(screen.getByText(/Your mystery box reward is waiting/)).toBeInTheDocument();
            await userEvent.click(screen.getByRole('button', { name: 'Pick a player' }));

            expect(
                await screen.findByLabelText('Pick a player for your reward')
            ).toBeInTheDocument();
        });

        it('shows an active Horcrux and blocks buying another', () => {
            renderShop({ horcruxActive: true });

            expect(screen.getByText('🛡️ Horcrux active')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Buy Horcrux' })).toBeDisabled();
            expect(screen.getByText('Horcrux already active')).toBeInTheDocument();
        });
    });
});
