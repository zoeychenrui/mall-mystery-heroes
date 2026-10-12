/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages and now also
 * owns capturing, compressing, and submitting a kill-photo claim — the
 * camera button triggers a hidden file input directly, and KillPhotoModal
 * (rendered for real here, not stubbed — it has no Firebase imports of
 * its own since the 2026-08-15 one-tap-kill-photo-capture redesign) only
 * appears once a photo has been captured
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
 * docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
 * docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
 *
 * Explicit mock factories for submitChatMessage.js and submitKillPhoto.js,
 * not auto-mock — see ChatInput.test.jsx for why auto-mocking
 * utils/firebase.js isn't safe.
 *
 * Interactions that trigger `handleSend` (async — it `await`s
 * `submitChatMessage`) are followed by a `waitFor` on their resulting
 * assertion, not a manual `act(async () => { ... })` wrapper around the
 * `userEvent` call: `userEvent`'s methods already wrap themselves in `act`
 * internally, and wrapping them again is the exact anti-pattern
 * `testing-library/no-unnecessary-act` exists to flag.
 *
 * This file's `userEvent.type` calls do still print "not wrapped in
 * act(...)" warnings during typing — investigated (final review,
 * chat-send-and-efficiency, fix round 2) and found to be a pre-existing,
 * repo-wide characteristic of `@testing-library/user-event@13.5.0`
 * (package.json) under React 18, not something this file's tests trigger
 * uniquely or incorrectly: `ChatInput.test.jsx`, untouched by this
 * feature, prints over a thousand of the identical warning from its own
 * `userEvent.type` calls. Manually re-wrapping `userEvent` in `act()`
 * silences the symptom but is the anti-pattern the lint rule above exists
 * to catch, and isn't this codebase's existing convention (ChatInput
 * doesn't do it either) — fixing the root cause would mean upgrading
 * `@testing-library/user-event` to v14 across the whole suite, out of
 * scope for this feature. Tests here still pass deterministically.
 *
 * jsdom's simulated file-input `change` events do not reproduce a real
 * browser's refusal to re-fire `change` for an identical file, whether
 * driven via `userEvent.upload` or `fireEvent.change` (confirmed by
 * direct experiment while planning this feature) — so the reset test
 * below asserts the input's `.value` directly rather than asserting a
 * second `change` event fires.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { submitChatMessage } from '../submitChatMessage';
import { submitKillPhoto } from '../submitKillPhoto';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';

jest.mock('../submitChatMessage', () => ({
    submitChatMessage: jest.fn(),
}));
jest.mock('../submitKillPhoto', () => ({
    submitKillPhoto: jest.fn(),
}));
jest.mock('../../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));

const mountComposer = (playerName = 'Alice', targets = ['bob'], extraProps = {}) =>
    render(
        <ChakraProvider>
            <MessageComposer
                roomID="room-a"
                playerName={playerName}
                targets={targets}
                players={[{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }]}
                missions={[]}
                {...extraProps}
            />
        </ChakraProvider>
    );

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
const fakeFile2 = new File(['fake2'], 'photo2.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    submitChatMessage.mockResolvedValue(undefined);
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    global.URL.revokeObjectURL = jest.fn();
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    submitKillPhoto.mockResolvedValue(undefined);
});

describe('MessageComposer', () => {
    it('renders an enabled message input and Send button', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('enables the photo button when playerName and targets are both set', () => {
        mountComposer('Alice', ['bob']);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeEnabled();
    });

    it('keeps the photo button enabled when targets is empty, as long as playerName is set', () => {
        // The zero-targets gate was removed: a dead player (who always has
        // zero targets) still needs to be able to submit a photo, since the
        // moderator's dropdown may resolve it to an open mission instead of
        // a kill target
        // (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
        mountComposer('Alice', []);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeEnabled();
    });

    it('disables the photo button when playerName is empty, even if targets is set', () => {
        mountComposer('', ['bob']);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('disables the photo button once the game has ended, even with playerName and targets set', () => {
        mountComposer('Alice', ['bob'], { isGameActive: false });

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('leaves the Send button (text chat) enabled once the game has ended', () => {
        mountComposer('Alice', ['bob'], { isGameActive: false });

        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('sends the typed message when Send is clicked', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hey where are you');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() =>
            expect(submitChatMessage).toHaveBeenCalledWith({
                roomId: 'room-a',
                text: 'hey where are you',
            })
        );
    });

    it('sends the typed message when Enter is pressed', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        await waitFor(() =>
            expect(submitChatMessage).toHaveBeenCalledWith({ roomId: 'room-a', text: 'hi' })
        );
    });

    it('does not send on Shift+Enter, so a future multiline input could still get a newline', async () => {
        mountComposer();

        await userEvent.type(
            screen.getByPlaceholderText('Type a message...'),
            'hi{Shift>}{Enter}{/Shift}'
        );

        expect(submitChatMessage).not.toHaveBeenCalled();
    });

    it('clears the input after sending', async () => {
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        await waitFor(() => expect(submitChatMessage).toHaveBeenCalled());
        expect(input).toHaveValue('');
    });

    it('does not send a blank or whitespace-only message', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), '   {Enter}');

        expect(submitChatMessage).not.toHaveBeenCalled();
    });

    it('restores the typed text if the send fails, instead of losing it', async () => {
        submitChatMessage.mockRejectedValue(new Error('network error'));
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        await waitFor(() => expect(input).toHaveValue('hi'));
    });

    it('reports the message via onOptimisticSend immediately, before submitChatMessage resolves', async () => {
        let resolveSend;
        submitChatMessage.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSend = resolve;
                })
        );
        const onOptimisticSend = jest.fn();
        mountComposer('Alice', ['bob'], { onOptimisticSend });

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        expect(onOptimisticSend).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'chat',
                recipient: null,
                text: 'hi',
                standings: null,
                mission: null,
                sender: 'Alice',
                timestamp: null,
            })
        );
        // A real Firestore doc ID can never be known client-side ahead of
        // the write — this is just a React key / correlation handle for
        // onOptimisticSendFailed below, not something a real message ID
        // is ever matched against.
        expect(typeof onOptimisticSend.mock.calls[0][0].id).toBe('string');
        resolveSend();
    });

    it('calls onOptimisticSendFailed with the same id it reported to onOptimisticSend when the send fails', async () => {
        submitChatMessage.mockRejectedValue(new Error('network error'));
        const onOptimisticSend = jest.fn();
        const onOptimisticSendFailed = jest.fn();
        mountComposer('Alice', ['bob'], { onOptimisticSend, onOptimisticSendFailed });

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        await waitFor(() => expect(onOptimisticSendFailed).toHaveBeenCalled());
        const reportedId = onOptimisticSend.mock.calls[0][0].id;
        expect(onOptimisticSendFailed).toHaveBeenCalledWith(reportedId);
    });

    it('does not call onOptimisticSend for a blank or whitespace-only message', async () => {
        const onOptimisticSend = jest.fn();
        mountComposer('Alice', ['bob'], { onOptimisticSend });

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), '   {Enter}');

        expect(onOptimisticSend).not.toHaveBeenCalled();
    });

    it('disables the input and Send button when playerName is empty', () => {
        mountComposer('');

        expect(screen.getByPlaceholderText('Type a message...')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('selecting a photo compresses it and opens the modal with the preview', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalledWith(fakeFile));
        expect(await screen.findByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
    });

    it('opens the modal with an error, not a preview, when compression fails', async () => {
        compressImage.mockRejectedValue(new Error('bad file'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        expect(
            await screen.findByText('Could not read that photo. Try taking it again.')
        ).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });

    it('closes the modal immediately when Submit is clicked, before uploadKillPhoto or submitKillPhoto resolve', async () => {
        let resolveUpload;
        uploadKillPhoto.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveUpload = resolve;
                })
        );
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        // Gone already — uploadKillPhoto has not even resolved yet.
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
        );
        expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        expect(submitKillPhoto).not.toHaveBeenCalled();

        resolveUpload('https://example.com/photo.jpg');

        await waitFor(() =>
            expect(submitKillPhoto).toHaveBeenCalledWith({
                roomId: 'room-a',
                url: 'https://example.com/photo.jpg',
                target: 'bob',
                mission: null,
            })
        );
        // The order still genuinely matters: the photo must be uploaded (so
        // `url` is valid) before the Firestore doc referencing that url is
        // written — the modal closing early doesn't change that ordering.
        expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
            uploadKillPhoto.mock.invocationCallOrder[0]
        );
        expect(uploadKillPhoto.mock.invocationCallOrder[0]).toBeLessThan(
            submitKillPhoto.mock.invocationCallOrder[0]
        );
    });

    it('submits the resolved target claim, split into target/mission fields', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() =>
            expect(submitKillPhoto).toHaveBeenCalledWith({
                roomId: 'room-a',
                url: 'https://example.com/photo.jpg',
                target: 'bob',
                mission: null,
            })
        );
    });

    it('submits a mission claim, split into target/mission fields, when that is the only open option', async () => {
        mountComposer('Alice', ['bob'], {
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

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() =>
            expect(submitKillPhoto).toHaveBeenCalledWith({
                roomId: 'room-a',
                url: 'https://example.com/photo.jpg',
                target: null,
                mission: 3,
            })
        );
    });

    it('passes players and missions through to KillPhotoModal’s picker', async () => {
        mountComposer('Alice', ['bob'], {
            players: [
                { name: 'Alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
        });

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        expect(await screen.findByLabelText('Select target or mission')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'carol' })).toBeInTheDocument();
    });

    it('shows a toast with the failure reason when the upload fails, after the modal has already closed', async () => {
        uploadKillPhoto.mockRejectedValue(new Error('network error'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
        );
        // uploadKillPhoto's rejection also carries a real `.message`, so it
        // surfaces the same way a submitKillPhoto rejection would — the
        // generic fallback text only shows when the thrown error has no
        // `.message` at all.
        expect(await screen.findByText('network error')).toBeInTheDocument();
    });

    it('shows the specific error message in the toast when submitKillPhoto rejects with one', async () => {
        submitKillPhoto.mockRejectedValue(new Error('This game has ended.'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(await screen.findByText('This game has ended.')).toBeInTheDocument();
    });

    it('resets the file input value after each selection, so the same photo can be selected again', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalled());
        expect(fileInput.value).toBe('');
    });

    it('clicking the photo button clicks the hidden file input', async () => {
        const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click');
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));

        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
    });

    it('lets a file selection through the hidden input when targets is empty', async () => {
        // The zero-targets gate was removed — a dead player (always zero
        // targets) still needs to be able to submit a photo
        // (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
        mountComposer('Alice', []);

        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalled());
    });

    // The photo button's own isDisabled guard (disabled || !isGameActive)
    // has no effect on the hidden file input it drives unless the native
    // input carries the same guard: VisuallyHidden keeps the input
    // focusable and in the tab order by design, so a keyboard/screen-reader
    // user (or anything driving the DOM directly) can otherwise reach it and
    // run the whole capture flow even when the button is disabled.
    it('does not let a file selection through the hidden input when playerName is empty', async () => {
        mountComposer('', ['bob']);

        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        expect(compressImage).not.toHaveBeenCalled();
    });

    it('shows a processing indicator immediately after capture, before compression resolves', async () => {
        let resolveCompress;
        compressImage.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveCompress = resolve;
                })
        );
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        expect(await screen.findByText('Processing photo…')).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();

        resolveCompress(fakeBlob);

        expect(await screen.findByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
        expect(screen.queryByText('Processing photo…')).not.toBeInTheDocument();
    });

    it('revokes the preview URL on unmount', async () => {
        const { unmount } = mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await screen.findByAltText('Kill photo preview');

        unmount();

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview');
    });

    it('revokes the previous preview URL when a second capture fails to compress', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await screen.findByAltText('Kill photo preview');
        URL.revokeObjectURL.mockClear();

        compressImage.mockRejectedValueOnce(new Error('bad file'));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile2);

        await screen.findByText('Could not read that photo. Try taking it again.');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview');
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    });

    it('limits the chat message input to 500 characters', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toHaveAttribute(
            'maxlength',
            '500'
        );
    });
});
