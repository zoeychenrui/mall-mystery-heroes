import { render, screen, fireEvent } from '@testing-library/react-native';
import BottomTabBar, { TABS } from './BottomTabBar';

describe('BottomTabBar', () => {
    it('renders all five tabs in the fixed Shop/Missions/Chat/Leaderboard/Map order', async () => {
        await render(<BottomTabBar activePage={2} onSelect={jest.fn()} />);
        expect(TABS.map((tab) => tab.label)).toEqual([
            'Shop',
            'Missions',
            'Chat',
            'Leaderboard',
            'Map',
        ]);
        TABS.forEach((tab) => {
            expect(screen.getByLabelText(tab.label)).toBeTruthy();
        });
    });

    it('marks only the active page as selected', async () => {
        await render(<BottomTabBar activePage={3} onSelect={jest.fn()} />);
        expect(screen.getByLabelText('Leaderboard').props.accessibilityState.selected).toBe(true);
        expect(screen.getByLabelText('Shop').props.accessibilityState.selected).toBe(false);
        expect(screen.getByLabelText('Missions').props.accessibilityState.selected).toBe(false);
        expect(screen.getByLabelText('Chat').props.accessibilityState.selected).toBe(false);
        expect(screen.getByLabelText('Map').props.accessibilityState.selected).toBe(false);
    });

    it('calls onSelect with the tapped tab index', async () => {
        const onSelect = jest.fn();
        await render(<BottomTabBar activePage={2} onSelect={onSelect} />);
        await fireEvent.press(screen.getByLabelText('Map'));
        expect(onSelect).toHaveBeenCalledWith(4);
    });

    it('still calls onSelect when the already-active tab is pressed', async () => {
        const onSelect = jest.fn();
        await render(<BottomTabBar activePage={2} onSelect={onSelect} />);
        await fireEvent.press(screen.getByLabelText('Chat'));
        expect(onSelect).toHaveBeenCalledWith(2);
    });
});
