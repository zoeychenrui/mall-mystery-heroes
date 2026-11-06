/**
 * Component test for ChatComposer — the RN port of
 * src/components/player_messages_components/MessageComposer.js's
 * text-sending logic (the camera button is Task 10's).
 *
 * Only the Firebase-touching '../../firebase/callables' import is mocked,
 * same pattern as JoinScreen.test.js / GameScreen.test.js.
 *
 * @testing-library/react-native v14's render/fireEvent are async — every
 * call is awaited.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as callables from '../../firebase/callables';
import ChatComposer from './ChatComposer';

jest.mock('../../firebase/callables', () => ({
    submitChatMessage: jest.fn(),
}));

beforeEach(() => {
    jest.clearAllMocks();
    callables.submitChatMessage.mockResolvedValue(undefined);
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
});
