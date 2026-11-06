/**
 * Component test for ChatComposer — the RN port of
 * src/components/player_messages_components/MessageComposer.js. Covers both
 * the text-sending logic (Task 9) and the camera capture/compress/submit
 * flow (Task 10) added alongside it.
 *
 * Firebase-touching imports are mocked ('../../firebase/callables' and
 * '../../firebase/storageCalls'), same pattern as JoinScreen.test.js /
 * GameScreen.test.js. 'expo-image-picker' and 'expo-image-manipulator' are
 * also mocked — their real native modules don't exist under Jest (jest-expo
 * ships automatic mocks for them, but the capture flow's actual *values*
 * need per-test control, so each test drives them explicitly). `KillPhotoModal`
 * itself is not mocked — it has no Firebase imports of its own, same reason
 * the web's `MessageComposer.test.jsx` renders its own `KillPhotoModal` for
 * real.
 *
 * @testing-library/react-native v14's render/fireEvent are async — every
 * call is awaited.
 */
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as callables from '../../firebase/callables';
import * as storageCalls from '../../firebase/storageCalls';
import ChatComposer from './ChatComposer';

jest.mock('../../firebase/callables', () => ({
    submitChatMessage: jest.fn(),
    submitKillPhoto: jest.fn(),
}));
jest.mock('../../firebase/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));
jest.mock('expo-image-picker', () => ({
    launchCameraAsync: jest.fn(),
    MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('expo-image-manipulator', () => ({
    manipulateAsync: jest.fn(),
    SaveFormat: { JPEG: 'jpeg' },
}));

const CAPTURED_URI = 'file://captured-original.jpg';
const MANIPULATED_URI = 'file://captured-manipulated.jpg';
const fakeBlob = { __fake: 'blob' };

beforeEach(() => {
    jest.clearAllMocks();
    callables.submitChatMessage.mockResolvedValue(undefined);
    callables.submitKillPhoto.mockResolvedValue(undefined);
    storageCalls.uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    // A landscape asset (width > height, both already under MAX_DIMENSION)
    // by default, so scale is 1 and the resize call's width/height equal
    // the asset's own — the portrait/over-sized case is covered by its own
    // test below.
    ImagePicker.launchCameraAsync.mockResolvedValue({
        canceled: false,
        assets: [{ uri: CAPTURED_URI, width: 1200, height: 900 }],
    });
    ImageManipulator.manipulateAsync.mockResolvedValue({ uri: MANIPULATED_URI });
    global.fetch = jest.fn(() => Promise.resolve({ blob: () => Promise.resolve(fakeBlob) }));
});

const mountComposer = (props = {}) =>
    render(
        <ChatComposer
            roomID="room-a"
            playerName="Alice"
            onOptimisticSend={jest.fn()}
            onOptimisticSendFailed={jest.fn()}
            {...props}
        />
    );

describe('ChatComposer', () => {
    it('renders an enabled message input and Send button', async () => {
        await mountComposer();

        expect(screen.getByPlaceholderText('Type a message...').props.editable).toBe(true);
        expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(false);
    });

    it('sends the typed message, trimmed, when Send is pressed', async () => {
        await mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, '  hey where are you  ');
        await fireEvent.press(screen.getByLabelText('Send'));

        await waitFor(() =>
            expect(callables.submitChatMessage).toHaveBeenCalledWith({
                roomId: 'room-a',
                text: 'hey where are you',
            })
        );
    });

    it('sends the typed message when the keyboard submit (Enter) fires', async () => {
        await mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, 'hi');
        await fireEvent(input, 'submitEditing');

        await waitFor(() =>
            expect(callables.submitChatMessage).toHaveBeenCalledWith({
                roomId: 'room-a',
                text: 'hi',
            })
        );
    });

    it('does not send a blank or whitespace-only message', async () => {
        await mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, '   ');
        await fireEvent.press(screen.getByLabelText('Send'));

        expect(callables.submitChatMessage).not.toHaveBeenCalled();
    });

    it('clears the input immediately after sending', async () => {
        await mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, 'hi');
        await fireEvent.press(screen.getByLabelText('Send'));

        expect(input.props.value).toBe('');
        await waitFor(() => expect(callables.submitChatMessage).toHaveBeenCalled());
    });

    it('calls onOptimisticSend with the pending message before submitChatMessage resolves', async () => {
        let resolveSend;
        callables.submitChatMessage.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSend = resolve;
                })
        );
        const onOptimisticSend = jest.fn();
        await mountComposer({ onOptimisticSend });
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, 'hi');
        // Not awaited: fireEvent.press awaits an async onPress handler to
        // completion (RNTL v14), and handleSend's own await on
        // submitChatMessage is deliberately left pending here — awaiting
        // this call directly would hang until resolveSend() below runs.
        const pressPromise = fireEvent.press(screen.getByLabelText('Send'));

        await waitFor(() => expect(onOptimisticSend).toHaveBeenCalled());
        expect(onOptimisticSend).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'chat',
                recipient: null,
                text: 'hi',
                sender: 'Alice',
                timestamp: null,
            })
        );
        expect(typeof onOptimisticSend.mock.calls[0][0].id).toBe('string');
        resolveSend();
        await pressPromise;
    });

    it('restores the typed text and calls onOptimisticSendFailed when the send fails', async () => {
        callables.submitChatMessage.mockRejectedValue(new Error('network error'));
        const onOptimisticSend = jest.fn();
        const onOptimisticSendFailed = jest.fn();
        await mountComposer({ onOptimisticSend, onOptimisticSendFailed });
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, 'hi');
        await fireEvent.press(screen.getByLabelText('Send'));

        await waitFor(() => expect(input.props.value).toBe('hi'));
        const reportedId = onOptimisticSend.mock.calls[0][0].id;
        expect(onOptimisticSendFailed).toHaveBeenCalledWith(reportedId);
    });

    it('disables the input and Send button when playerName is empty', async () => {
        await mountComposer({ playerName: '' });

        expect(screen.getByPlaceholderText('Type a message...').props.editable).toBe(false);
        expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(true);
    });

    it('does not send when playerName is empty, even if Send is pressed', async () => {
        await mountComposer({ playerName: '' });
        const input = screen.getByPlaceholderText('Type a message...');

        await fireEvent.changeText(input, 'hi');
        await fireEvent.press(screen.getByLabelText('Send'));

        expect(callables.submitChatMessage).not.toHaveBeenCalled();
    });

    it('limits the chat message input to 500 characters', async () => {
        await mountComposer();

        expect(screen.getByPlaceholderText('Type a message...').props.maxLength).toBe(500);
    });

    describe('camera capture flow', () => {
        it('renders an enabled camera button by default (locationEnabled defaults to true)', async () => {
            await mountComposer();

            expect(screen.getByLabelText('Send photo').props.accessibilityState.disabled).toBe(
                false
            );
        });

        it('disables and relabels the camera button when locationEnabled is false', async () => {
            await mountComposer({ locationEnabled: false });

            expect(
                screen.getByLabelText('Send photo (enable location first)').props
                    .accessibilityState.disabled
            ).toBe(true);
        });

        it('disables and relabels the camera button while blocked', async () => {
            await mountComposer({ cameraBlockedUntil: Date.now() + 30000 });

            expect(
                screen.getByLabelText('Send photo (camera blocked)').props.accessibilityState
                    .disabled
            ).toBe(true);
        });

        it('ignores a camera block that has already ended', async () => {
            await mountComposer({ cameraBlockedUntil: Date.now() - 1000 });

            expect(screen.getByLabelText('Send photo').props.accessibilityState.disabled).toBe(
                false
            );
        });

        it('disables the camera button once the game has ended', async () => {
            await mountComposer({ isGameActive: false });

            expect(screen.getByLabelText('Send photo').props.accessibilityState.disabled).toBe(
                true
            );
        });

        it('disables the camera button when playerName is empty', async () => {
            await mountComposer({ playerName: '' });

            expect(screen.getByLabelText('Send photo').props.accessibilityState.disabled).toBe(
                true
            );
        });

        it('captures and manipulates a photo, then opens the modal with the manipulated preview', async () => {
            await mountComposer();

            await fireEvent.press(screen.getByLabelText('Send photo'));

            expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({
                mediaTypes: 'Images',
            });
            // The default mocked asset (1200x900, landscape, already under
            // MAX_DIMENSION) scales by 1 — width/height pass through
            // unchanged, both computed, not width alone.
            expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
                CAPTURED_URI,
                [{ resize: { width: 1200, height: 900 } }],
                { compress: 0.8, format: 'jpeg' }
            );
            expect(screen.getByLabelText('Kill photo preview').props.source.uri).toBe(
                MANIPULATED_URI
            );
        });

        it('caps the longer side for a portrait photo, matching compressImage.js', async () => {
            // height > width (camera held vertically) and over MAX_DIMENSION
            // on its long side — resizing by width alone (the bug the
            // review caught) would leave height at 2000, uncapped.
            // scale = 1600 / 2000 = 0.8 → width 900*0.8=720, height
            // 2000*0.8=1600 (the long side lands exactly on MAX_DIMENSION).
            ImagePicker.launchCameraAsync.mockResolvedValue({
                canceled: false,
                assets: [{ uri: CAPTURED_URI, width: 900, height: 2000 }],
            });
            await mountComposer();

            await fireEvent.press(screen.getByLabelText('Send photo'));

            expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
                CAPTURED_URI,
                [{ resize: { width: 720, height: 1600 } }],
                { compress: 0.8, format: 'jpeg' }
            );
        });

        it('does nothing when the camera capture is canceled', async () => {
            ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
            await mountComposer();

            await fireEvent.press(screen.getByLabelText('Send photo'));

            expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
            expect(screen.queryByLabelText('Submit')).toBeNull();
        });

        it('opens the modal with an error, not a preview, when capture/manipulation fails', async () => {
            ImageManipulator.manipulateAsync.mockRejectedValue(new Error('bad file'));
            await mountComposer();

            await fireEvent.press(screen.getByLabelText('Send photo'));

            expect(
                screen.getByText('Could not read that photo. Try taking it again.')
            ).toBeTruthy();
            expect(screen.queryByLabelText('Kill photo preview')).toBeNull();
        });

        it('compresses a captured photo before uploading it', async () => {
            await mountComposer({
                players: [{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            await fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() => expect(storageCalls.uploadKillPhoto).toHaveBeenCalled());
            // The Blob is built from the MANIPULATED uri, not the original
            // capture — fetch is only ever called with the manipulated uri.
            expect(global.fetch).toHaveBeenCalledWith(MANIPULATED_URI);
            expect(global.fetch).not.toHaveBeenCalledWith(CAPTURED_URI);
            expect(storageCalls.uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        });

        it('submits the resolved target claim, split into target/mission fields', async () => {
            await mountComposer({
                players: [{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            await fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() =>
                expect(callables.submitKillPhoto).toHaveBeenCalledWith({
                    roomId: 'room-a',
                    url: 'https://example.com/photo.jpg',
                    target: 'bob',
                    mission: null,
                    isFunPhoto: false,
                })
            );
        });

        it('submits a mission claim, split into target/mission fields, when that is the only open option', async () => {
            await mountComposer({
                players: [{ name: 'Alice', targets: [], isAlive: true, openSeason: false }],
                missions: [
                    {
                        taskIndex: 3,
                        title: 'Find the clue',
                        taskType: 'Task',
                        isComplete: false,
                        completedBy: [],
                    },
                ],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            await fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() =>
                expect(callables.submitKillPhoto).toHaveBeenCalledWith({
                    roomId: 'room-a',
                    url: 'https://example.com/photo.jpg',
                    target: null,
                    mission: 3,
                    isFunPhoto: false,
                })
            );
        });

        it('submits a fun-photo claim when there are no open targets or missions', async () => {
            await mountComposer({
                players: [{ name: 'Alice', targets: [], isAlive: true, openSeason: false }],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            expect(
                screen.getByText('No open targets or missions; this will be a fun photo.')
            ).toBeTruthy();
            await fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() =>
                expect(callables.submitKillPhoto).toHaveBeenCalledWith({
                    roomId: 'room-a',
                    url: 'https://example.com/photo.jpg',
                    target: null,
                    mission: null,
                    isFunPhoto: true,
                })
            );
        });

        it('closes the modal immediately on Submit, before uploadKillPhoto/submitKillPhoto resolve', async () => {
            let resolveUpload;
            storageCalls.uploadKillPhoto.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveUpload = resolve;
                    })
            );
            await mountComposer({
                players: [{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            // Not awaited for the same reason as the Send-button test above:
            // uploadKillPhoto is deliberately left pending.
            const pressPromise = fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() => expect(screen.queryByLabelText('Submit')).toBeNull());
            expect(callables.submitKillPhoto).not.toHaveBeenCalled();

            resolveUpload('https://example.com/photo.jpg');
            await pressPromise;

            await waitFor(() => expect(callables.submitKillPhoto).toHaveBeenCalled());
        });

        it('alerts with the failure reason when the upload fails, after the modal has already closed', async () => {
            storageCalls.uploadKillPhoto.mockRejectedValue(new Error('network error'));
            const alertSpy = jest.spyOn(Alert, 'alert');
            await mountComposer({
                players: [{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            await fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() =>
                expect(alertSpy).toHaveBeenCalledWith('Error submitting kill photo', 'network error')
            );
            expect(screen.queryByLabelText('Submit')).toBeNull();
        });

        it('alerts with the failure reason when submitKillPhoto rejects', async () => {
            callables.submitKillPhoto.mockRejectedValue(new Error('This game has ended.'));
            const alertSpy = jest.spyOn(Alert, 'alert');
            await mountComposer({
                players: [{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }],
            });

            await fireEvent.press(screen.getByLabelText('Send photo'));
            await fireEvent.press(screen.getByLabelText('Submit'));

            await waitFor(() =>
                expect(alertSpy).toHaveBeenCalledWith(
                    'Error submitting kill photo',
                    'This game has ended.'
                )
            );
        });
    });
});
