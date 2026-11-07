/**
 * Component test for PowerUpShopModal — the RN port of
 * src/components/shop_components/{PowerUpShopModal.js, ShopItemCard.js,
 * MysteryBoxReveal.js}. Despite the filename, this is now one of
 * GameScreen's five swipeable pages (the Clash-Royale-style redesign),
 * not a popup — no isOpen/onClose. Presentational: `purchasePowerUp`/
 * `claimMysteryReward` are injected as props (GameScreen wires them to
 * callables.purchasePowerUp/claimMysteryReward), so this file needs no
 * Firebase mocking at all. The cooldown math, the block-reason text, and
 * the mystery-box roll/resolve logic all come from the already-tested
 * src/game/{powerUps.js, powerUpEffects.js} — this suite only covers what
 * the modal itself adds: wiring, layout, and the reveal/picker flow.
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import PowerUpShopModal from './PowerUpShopModal';

const PLAYERS = [
    { name: 'Alice', isAlive: true },
    { name: 'Bob', isAlive: true },
    { name: 'Carol', isAlive: false },
];

const renderModal = async (props = {}) => {
    const purchasePowerUp = props.purchasePowerUp ?? jest.fn().mockResolvedValue({});
    const claimMysteryReward = props.claimMysteryReward ?? jest.fn().mockResolvedValue(undefined);
    const utils = await render(
        <PowerUpShopModal
            roomID="ROOM1"
            playerName="Dana"
            score={100}
            cooldowns={{}}
            players={PLAYERS}
            horcruxActive={false}
            zonesEnabled
            pendingMysteryItem={null}
            {...props}
            purchasePowerUp={purchasePowerUp}
            claimMysteryReward={claimMysteryReward}
        />
    );
    return { ...utils, purchasePowerUp, claimMysteryReward };
};

describe('PowerUpShopModal', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('shows the score header and every power-up with its cost', async () => {
        await renderModal({ score: 42 });

        expect(screen.getByText('Your points: 42')).toBeTruthy();
        expect(screen.getByText('Assassin Ping')).toBeTruthy();
        expect(screen.getByText('Mystery Box')).toBeTruthy();
        expect(
            within(screen.getByTestId('shop-item-ping-assassins')).getByText('4 pts')
        ).toBeTruthy();
    });

    it('shows the Horcrux-active badge only when horcruxActive is true', async () => {
        await renderModal({ horcruxActive: false });
        expect(screen.queryByText('🛡️ Horcrux active')).toBeNull();

        await renderModal({ horcruxActive: true });
        expect(screen.getByText('🛡️ Horcrux active')).toBeTruthy();
    });

    it("shows purchaseBlockReason's text and disables Buy when an item can't be bought", async () => {
        await renderModal({ score: 0 });

        expect(screen.getAllByText('Not enough points').length).toBeGreaterThan(0);
        const buyButtons = screen.getAllByLabelText('Buy Assassin Ping');
        expect(buyButtons[0].props.accessibilityState?.disabled).toBe(true);
    });

    it('calls purchasePowerUp with roomId/itemId/no target when buying a plain item', async () => {
        const { purchasePowerUp } = await renderModal({ score: 100 });

        await fireEvent.press(screen.getByLabelText('Buy Assassin Ping'));

        await waitFor(() =>
            expect(purchasePowerUp).toHaveBeenCalledWith({
                roomId: 'ROOM1',
                itemId: 'ping-assassins',
                targetName: undefined,
            })
        );
    });

    it('blocks a needs-target purchase with "Pick a player" until a target is chosen, then buys with it', async () => {
        const { purchasePowerUp } = await renderModal({ score: 100 });

        const card = within(screen.getByTestId('shop-item-block-camera'));
        expect(card.getByText('Pick a player')).toBeTruthy();
        const buyBlockCamera = card.getByLabelText('Buy Camera Block');
        expect(buyBlockCamera.props.accessibilityState?.disabled).toBe(true);

        // Dead players are filtered out of the picker, same as the web.
        expect(card.queryByLabelText('Carol')).toBeNull();
        await fireEvent.press(card.getByLabelText('Bob'));

        await waitFor(() => expect(buyBlockCamera.props.accessibilityState?.disabled).toBe(false));
        await fireEvent.press(buyBlockCamera);

        await waitFor(() =>
            expect(purchasePowerUp).toHaveBeenCalledWith({
                roomId: 'ROOM1',
                itemId: 'block-camera',
                targetName: 'Bob',
            })
        );
    });

    it('opens the mystery-box reveal with its label when the purchase result carries one', async () => {
        const purchasePowerUp = jest.fn().mockResolvedValue({
            mysteryBox: { label: '+5 points', needsTarget: false, resolution: { kind: 'points' } },
        });
        await renderModal({ score: 100, purchasePowerUp });

        await fireEvent.press(screen.getByLabelText('Buy Mystery Box'));

        await waitFor(() => expect(screen.getByText('+5 points')).toBeTruthy());
        expect(screen.getByText('Mystery box')).toBeTruthy();
    });

    it('claims a needs-target mystery reward from the reveal and closes it', async () => {
        const purchasePowerUp = jest.fn().mockResolvedValue({
            mysteryBox: {
                label: 'Camera Block',
                needsTarget: true,
                resolution: { kind: 'item', itemId: 'block-camera' },
            },
        });
        const claimMysteryReward = jest.fn().mockResolvedValue(undefined);
        await renderModal({ score: 100, purchasePowerUp, claimMysteryReward });

        await fireEvent.press(screen.getByLabelText('Buy Mystery Box'));
        await waitFor(() => expect(screen.getByTestId('mystery-reveal')).toBeTruthy());
        const reveal = within(screen.getByTestId('mystery-reveal'));
        expect(reveal.getByText('Camera Block')).toBeTruthy();

        expect(reveal.getByLabelText('Use').props.accessibilityState?.disabled).toBe(true);
        await fireEvent.press(reveal.getByLabelText('Bob'));
        await fireEvent.press(reveal.getByLabelText('Use'));

        await waitFor(() =>
            expect(claimMysteryReward).toHaveBeenCalledWith({ roomId: 'ROOM1', targetName: 'Bob' })
        );
        await waitFor(() => expect(screen.queryByTestId('mystery-reveal')).toBeNull());
    });

    it('shows the pending-mystery-reward banner and opens the reveal from "Pick a player"', async () => {
        await renderModal({ pendingMysteryItem: 'block-camera' });

        expect(screen.getByText('Your mystery box reward is waiting: Camera Block')).toBeTruthy();

        await fireEvent.press(screen.getByLabelText('Pick a player for your mystery reward'));

        const reveal = within(await screen.findByTestId('mystery-reveal'));
        expect(reveal.getByText('Mystery box')).toBeTruthy();
        expect(reveal.getByText('Camera Block')).toBeTruthy();
    });

    it('disables the pending-reward claim and warns when it needs zones that are off', async () => {
        await renderModal({ pendingMysteryItem: 'ping-assassins', zonesEnabled: false });

        expect(
            screen.getByText('This location reward is unavailable while zones are off.')
        ).toBeTruthy();
        const pickButton = screen.getByLabelText('Pick a player for your mystery reward');
        expect(pickButton.props.accessibilityState?.disabled).toBe(true);
    });

    it('blocks buying a zone-requiring item when zones are disabled', async () => {
        await renderModal({ zonesEnabled: false, score: 100 });

        expect(screen.getAllByText('Zones are not enabled').length).toBeGreaterThan(0);
        expect(screen.getByLabelText('Buy Assassin Ping').props.accessibilityState?.disabled).toBe(
            true
        );
    });

    it('shows a live cooldown countdown that ticks down once a second while open', async () => {
        jest.useFakeTimers();
        const future = Date.now() + 65 * 1000;
        await renderModal({
            cooldowns: { 'ping-assassins': { toMillis: () => future } },
        });

        expect(screen.getByText('1:05')).toBeTruthy();

        await act(async () => {
            jest.advanceTimersByTime(1000);
        });

        expect(screen.getByText('1:04')).toBeTruthy();
    });

    // Parity with the web/old canShop, which hid the shop entirely in
    // these three cases — not just UI tidiness: the server (loadBuyer,
    // purchasePowerUp.js) independently rejects all three regardless, so
    // this is purely about not letting the player tap into a purchase
    // that can only ever fail with a raw "[400]" error.
    it('shows a message instead of the item grid before the game has started', async () => {
        await renderModal({ gameStarted: false });
        expect(screen.getByText('The shop opens once the game starts.')).toBeTruthy();
        expect(screen.queryByTestId('shop-item-horcrux')).toBeNull();
    });

    it('shows a message instead of the item grid once the game has ended', async () => {
        await renderModal({ isGameActive: false });
        expect(screen.getByText('The shop is closed — the game has ended.')).toBeTruthy();
        expect(screen.queryByTestId('shop-item-horcrux')).toBeNull();
    });

    it("shows a message instead of the item grid once the player is eliminated", async () => {
        await renderModal({ isAlive: false });
        expect(screen.getByText("Eliminated players can't shop.")).toBeTruthy();
        expect(screen.queryByTestId('shop-item-horcrux')).toBeNull();
    });
});
