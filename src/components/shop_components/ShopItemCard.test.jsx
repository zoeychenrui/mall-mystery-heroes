import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopItemCard from './ShopItemCard';
import { POWER_UPS } from '../../game/powerUps';

const horcrux = POWER_UPS.find((p) => p.id === 'horcrux');

const renderCard = (props = {}) =>
    render(
        <ChakraProvider>
            <ShopItemCard
                item={horcrux}
                secondsLeft={0}
                fractionLeft={0}
                disabledReason={null}
                onBuy={jest.fn()}
                {...props}
            />
        </ChakraProvider>
    );

describe('ShopItemCard', () => {
    it('shows the name, cost, and cooldown length', () => {
        renderCard();
        expect(screen.getByText('Horcrux')).toBeInTheDocument();
        expect(screen.getByText(/20 pts/)).toBeInTheDocument();
        expect(screen.getByText(/6:00/)).toBeInTheDocument();
    });

    it('calls onBuy when Buy is clicked', async () => {
        const onBuy = jest.fn();
        renderCard({ onBuy });
        await userEvent.click(screen.getByRole('button', { name: 'Buy Horcrux' }));
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('disables buy button for not enough points', () => {
        const disabledReason = 'Not enough points';
        renderCard({ disabledReason });
        expect(screen.getByRole('button', { name: 'Buy Horcrux' })).toBeDisabled();
        expect(screen.getByText('Not enough points')).toBeInTheDocument();
    });

    it('disables a click, causing it to do nothing', async () => {
        const onBuy = jest.fn();
        renderCard({ disabledReason: 'Not enough points', onBuy });
        await userEvent.click(screen.getByRole('button', { name: 'Buy Horcrux' }));
        expect(onBuy).not.toHaveBeenCalled();
    });

    it('displays time remaining in the proper way', () => {
        const secondsLeft = 45;
        const fractionLeft = 0.5;
        renderCard({ secondsLeft, fractionLeft });
        expect(screen.getByText('0:45')).toBeInTheDocument();
    });

    it('removes countdown once CD is up', () => {
        renderCard();
        expect(screen.queryByText('0:00')).not.toBeInTheDocument();
    });
});
