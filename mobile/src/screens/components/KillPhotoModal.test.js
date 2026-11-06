/**
 * Component test for KillPhotoModal — the RN port of
 * src/components/player_messages_components/KillPhotoModal.js. Presentational,
 * no Firebase imports of its own, so nothing here needs mocking — only
 * `buildPhotoClaimOptions` (src/game/photoClaimOptions.js, pure, Metro-shared
 * per Task 2) is exercised for real.
 *
 * Mirrors the web version's current behavior exactly: zero real
 * (target/mission) options still leaves Submit enabled, defaulted to the
 * always-present 'fun' option, with an explanatory message instead of a
 * picker; one or more real options render a grouped picker (Kill Target /
 * Mission / Socials) that defaults to the first real option.
 *
 * @testing-library/react-native v14's render/fireEvent are async — every
 * call is awaited, same pattern as ChatComposer.test.js/ChatFeed.test.js.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import KillPhotoModal from './KillPhotoModal';

const mountModal = (props = {}) =>
    render(
        <KillPhotoModal
            isOpen={true}
            onClose={jest.fn()}
            previewUrl="file://preview.jpg"
            error={null}
            onSubmit={jest.fn()}
            players={[{ name: 'alice', targets: ['bob'], isAlive: true, openSeason: false }]}
            missions={[]}
            playerName="alice"
            {...props}
        />
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('KillPhotoModal', () => {
    it('shows the no-options message and still enables Submit when there are no real options', async () => {
        const onSubmit = jest.fn();
        await mountModal({
            players: [{ name: 'alice', targets: [], isAlive: true, openSeason: false }],
            onSubmit,
        });

        expect(
            screen.getByText('No open targets or missions; this will be a fun photo.')
        ).toBeTruthy();
        expect(screen.queryByText('bob')).toBeNull();

        await fireEvent.press(screen.getByLabelText('Submit'));

        expect(onSubmit).toHaveBeenCalledWith('fun');
    });

    it('renders a grouped picker with the always-present fun option, defaulting to the first real option', async () => {
        const onSubmit = jest.fn();
        await mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
            missions: [
                {
                    taskIndex: 1,
                    title: 'Find the clue',
                    taskType: 'Task',
                    isComplete: false,
                    completedBy: [],
                },
            ],
            onSubmit,
        });

        expect(screen.getByText('Kill Target')).toBeTruthy();
        expect(screen.getByText('bob')).toBeTruthy();
        expect(screen.getByText('carol')).toBeTruthy();
        expect(screen.getByText('Mission')).toBeTruthy();
        expect(screen.getByText('Find the clue')).toBeTruthy();
        expect(screen.getByText('Socials')).toBeTruthy();
        expect(screen.getByText('Just for fun')).toBeTruthy();

        // Defaults to the first real option (bob) without any selection.
        await fireEvent.press(screen.getByLabelText('Submit'));
        expect(onSubmit).toHaveBeenCalledWith('target:bob');
    });

    it('lets the player pick a different real option before submitting', async () => {
        const onSubmit = jest.fn();
        await mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
            onSubmit,
        });

        await fireEvent.press(screen.getByLabelText('carol'));
        await fireEvent.press(screen.getByLabelText('Submit'));

        expect(onSubmit).toHaveBeenCalledWith('target:carol');
    });

    it('lets the player explicitly switch to the fun option even when real options exist', async () => {
        const onSubmit = jest.fn();
        await mountModal({
            players: [{ name: 'alice', targets: ['bob'], isAlive: true, openSeason: false }],
            onSubmit,
        });

        await fireEvent.press(screen.getByLabelText('Just for fun'));
        await fireEvent.press(screen.getByLabelText('Submit'));

        expect(onSubmit).toHaveBeenCalledWith('fun');
    });

    it('disables Submit while previewUrl has not arrived yet, even with a resolved option', async () => {
        await mountModal({ previewUrl: null });

        expect(screen.getByLabelText('Submit').props.accessibilityState.disabled).toBe(true);
    });

    it('shows the error message and no preview image when error is set', async () => {
        await mountModal({
            previewUrl: null,
            error: 'Could not read that photo. Try taking it again.',
        });

        expect(
            screen.getByText('Could not read that photo. Try taking it again.')
        ).toBeTruthy();
        expect(screen.queryByLabelText('Kill photo preview')).toBeNull();
    });

    it('calls onClose when Close is pressed', async () => {
        const onClose = jest.fn();
        await mountModal({ onClose });

        await fireEvent.press(screen.getByLabelText('Close'));

        expect(onClose).toHaveBeenCalled();
    });

    it('resets the selection back to the default every time the modal reopens', async () => {
        const onSubmit = jest.fn();
        const { rerender } = await mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
            onSubmit,
            isOpen: true,
        });

        await fireEvent.press(screen.getByLabelText('carol'));

        await rerender(
            <KillPhotoModal
                isOpen={false}
                onClose={jest.fn()}
                previewUrl="file://preview.jpg"
                error={null}
                onSubmit={onSubmit}
                players={[
                    { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
                ]}
                missions={[]}
                playerName="alice"
            />
        );
        await rerender(
            <KillPhotoModal
                isOpen={true}
                onClose={jest.fn()}
                previewUrl="file://preview.jpg"
                error={null}
                onSubmit={onSubmit}
                players={[
                    { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
                ]}
                missions={[]}
                playerName="alice"
            />
        );

        await fireEvent.press(screen.getByLabelText('Submit'));
        expect(onSubmit).toHaveBeenCalledWith('target:bob');
    });
});
