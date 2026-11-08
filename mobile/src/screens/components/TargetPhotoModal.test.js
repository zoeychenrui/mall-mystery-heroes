/**
 * Component test for TargetPhotoModal — the RN port of
 * src/components/player_game/PlayerGameHeader.js's isTargetPhotoOpen modal
 * block (Task 15). Presentational, no Firebase imports of its own, so
 * nothing here needs mocking.
 *
 * @testing-library/react-native v14's render/fireEvent are async — every
 * call is awaited, same pattern as KillPhotoModal.test.js.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import TargetPhotoModal from './TargetPhotoModal';

const mountModal = (props = {}) =>
    render(
        <TargetPhotoModal
            isOpen
            onClose={jest.fn()}
            target={{ name: 'Bob', avatarUrl: 'https://example.com/bob.jpg' }}
            {...props}
        />
    );

describe('TargetPhotoModal', () => {
    it("renders the target's photo and name when avatarUrl is set", async () => {
        await mountModal({ target: { name: 'Bob', avatarUrl: 'https://example.com/bob.jpg' } });

        expect(screen.getByText('Bob')).toBeTruthy();
        expect(screen.getByLabelText("Bob's photo").props.source.uri).toBe(
            'https://example.com/bob.jpg'
        );
    });

    it('renders the no-photo message when the target has not added a photo', async () => {
        await mountModal({ target: { name: 'Carol' } });

        expect(screen.getByText('This player has not added a photo yet.')).toBeTruthy();
        expect(screen.queryByLabelText("Carol's photo")).toBeNull();
    });

    it('calls onClose when the close button is pressed', async () => {
        const onClose = jest.fn();
        await mountModal({ onClose });

        await fireEvent.press(screen.getByLabelText('Close target photo'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders nothing target-specific when target is null', async () => {
        await mountModal({ target: null });

        expect(screen.getByText('This player has not added a photo yet.')).toBeTruthy();
    });
});
