# Message feed render performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real performance regression in the player chat feed — an incoming message no longer forces every other message in the feed to re-render and re-style.

**Architecture:** A new pure helper, `applyMessageChanges`, merges Firestore's `docChanges()` into the existing messages array instead of remapping the full snapshot every time, preserving object references for anything unchanged. A new `MessageBubble` component (wrapped in `React.memo`) is the only thing that actually turns that reference stability into skipped work — a plain `.map()` over inline JSX re-executes every item regardless of prop identity, so this requires an actual component boundary. `MessageFeed.js` is rewired to use both.

**Tech Stack:** React (CRA), Chakra UI, Jest + React Testing Library (jsdom project for `.test.jsx`, node project for `.test.js`).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`).
- This is a render-path-only fix — no change to `firestore.rules`, the `limitToLast(50)` query bound, or what's rendered (visual/behavioral output must stay byte-for-byte identical to today).
- `change.newIndex` refers to a position in the query's full, unfiltered result set — `applyMessageChanges` must never be called with an already-filtered array, and the whisper-visibility filter must stay a separate step applied after the merge.
- `MessageBubble` is wrapped in `React.memo` with the default shallow comparison — no custom comparator.
- `GMChatPanel.js` is out of scope for this plan.

---

## Task 1: `applyMessageChanges` — pure docChanges merge

**Files:**

- Create: `src/utils/applyMessageChanges.js`
- Create: `src/utils/applyMessageChanges.test.js`

**Interfaces:**

- Produces: `applyMessageChanges(previousMessages, docChanges) → Array<{id, ...fields}>`, where `docChanges` is an array of Firestore `DocumentChange`-shaped objects (`{ type: 'added'|'modified'|'removed', newIndex, doc: { id, data(): object } }`). Consumed by Task 3's `MessageFeed.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/applyMessageChanges.test.js`:

```js
import { applyMessageChanges } from './applyMessageChanges';

const change = (type, id, data, newIndex) => ({
    type,
    newIndex,
    doc: { id, data: () => data },
});

describe('applyMessageChanges', () => {
    it('inserts an added change at newIndex', () => {
        const result = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        expect(result).toEqual([{ id: 'a', text: 'first' }]);
    });

    it('inserts a second added message after the first, in newIndex order', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        const result = applyMessageChanges(first, [change('added', 'b', { text: 'second' }, 1)]);

        expect(result).toEqual([
            { id: 'a', text: 'first' },
            { id: 'b', text: 'second' },
        ]);
    });

    it('replaces the existing entry in place for a modified change', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'original' }, 0)]);

        const result = applyMessageChanges(first, [change('modified', 'a', { text: 'edited' }, 0)]);

        expect(result).toEqual([{ id: 'a', text: 'edited' }]);
    });

    it('removes the entry for a removed change', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        const result = applyMessageChanges(first, [change('removed', 'a', { text: 'first' })]);

        expect(result).toEqual([]);
    });

    it('keeps the exact same object reference for a message not present in docChanges', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        const second = applyMessageChanges(first, [change('added', 'b', { text: 'second' }, 1)]);

        expect(second[0]).toBe(first[0]);
    });
});
```

The last test is the one that matters most — it's the property `MessageBubble`'s `React.memo` (Task 2) relies on.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects unit --testPathPattern=applyMessageChanges`
Expected: FAIL — `Cannot find module './applyMessageChanges'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/applyMessageChanges.js`:

```js
// Merges a Firestore onSnapshot's docChanges() into the previous messages
// array, preserving object references for anything not present in this
// snapshot's changes — the property MessageBubble's React.memo relies on
// to skip re-rendering messages that haven't actually changed
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
// docChanges() reports every doc as 'added' on the very first snapshot,
// so calling this with an empty previousMessages array correctly
// bootstraps the initial load too.
export const applyMessageChanges = (previousMessages, docChanges) => {
    const next = [...previousMessages];
    docChanges.forEach((change) => {
        const existingIndex = next.findIndex((message) => message.id === change.doc.id);
        if (change.type === 'removed') {
            if (existingIndex !== -1) next.splice(existingIndex, 1);
            return;
        }
        const message = { id: change.doc.id, ...change.doc.data() };
        if (existingIndex !== -1) next.splice(existingIndex, 1);
        next.splice(change.newIndex, 0, message);
    });
    return next;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects unit --testPathPattern=applyMessageChanges`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/applyMessageChanges.js src/utils/applyMessageChanges.test.js
git commit -m "Add applyMessageChanges, a reference-stable Firestore docChanges merge"
```

---

## Task 2: `MessageBubble` — extracted, memoized per-message render

**Files:**

- Create: `src/components/player_messages_components/MessageBubble.js`
- Create: `src/components/player_messages_components/MessageBubble.test.jsx`

**Interfaces:**

- Consumes: `formatMessageTime(timestamp)` (already exists, `src/utils/formatMessageTime.js`), `normalizePlayerName(name)` (already exists, `src/game/playerNames.js`).
- Produces: `MessageBubble` (default export, `React.memo`-wrapped, props `{ message, playerName }`), consumed by Task 3's `MessageFeed.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/player_messages_components/MessageBubble.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageBubble renders one playerMessages document — extracted from
 * MessageFeed.js and wrapped in React.memo so unchanged messages skip
 * re-rendering when new ones arrive
 * (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
 * No onSnapshot mocking needed — this component doesn't subscribe to
 * anything, it just renders whatever message/playerName props it's given.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import { formatMessageTime } from '../../utils/formatMessageTime';

const mountBubble = (message, playerName = 'Alice') =>
    render(
        <ChakraProvider>
            <MessageBubble message={message} playerName={playerName} />
        </ChakraProvider>
    );

describe('MessageBubble', () => {
    it('renders a leaderboard message as a standings list, not a text line', () => {
        mountBubble({
            type: 'leaderboard',
            recipient: null,
            text: null,
            standings: [
                { name: 'Alice', score: 30, isAlive: true },
                { name: 'Bob', score: 10, isAlive: false },
            ],
        });

        expect(screen.getByText('Alice: 30')).toBeInTheDocument();
        expect(screen.getByText('Bob: 10 (eliminated)')).toBeInTheDocument();
    });

    it('renders a mission message as a "New Mission!" card with unlimited participants', () => {
        mountBubble({
            type: 'mission',
            recipient: null,
            text: null,
            standings: null,
            mission: {
                title: 'Find the clue',
                description: 'Look under the food court table',
                taskType: 'Task',
                pointValue: '10',
                maxCompletions: null,
            },
        });

        expect(screen.getByText('New Mission!')).toBeInTheDocument();
        expect(screen.getByText('Find the clue')).toBeInTheDocument();
        expect(screen.getByText('Look under the food court table')).toBeInTheDocument();
        expect(screen.getByText('Task · 10 points · Unlimited players')).toBeInTheDocument();
    });

    it('renders a mission message with a participant limit', () => {
        mountBubble({
            type: 'mission',
            recipient: null,
            text: null,
            standings: null,
            mission: {
                title: 'Revive a fallen hero',
                description: 'Say the secret phrase',
                taskType: 'Revival Mission',
                pointValue: 0,
                maxCompletions: 3,
            },
        });

        expect(
            screen.getByText('Revival Mission · 0 points · Limited to 3 players')
        ).toBeInTheDocument();
    });

    it('shows a chat message with its sender', () => {
        mountBubble({
            type: 'chat',
            recipient: null,
            text: 'lol where are you',
            standings: null,
            mission: null,
            sender: 'Bob',
        });

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it("right-aligns the current player's own chat message and omits the sender prefix", () => {
        mountBubble(
            {
                type: 'chat',
                recipient: null,
                text: 'be right there',
                standings: null,
                mission: null,
                sender: 'Alice',
                timestamp: null,
            },
            'Alice'
        );

        expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-end' });
        expect(screen.queryByText('Alice:')).not.toBeInTheDocument();
        expect(screen.getByText('be right there')).toBeInTheDocument();
    });

    it('left-aligns a chat message from someone else', () => {
        mountBubble(
            {
                type: 'chat',
                recipient: null,
                text: 'lol where are you',
                standings: null,
                mission: null,
                sender: 'Bob',
                timestamp: null,
            },
            'Alice'
        );

        expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-start' });
    });

    it('shows a formatted time on a chat message with a resolved timestamp', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };
        mountBubble({
            type: 'chat',
            recipient: null,
            text: 'hi',
            standings: null,
            mission: null,
            sender: 'Bob',
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows no time text for a chat message with a pending (null) timestamp', () => {
        mountBubble({
            type: 'chat',
            recipient: null,
            text: 'sending this now',
            standings: null,
            mission: null,
            sender: 'Bob',
            timestamp: null,
        });

        expect(screen.getByText('sending this now')).toBeInTheDocument();
        expect(screen.queryByText(/^\d{1,2}:\d{2}/)).not.toBeInTheDocument();
    });

    it('shows a formatted time on a leaderboard message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        mountBubble({
            type: 'leaderboard',
            recipient: null,
            text: null,
            standings: [{ name: 'Alice', score: 30, isAlive: true }],
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows a formatted time on a mission message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        mountBubble({
            type: 'mission',
            recipient: null,
            text: null,
            standings: null,
            mission: {
                title: 'Find the clue',
                description: 'Look under the food court table',
                taskType: 'Task',
                pointValue: '10',
                maxCompletions: null,
            },
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows a formatted time on a broadcast message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        mountBubble({
            type: 'broadcast',
            recipient: null,
            text: 'Game starts soon!',
            standings: null,
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=MessageBubble`
Expected: FAIL — `Cannot find module './MessageBubble'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/player_messages_components/MessageBubble.js`:

```jsx
import React from 'react';
import { Box, Flex, List, ListItem, Text } from '@chakra-ui/react';
import { normalizePlayerName } from '../../game/playerNames';
import { formatMessageTime } from '../../utils/formatMessageTime';

// One message's rendering, extracted from MessageFeed.js and wrapped in
// React.memo so an unchanged message (same object reference, preserved by
// applyMessageChanges) is skipped entirely on re-render — the whole point
// of this split
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
const MessageBubble = ({ message, playerName }) => {
    const mission = message.mission ?? {};
    // Only 'chat' messages have a sender to compare — every other type
    // (whisper/broadcast/leaderboard/mission) is GM-authored and has no
    // sender field at all, so this guards normalizePlayerName from being
    // called on null/undefined for those.
    const isMine =
        message.sender != null &&
        normalizePlayerName(message.sender) === normalizePlayerName(playerName);
    const time = formatMessageTime(message.timestamp);

    return (
        <ListItem mb={2}>
            {message.type === 'leaderboard' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        Leaderboard
                    </Text>
                    {time && (
                        <Text fontSize="xs" color="gray.400" mb={1}>
                            {time}
                        </Text>
                    )}
                    <List styleType="none">
                        {(message.standings ?? []).map((entry) => (
                            <ListItem key={entry.name}>
                                {entry.name}: {entry.score}
                                {!entry.isAlive ? ' (eliminated)' : ''}
                            </ListItem>
                        ))}
                    </List>
                </Box>
            ) : message.type === 'mission' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        New Mission!
                    </Text>
                    <Text fontWeight="semibold">{mission.title}</Text>
                    <Text mb={1}>{mission.description}</Text>
                    <Text fontSize="sm" color="gray.400">
                        {mission.taskType} · {mission.pointValue} points ·{' '}
                        {mission.maxCompletions
                            ? `Limited to ${mission.maxCompletions} players`
                            : 'Unlimited players'}
                    </Text>
                    {time && (
                        <Text fontSize="xs" color="gray.400">
                            {time}
                        </Text>
                    )}
                </Box>
            ) : message.type === 'chat' ? (
                <Flex
                    justifyContent={isMine ? 'flex-end' : 'flex-start'}
                    data-testid="chat-message"
                >
                    <Box
                        bg={isMine ? 'teal.700' : 'blue.900'}
                        borderRadius="md"
                        p={2}
                        maxWidth="75%"
                    >
                        {!isMine && (
                            <>
                                <Text as="span" fontWeight="bold">
                                    {message.sender}:
                                </Text>{' '}
                            </>
                        )}
                        <Text as="span">{message.text}</Text>
                        {time && (
                            <Text fontSize="xs" color="gray.400" mt={1}>
                                {time}
                            </Text>
                        )}
                    </Box>
                </Flex>
            ) : (
                <Text
                    bg={message.type === 'whisper' ? 'whiteAlpha.100' : 'gray.700'}
                    border={message.type === 'whisper' ? '1px dashed' : undefined}
                    borderColor={message.type === 'whisper' ? 'gray.400' : undefined}
                    borderRadius="md"
                    p={2}
                    display="inline-block"
                >
                    <Text as="span">{message.text}</Text>
                    {time && (
                        // Inline, not block like the other branches' timestamp
                        // lines — this branch's outer element is a <Text>
                        // (renders <p>), and a block <Text> here would nest
                        // <p> in <p>.
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                </Text>
            )}
        </ListItem>
    );
};

export default React.memo(MessageBubble);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=MessageBubble`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageBubble.js src/components/player_messages_components/MessageBubble.test.jsx
git commit -m "Extract MessageBubble, a memoized per-message renderer"
```

---

## Task 3: `MessageFeed` — wire up docChanges + MessageBubble

**Files:**

- Modify: `src/components/player_messages_components/MessageFeed.js`
- Modify: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `applyMessageChanges(previousMessages, docChanges)` (Task 1), `MessageBubble` (Task 2, props `{ message, playerName }`).
- Produces: nothing new consumed elsewhere — this is the plan's final integration point.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/components/player_messages_components/MessageFeed.test.jsx` with:

```jsx
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

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
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
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — `MessageFeed.js` still calls `snapshot.docs`, which is `undefined` on these `docChanges()`-only fixtures, so every test that expects rendered content fails (nothing renders), and the new "does not re-render" test fails outright since the feature doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/components/player_messages_components/MessageFeed.js` with:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Box, List } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { normalizePlayerName } from '../../game/playerNames';
import { applyMessageChanges } from '../../utils/applyMessageChanges';
import MessageBubble from './MessageBubble';

// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins
// (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
//
// Merges via docChanges() rather than remapping the full snapshot.docs
// every time, so a message untouched by a given snapshot keeps its exact
// object reference — what lets MessageBubble's React.memo skip
// re-rendering messages that haven't changed
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
const MessageFeed = ({ roomID, playerName }) => {
    const [messages, setMessages] = useState([]);
    const feedBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const normalizedName = normalizePlayerName(playerName);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                setMessages((previous) => {
                    const merged = applyMessageChanges(previous, snapshot.docChanges());
                    return merged.filter(
                        (message) =>
                            !message.recipient ||
                            normalizePlayerName(message.recipient) === normalizedName
                    );
                });
            },
            (error) => {
                // Losing the chat feed doesn't mean this player's session is
                // invalid, unlike the room/player-doc subscriptions in
                // PlayerGame.js — log only, don't clear the session or
                // navigate away.
                console.error('Error watching messages:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID, playerName]);

    // Keeps the feed pinned to the newest message as it grows, matching the
    // same pattern already built for the GM's log panel
    // (GameMasterView.js's logsBoxRef).
    useEffect(() => {
        const feedBox = feedBoxRef.current;
        if (!feedBox) return;
        feedBox.scrollTop = feedBox.scrollHeight;
    }, [messages]);

    return (
        <Box flex="1" overflow="auto" p={2} ref={feedBoxRef} data-testid="message-feed">
            <List styleType="none">
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} playerName={playerName} />
                ))}
            </List>
        </Box>
    );
};

export default MessageFeed;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, all 7 tests, including the new "does not re-render a message untouched by a later snapshot" test.

Then run: `npx jest --selectProjects dom --testPathPattern=MessageBubble`
Expected: PASS, all 11 tests (unaffected by this task — `MessageBubble` itself didn't change).

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Wire MessageFeed to applyMessageChanges and memoized MessageBubble"
```

---

## Task 4: Full gate

**Files:** none — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all succeed with zero warnings/errors.

- [ ] **Step 2: Commit any formatting changes**

If `npm run format` modified any files, commit them:

```bash
git add -A
git commit -m "Format message feed render performance files"
```

If nothing was modified, skip this step — there's nothing to commit.
