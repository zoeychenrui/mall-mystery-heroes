/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers MessageFeed's live subscription and client-side filtering: a
 * player sees broadcasts and leaderboard sends (recipient: null) plus any
 * whisper addressed to them, but not whispers addressed to someone else.
 * This filtering is a display convenience, not a security boundary —
 * firestore.rules already grants any player-of-the-room read access to
 * the whole collection
 * (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
 *
 * Per-message rendering (chat alignment, timestamps, leaderboard/mission
 * cards, etc.) is covered directly in MessageBubble.test.jsx — this file
 * stays focused on the subscription/filter/merge pipeline and the
 * render-performance property that motivated this file's docChanges()
 * rewrite (docs/superpowers/specs/2026-08-12-message-feed-render-perf-
 * design.md): a message untouched by a later snapshot must not
 * re-render.
 *
 * Explicit mock factory for 'firebase/firestore', not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import MessageFeed from './MessageFeed';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { formatMessageTime } from '../../utils/formatMessageTime';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));
// MessageBubble calls formatMessageTime exactly once per actual render (all
// four of its branches do, before returning JSX) and not at all when
// React.memo skips re-invoking it for an unchanged message — so this mock's
// call count is a real render-count signal, not just a DOM-output check. See
// the "does not re-render a message untouched by a later snapshot" test.
jest.mock('../../utils/formatMessageTime', () => {
    const actual = jest.requireActual('../../utils/formatMessageTime');
    return { formatMessageTime: jest.fn(actual.formatMessageTime) };
});

// Firestore-shaped docChanges() fixture — every message arrives as an
// 'added' change, matching what a real first snapshot reports.
const asDocChanges = (messages) =>
    messages.map((message, index) => ({
        type: 'added',
        newIndex: index,
        doc: { id: `message-${index}`, data: () => message },
    }));

const mountFeed = (playerName = 'Alice') =>
    render(
        <ChakraProvider>
            <MessageFeed roomID="room-a" playerName={playerName} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('MessageFeed', () => {
    it('shows a broadcast to any player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'broadcast',
                            recipient: null,
                            text: 'Game starts soon!',
                            standings: null,
                        },
                    ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText('Game starts soon!')).toBeInTheDocument();
    });

    it('renders a gameEnded message pinned above the scrolling feed, not inside it', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'chat',
                            recipient: null,
                            text: 'gg everyone',
                            standings: null,
                            mission: null,
                            sender: 'Bob',
                        },
                        {
                            type: 'gameEnded',
                            recipient: null,
                            text: 'Please head back to the starting area.',
                            standings: null,
                        },
                    ]),
            });
            return () => {};
        });

        mountFeed();

        const pinned = screen.getByText('Please head back to the starting area.');
        expect(pinned).toBeInTheDocument();
        // Pinned message lives outside the scrollable feed container, not
        // as one of its list items.
        expect(screen.getByTestId('message-feed')).not.toContainElement(pinned);
        expect(screen.getByText('gg everyone')).toBeInTheDocument();
    });

    it('does not render a pinned section at all when there is no gameEnded message', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        { type: 'broadcast', recipient: null, text: 'hi', standings: null },
                    ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.queryByTestId('pinned-message')).not.toBeInTheDocument();
    });

    it('shows a whisper addressed to this player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'whisper',
                            recipient: 'Alice',
                            text: 'You are being hunted',
                            standings: null,
                        },
                    ]),
            });
            return () => {};
        });

        mountFeed('Alice');

        expect(screen.getByText('You are being hunted')).toBeInTheDocument();
    });

    it('does not show a whisper addressed to a different player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'whisper',
                            recipient: 'Bob',
                            text: 'Secret for Bob',
                            standings: null,
                        },
                    ]),
            });
            return () => {};
        });

        mountFeed('Alice');

        expect(screen.queryByText('Secret for Bob')).not.toBeInTheDocument();
    });

    it('matches the recipient case/whitespace-insensitively', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'whisper',
                            recipient: 'alice smith',
                            text: 'For Alice Smith',
                            standings: null,
                        },
                    ]),
            });
            return () => {};
        });

        mountFeed('Alice Smith');

        expect(screen.getByText('For Alice Smith')).toBeInTheDocument();
    });

    it('does not subscribe when playerName is empty', () => {
        onSnapshot.mockImplementation(() => () => {});

        mountFeed('');

        expect(fetchPlayerMessagesQueryForRoom).not.toHaveBeenCalled();
    });

    it('scrolls to the bottom whenever a new message arrives', async () => {
        let deliverMessages;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverMessages = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });

        mountFeed();

        const feedBox = await screen.findByTestId('message-feed');
        // jsdom never computes real layout, so scrollHeight is always 0 —
        // stub it to a value that would actually require scrolling, the same
        // way a real, overflowing feed would report it.
        Object.defineProperty(feedBox, 'scrollHeight', {
            value: 500,
            configurable: true,
        });
        feedBox.scrollTop = 0;

        await act(async () => {
            deliverMessages({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'broadcast',
                            recipient: null,
                            text: 'New message',
                            standings: null,
                        },
                    ]),
            });
        });

        expect(feedBox.scrollTop).toBe(500);
    });

    it('does not re-render a message untouched by a later snapshot', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({
                docChanges: () => [
                    {
                        type: 'added',
                        newIndex: 0,
                        doc: {
                            id: 'message-0',
                            data: () => ({
                                type: 'broadcast',
                                recipient: null,
                                text: 'First message',
                                standings: null,
                            }),
                        },
                    },
                ],
            });
            return () => {};
        });

        mountFeed();

        const firstMessageNode = screen.getByText('First message');
        // The single existing message has rendered once. This is the actual
        // render-count proof — DOM-identity alone can't distinguish "skipped
        // the render" from "re-rendered and happened to produce the same
        // output."
        expect(formatMessageTime).toHaveBeenCalledTimes(1);

        await act(async () => {
            deliverSnapshot({
                docChanges: () => [
                    {
                        type: 'added',
                        newIndex: 1,
                        doc: {
                            id: 'message-1',
                            data: () => ({
                                type: 'broadcast',
                                recipient: null,
                                text: 'Second message',
                                standings: null,
                            }),
                        },
                    },
                ],
            });
        });

        expect(screen.getByText('First message')).toBe(firstMessageNode);
        expect(screen.getByText('Second message')).toBeInTheDocument();
        // NOT 3: if MessageBubble correctly skips re-rendering the untouched
        // first message, only the new second message renders here, for a
        // total of 2 calls across both snapshots. A broken memoization would
        // re-render both messages on the second snapshot, totaling 3.
        expect(formatMessageTime).toHaveBeenCalledTimes(2);
    });

    it('renders a pending message appended after the real ones', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        { type: 'broadcast', recipient: null, text: 'Real one', standings: null },
                    ]),
            });
            return () => {};
        });

        render(
            <ChakraProvider>
                <MessageFeed
                    roomID="room-a"
                    playerName="Alice"
                    pendingMessages={[
                        {
                            id: 'pending-1',
                            type: 'chat',
                            recipient: null,
                            text: 'not yet confirmed',
                            standings: null,
                            mission: null,
                            sender: 'Alice',
                            timestamp: null,
                        },
                    ]}
                />
            </ChakraProvider>
        );

        const rendered = screen.getAllByRole('listitem').map((el) => el.textContent);
        expect(rendered).toEqual(['GM: Real one', 'not yet confirmed']);
    });

    it('calls onPendingMessageConfirmed once when a real chat message from this player arrives', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });
        const onPendingMessageConfirmed = jest.fn();

        render(
            <ChakraProvider>
                <MessageFeed
                    roomID="room-a"
                    playerName="Alice"
                    onPendingMessageConfirmed={onPendingMessageConfirmed}
                />
            </ChakraProvider>
        );

        await act(async () => {
            deliverSnapshot({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'chat',
                            recipient: null,
                            text: 'hi',
                            standings: null,
                            mission: null,
                            sender: 'Alice',
                        },
                    ]),
            });
        });

        expect(onPendingMessageConfirmed).toHaveBeenCalledTimes(1);
    });

    it('matches the sender case/whitespace-insensitively when confirming a pending message', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });
        const onPendingMessageConfirmed = jest.fn();

        render(
            <ChakraProvider>
                <MessageFeed
                    roomID="room-a"
                    playerName="Alice Smith"
                    onPendingMessageConfirmed={onPendingMessageConfirmed}
                />
            </ChakraProvider>
        );

        await act(async () => {
            deliverSnapshot({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'chat',
                            recipient: null,
                            text: 'hi',
                            standings: null,
                            mission: null,
                            sender: 'alice smith',
                        },
                    ]),
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

        render(
            <ChakraProvider>
                <MessageFeed
                    roomID="room-a"
                    playerName="Alice"
                    onPendingMessageConfirmed={onPendingMessageConfirmed}
                />
            </ChakraProvider>
        );

        await act(async () => {
            deliverSnapshot({
                docChanges: () =>
                    asDocChanges([
                        {
                            type: 'chat',
                            recipient: null,
                            text: 'hi',
                            standings: null,
                            mission: null,
                            sender: 'Bob',
                        },
                    ]),
            });
        });

        expect(onPendingMessageConfirmed).not.toHaveBeenCalled();
        expect(screen.getByText('hi')).toBeInTheDocument();
    });

    it('does not call onPendingMessageConfirmed for a non-chat message, even one shaped with this player as sender', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });
        const onPendingMessageConfirmed = jest.fn();

        render(
            <ChakraProvider>
                <MessageFeed
                    roomID="room-a"
                    playerName="Alice"
                    onPendingMessageConfirmed={onPendingMessageConfirmed}
                />
            </ChakraProvider>
        );

        await act(async () => {
            deliverSnapshot({
                docChanges: () =>
                    asDocChanges([
                        { type: 'broadcast', recipient: null, text: 'hi', standings: null },
                    ]),
            });
        });

        expect(onPendingMessageConfirmed).not.toHaveBeenCalled();
    });

    it('inserts a later message at the correct position even when an earlier message is filtered out', async () => {
        let deliverSnapshot;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverSnapshot = onNext;
            onNext({
                docChanges: () => [
                    {
                        type: 'added',
                        newIndex: 0,
                        doc: {
                            id: 'message-0',
                            data: () => ({
                                type: 'whisper',
                                recipient: 'Bob',
                                text: 'Secret for Bob',
                                standings: null,
                            }),
                        },
                    },
                    {
                        type: 'added',
                        newIndex: 1,
                        doc: {
                            id: 'message-1',
                            data: () => ({
                                type: 'broadcast',
                                recipient: null,
                                text: 'B1',
                                standings: null,
                            }),
                        },
                    },
                ],
            });
            return () => {};
        });

        mountFeed('Alice');

        await act(async () => {
            deliverSnapshot({
                docChanges: () => [
                    {
                        type: 'added',
                        newIndex: 1,
                        doc: {
                            id: 'message-2',
                            data: () => ({
                                type: 'broadcast',
                                recipient: null,
                                text: 'B2',
                                standings: null,
                            }),
                        },
                    },
                ],
            });
        });

        const renderedOrder = screen
            .getAllByRole('listitem')
            .map((el) => el.textContent)
            .filter((text) => text === 'GM: B1' || text === 'GM: B2');

        // The unfiltered result set after both snapshots is
        // [whisper(Bob), B2, B1] — B2's newIndex of 1 places it between the
        // whisper and B1 in the FULL result set (applyMessageChanges.test.js
        // covers this insertion semantic directly). Once the whisper is
        // filtered out for Alice, B2 correctly renders BEFORE B1. The old
        // buggy code fed the already-filtered `[B1]` array back into
        // applyMessageChanges, so B2's newIndex of 1 landed past the end of
        // that 1-element array — splice's out-of-range clamping silently
        // appended it, producing the wrong order, ['B1', 'B2'].
        expect(renderedOrder).toEqual(['GM: B2', 'GM: B1']);
    });
});
