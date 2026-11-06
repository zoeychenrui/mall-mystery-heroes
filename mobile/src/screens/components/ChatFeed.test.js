/**
 * Component test for ChatFeed — the RN port of
 * src/components/player_messages_components/MessageFeed.js. Mirrors
 * MessageFeed.test.jsx's core cases (mine-styling, GM label for GM-authored
 * message types) plus the subscription filter/pending-message behavior
 * ChatFeed ports from the same file.
 *
 * Only Firebase-touching imports are mocked, same pattern as
 * GameScreen.test.js: 'firebase/firestore' (ChatFeed's own onSnapshot call)
 * and '../../firebase/dbCalls' (so no real Firestore query builder runs).
 * applyMessageChanges and normalizePlayerName are pure and imported for
 * real.
 */
import { StyleSheet } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import { onSnapshot } from 'firebase/firestore';
import ChatFeed from './ChatFeed';
import { fetchPlayerMessagesQueryForRoom } from '../../firebase/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../../firebase/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));

// Firestore-shaped docChanges() fixture — every message arrives as an
// 'added' change, matching what a real first snapshot reports.
const asDocChanges = (messages) =>
    messages.map((message, index) => ({
        type: 'added',
        newIndex: index,
        doc: { id: `message-${index}`, data: () => message },
    }));

const deliverOnMount = (messages) => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docChanges: () => asDocChanges(messages) });
        return () => {};
    });
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('ChatFeed', () => {
    it('renders a chat message from this player via the "mine" styling path', async () => {
        deliverOnMount([
            { type: 'chat', recipient: null, text: 'hi there', sender: 'Alice' },
        ]);

        await render(<ChatFeed roomID="room-a" playerName="Alice" />);

        const row = await screen.findByTestId('chat-message');
        const flattened = StyleSheet.flatten(row.props.style);
        expect(flattened.justifyContent).toBe('flex-end');
        expect(screen.getByText('hi there')).toBeTruthy();
    });

    it('renders a chat message from another player via the "theirs" styling path', async () => {
        deliverOnMount([{ type: 'chat', recipient: null, text: 'yo', sender: 'Bob' }]);

        await render(<ChatFeed roomID="room-a" playerName="Alice" />);

        const row = await screen.findByTestId('chat-message');
        const flattened = StyleSheet.flatten(row.props.style);
        expect(flattened.justifyContent).toBe('flex-start');
        expect(screen.getByText('Bob: yo')).toBeTruthy();
    });

    it('renders a whisper message with the "GM:" label', async () => {
        deliverOnMount([
            { type: 'whisper', recipient: 'Alice', text: 'You are being hunted' },
        ]);

        await render(<ChatFeed roomID="room-a" playerName="Alice" />);

        expect(await screen.findByText('GM: You are being hunted')).toBeTruthy();
    });

    it('renders a broadcast message with the "GM:" label', async () => {
        deliverOnMount([{ type: 'broadcast', recipient: null, text: 'Game starts soon!' }]);

        await render(<ChatFeed roomID="room-a" playerName="Alice" />);

        expect(await screen.findByText('GM: Game starts soon!')).toBeTruthy();
    });

    it('does not show a whisper addressed to a different player', async () => {
        deliverOnMount([{ type: 'whisper', recipient: 'Bob', text: 'Secret for Bob' }]);

        await render(<ChatFeed roomID="room-a" playerName="Alice" />);

        expect(screen.queryByText('GM: Secret for Bob')).toBeNull();
    });

    it('matches the recipient case/whitespace-insensitively', async () => {
        deliverOnMount([{ type: 'whisper', recipient: 'alice smith', text: 'For Alice Smith' }]);

        await render(<ChatFeed roomID="room-a" playerName="Alice Smith" />);

        expect(await screen.findByText('GM: For Alice Smith')).toBeTruthy();
    });

    it('does not subscribe when playerName is empty', async () => {
        onSnapshot.mockImplementation(() => () => {});

        await render(<ChatFeed roomID="room-a" playerName="" />);

        expect(fetchPlayerMessagesQueryForRoom).not.toHaveBeenCalled();
    });

    it('renders a pending message appended after the real ones', async () => {
        deliverOnMount([{ type: 'broadcast', recipient: null, text: 'Real one' }]);

        await render(
            <ChatFeed
                roomID="room-a"
                playerName="Alice"
                pendingMessages={[
                    {
                        id: 'pending-1',
                        type: 'chat',
                        recipient: null,
                        text: 'not yet confirmed',
                        sender: 'Alice',
                        timestamp: null,
                    },
                ]}
            />
        );

        expect(await screen.findByText('GM: Real one')).toBeTruthy();
        expect(await screen.findByText('not yet confirmed')).toBeTruthy();
    });

    it('calls onPendingMessageConfirmed once when a real chat message from this player arrives', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });
        const onPendingMessageConfirmed = jest.fn();

        await render(
            <ChatFeed
                roomID="room-a"
                playerName="Alice"
                onPendingMessageConfirmed={onPendingMessageConfirmed}
            />
        );

        await act(async () => {
            deliverSnapshot({
                docChanges: () =>
                    asDocChanges([{ type: 'chat', recipient: null, text: 'hi', sender: 'Alice' }]),
            });
        });

        expect(onPendingMessageConfirmed).toHaveBeenCalledTimes(1);
    });

    it('does not call onPendingMessageConfirmed for a chat message from a different player', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });
        const onPendingMessageConfirmed = jest.fn();

        await render(
            <ChatFeed
                roomID="room-a"
                playerName="Alice"
                onPendingMessageConfirmed={onPendingMessageConfirmed}
            />
        );

        await act(async () => {
            deliverSnapshot({
                docChanges: () =>
                    asDocChanges([{ type: 'chat', recipient: null, text: 'hi', sender: 'Bob' }]),
            });
        });

        expect(onPendingMessageConfirmed).not.toHaveBeenCalled();
    });
});
