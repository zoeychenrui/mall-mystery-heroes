/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Read-only view of the players' group chat, for the GM console — a
 * separate panel from the GM's own game-event Logs (different collection,
 * different purpose), so the GM isn't blind to player banter
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
 *
 * Per-message rendering is covered directly in GMChatMessage.test.jsx —
 * this file stays focused on the subscription/filter/merge pipeline and
 * the render-performance property that motivated the docChanges() rewrite
 * (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md): a
 * message untouched by a later snapshot must not re-render.
 *
 * Explicit mock factory for 'firebase/firestore', not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import GMChatPanel from './GMChatPanel';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { formatMessageTime } from '../../utils/formatMessageTime';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));
// GMChatMessage calls formatMessageTime exactly once per actual render, and
// not at all when React.memo skips re-invoking it for an unchanged message —
// so this mock's call count is a real render-count signal, not just a
// DOM-output check. See the "does not re-render a message untouched by a
// later snapshot" test.
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

const mountPanel = (roomID = 'room-a') =>
    render(
        <ChakraProvider>
            <GMChatPanel roomID={roomID} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('GMChatPanel', () => {
    it('shows a chat message with its sender', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docChanges: () =>
                    asDocChanges([
                        { type: 'chat', recipient: null, text: 'lol where are you', sender: 'Bob' },
                    ]),
            });
            return () => {};
        });

        mountPanel();

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it('filters out non-chat messages, e.g. a GM broadcast', () => {
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
                        { type: 'chat', recipient: null, text: 'hyped', sender: 'Alice' },
                    ]),
            });
            return () => {};
        });

        mountPanel();

        expect(screen.queryByText('Game starts soon!')).not.toBeInTheDocument();
        expect(screen.getByText('hyped')).toBeInTheDocument();
    });

    it('does not subscribe when roomID is empty', () => {
        onSnapshot.mockImplementation(() => () => {});

        mountPanel('');

        expect(fetchPlayerMessagesQueryForRoom).not.toHaveBeenCalled();
    });

    it('scrolls to the bottom whenever a new message arrives', async () => {
        let deliverMessages;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverMessages = onNext;
            onNext({ docChanges: () => [] });
            return () => {};
        });

        mountPanel();

        const panel = await screen.findByTestId('gm-chat-panel');
        // jsdom never computes real layout, so scrollHeight is always 0 —
        // stub it to a value that would actually require scrolling, the
        // same way a real, overflowing panel would report it.
        Object.defineProperty(panel, 'scrollHeight', {
            value: 500,
            configurable: true,
        });
        panel.scrollTop = 0;

        await act(async () => {
            deliverMessages({
                docChanges: () =>
                    asDocChanges([
                        { type: 'chat', recipient: null, text: 'new message', sender: 'Bob' },
                    ]),
            });
        });

        expect(panel.scrollTop).toBe(500);
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
                                type: 'chat',
                                recipient: null,
                                text: 'First message',
                                sender: 'Bob',
                            }),
                        },
                    },
                ],
            });
            return () => {};
        });

        mountPanel();

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
                                type: 'chat',
                                recipient: null,
                                text: 'Second message',
                                sender: 'Alice',
                            }),
                        },
                    },
                ],
            });
        });

        expect(screen.getByText('First message')).toBe(firstMessageNode);
        expect(screen.getByText('Second message')).toBeInTheDocument();
        // NOT 3: if GMChatMessage correctly skips re-rendering the untouched
        // first message, only the new second message renders here, for a
        // total of 2 calls across both snapshots. A broken memoization would
        // re-render both messages on the second snapshot, totaling 3.
        expect(formatMessageTime).toHaveBeenCalledTimes(2);
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
                                type: 'broadcast',
                                recipient: null,
                                text: 'Game starts soon!',
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
                                type: 'chat',
                                recipient: null,
                                text: 'C1',
                                sender: 'Alice',
                            }),
                        },
                    },
                ],
            });
            return () => {};
        });

        mountPanel();

        await act(async () => {
            deliverSnapshot({
                docChanges: () => [
                    {
                        type: 'added',
                        newIndex: 1,
                        doc: {
                            id: 'message-2',
                            data: () => ({
                                type: 'chat',
                                recipient: null,
                                text: 'C2',
                                sender: 'Bob',
                            }),
                        },
                    },
                ],
            });
        });

        const renderedOrder = screen
            .getAllByRole('listitem')
            .map((el) => el.textContent)
            .filter((text) => text.includes('C1') || text.includes('C2'));

        // The unfiltered result set after both snapshots is
        // [broadcast, C2, C1] — C2's newIndex of 1 places it between the
        // broadcast and C1 in the FULL result set (applyMessageChanges.test.js
        // covers this insertion semantic directly). Once the broadcast is
        // filtered out of GMChatPanel's chat-only view, C2 correctly renders
        // BEFORE C1. Feeding the already-filtered `[C1]` array back into
        // applyMessageChanges instead would land C2's newIndex of 1 past the
        // end of that 1-element array — splice's out-of-range clamping would
        // silently append it, producing the wrong order, ['Alice: C1', 'Bob: C2'].
        expect(renderedOrder).toEqual(['Bob: C2', 'Alice: C1']);
    });
});
