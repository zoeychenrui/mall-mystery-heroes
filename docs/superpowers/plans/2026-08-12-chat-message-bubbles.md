# Chat message bubbles: sender alignment and timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player chat feed reads like an ordinary group chat — your own chat messages align right and drop their sender prefix, everyone else's stay left with the sender shown, and every message in the feed (chat, whisper, broadcast, leaderboard, mission) shows a clock-time timestamp.

**Architecture:** A new pure helper, `formatMessageTime`, converts a Firestore timestamp to a `"3:45 PM"`-style string (or `null` while a write is still pending server ack). `MessageFeed.js` computes `isMine` and `time` per message and threads them into all four of its existing render branches — only the `'chat'` branch's layout changes (alignment + own-message styling); the other three just gain a timestamp line.

**Tech Stack:** React (CRA), Chakra UI, Jest + React Testing Library (jsdom project for `.test.jsx`, node project for `.test.js`).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`).
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js` — this feature is render-only and doesn't touch that file.
- Write the test first and watch it fail, for every behavioral change.
- Right/left alignment applies only to `'chat'` messages — `leaderboard`/`mission`/whisper/broadcast keep their current layout, gaining only a timestamp line.
- `'my message'` is determined by comparing `message.sender` to the `playerName` prop via the existing `normalizePlayerName` helper — no new identity verification.
- A pending (not-yet-acknowledged) message's timestamp renders as nothing, not a placeholder.
- `GMChatPanel.js` is out of scope for this plan.

---

## Task 1: `formatMessageTime` — pure timestamp formatter

**Files:**

- Create: `src/utils/formatMessageTime.js`
- Create: `src/utils/formatMessageTime.test.js`

**Interfaces:**

- Produces: `formatMessageTime(timestamp) → string | null`, where `timestamp` is a Firestore-shaped object exposing `.toDate(): Date`, or any falsy value (including `null`, `undefined`) for a still-pending write. Consumed by Task 2's `MessageFeed.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/formatMessageTime.test.js`:

```js
import { formatMessageTime } from './formatMessageTime';

describe('formatMessageTime', () => {
    it('formats a Firestore-shaped timestamp as a clock time', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };

        const result = formatMessageTime(timestamp);

        expect(result).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
    });

    it('returns null for a falsy timestamp (pending server ack)', () => {
        expect(formatMessageTime(null)).toBeNull();
        expect(formatMessageTime(undefined)).toBeNull();
    });
});
```

The regex (rather than a hardcoded `"3:45 PM"`) avoids coupling the test to the test runner's default locale — `toLocaleTimeString` is intentionally locale-dependent so real players see times in their own locale's convention, not a hardcoded one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects unit --testPathPattern=formatMessageTime`
Expected: FAIL — `Cannot find module './formatMessageTime'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/formatMessageTime.js`:

```js
// Converts a Firestore Timestamp to a clock-time string ("3:45 PM") for
// display in the player message feed. A still-pending write's
// serverTimestamp() reads as null/undefined locally until the server acks
// it — that renders as no time text at all rather than a placeholder
// (docs/superpowers/specs/2026-08-12-chat-message-bubbles-design.md).
export const formatMessageTime = (timestamp) => {
    if (!timestamp) return null;
    return timestamp.toDate().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects unit --testPathPattern=formatMessageTime`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/formatMessageTime.js src/utils/formatMessageTime.test.js
git commit -m "Add formatMessageTime, a pure Firestore-timestamp-to-clock-time helper"
```

---

## Task 2: `MessageFeed` — sender alignment and timestamps

**Files:**

- Modify: `src/components/player_messages_components/MessageFeed.js`
- Modify: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `formatMessageTime(timestamp)` (Task 1), `normalizePlayerName(name)` (already imported from `../../game/playerNames`).
- Produces: nothing new consumed elsewhere — this is the plan's only integration point.

- [ ] **Step 1: Write the failing tests**

Add `formatMessageTime` to the imports at the top of `src/components/player_messages_components/MessageFeed.test.jsx`:

```jsx
import { formatMessageTime } from '../../utils/formatMessageTime';
```

Add these tests inside the existing `describe('MessageFeed', ...)` block, after the existing `'shows a chat message with its sender'` test:

```jsx
it('right-aligns the current player’s own chat message and omits the sender prefix', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'chat',
                    recipient: null,
                    text: 'be right there',
                    standings: null,
                    mission: null,
                    sender: 'Alice',
                    timestamp: null,
                },
            ]),
        });
        return () => {};
    });

    mountFeed('Alice');

    expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-end' });
    expect(screen.queryByText('Alice:')).not.toBeInTheDocument();
    expect(screen.getByText('be right there')).toBeInTheDocument();
});

it('left-aligns a chat message from someone else', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'chat',
                    recipient: null,
                    text: 'lol where are you',
                    standings: null,
                    mission: null,
                    sender: 'Bob',
                    timestamp: null,
                },
            ]),
        });
        return () => {};
    });

    mountFeed('Alice');

    expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-start' });
});

it('shows a formatted time on a chat message with a resolved timestamp', () => {
    const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'chat',
                    recipient: null,
                    text: 'hi',
                    standings: null,
                    mission: null,
                    sender: 'Bob',
                    timestamp,
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
});

it('shows no time text for a chat message with a pending (null) timestamp', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'chat',
                    recipient: null,
                    text: 'sending this now',
                    standings: null,
                    mission: null,
                    sender: 'Bob',
                    timestamp: null,
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText('sending this now')).toBeInTheDocument();
});

it('shows a formatted time on a leaderboard message', () => {
    const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'leaderboard',
                    recipient: null,
                    text: null,
                    standings: [{ name: 'Alice', score: 30, isAlive: true }],
                    timestamp,
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
});

it('shows a formatted time on a mission message', () => {
    const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
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
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
});

it('shows a formatted time on a broadcast message', () => {
    const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'broadcast',
                    recipient: null,
                    text: 'Game starts soon!',
                    standings: null,
                    timestamp,
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — `getByTestId('chat-message')` finds nothing (no such test id exists yet), and none of the timestamp assertions find any text, since `MessageFeed.js` doesn't render times yet.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/components/player_messages_components/MessageFeed.js` with:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Box, Flex, List, ListItem, Text } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { normalizePlayerName } from '../../game/playerNames';
import { formatMessageTime } from '../../utils/formatMessageTime';

// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins
// (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
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
                const visible = snapshot.docs
                    .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
                    .filter(
                        (message) =>
                            !message.recipient ||
                            normalizePlayerName(message.recipient) === normalizedName
                    );
                setMessages(visible);
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
                {messages.map((message) => {
                    const mission = message.mission ?? {};
                    // Only 'chat' messages have a sender to compare — every
                    // other type (whisper/broadcast/leaderboard/mission) is
                    // GM-authored and has no sender field at all, so this
                    // guards normalizePlayerName from being called on
                    // null/undefined for those
                    // (docs/superpowers/specs/2026-08-12-chat-message-
                    // bubbles-design.md).
                    const isMine =
                        message.sender != null &&
                        normalizePlayerName(message.sender) === normalizePlayerName(playerName);
                    const time = formatMessageTime(message.timestamp);
                    return (
                        <ListItem key={message.id} mb={2}>
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
                                    borderColor={
                                        message.type === 'whisper' ? 'gray.400' : undefined
                                    }
                                    borderRadius="md"
                                    p={2}
                                    display="inline-block"
                                >
                                    <Text as="span">{message.text}</Text>
                                    {time && (
                                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                                            {time}
                                        </Text>
                                    )}
                                </Text>
                            )}
                        </ListItem>
                    );
                })}
            </List>
        </Box>
    );
};

export default MessageFeed;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, all new tests plus every pre-existing `MessageFeed` test (the pre-existing `'shows a chat message with its sender'` test has no `timestamp` field in its fixture, so `time` resolves to `null` and nothing new renders for it — it keeps passing unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Right-align own chat messages and show timestamps across the message feed"
```

---

## Task 3: Full gate

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
git commit -m "Format chat message bubbles files"
```

If nothing was modified, skip this step — there's nothing to commit.
