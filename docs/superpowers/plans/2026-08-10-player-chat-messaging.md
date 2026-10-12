# Player chat/messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's phone shows a live, scrolling feed of the GM's `/whisper`, `/broadcast`, and `/leaderboard` messages addressed to them, plus a (currently disabled) composer UI — replacing the separate "waiting room" screen with one continuous screen from join to end of game.

**Architecture:** Two new presentational/data components — `MessageFeed` (live `onSnapshot` subscription, client-side filtered, auto-scrolling) and `MessageComposer` (static disabled UI) — live in a new `src/components/player_messages_components/` directory and get mounted into a restructured `src/pages/PlayerGame.js` layout. One new `dbCalls.js` query function feeds `MessageFeed`. No changes to `firestore.rules` (already permits any player-of-the-room to read `playerMessages`) and no changes to `PlayerGame.js`'s existing `gameStarted`/player-doc subscriptions.

**Tech Stack:** React (CRA), Firebase Firestore client SDK (`onSnapshot`), Chakra UI, Jest + React Testing Library (jsdom project), Firebase emulator (integration project).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`).
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js`.
- Never import `dbCalls.js` or `utils/firebase.js` from a unit test; component tests use explicit `jest.mock` factories.
- Write the test first and watch it fail, for every behavioral change.
- Receive only — no message-sending write path in this plan; the composer is disabled, non-functional UI (`docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md`, "Decisions made").
- A whisper is visible only to its addressed recipient (matched via `normalizePlayerName`, `src/game/playerNames.js`); broadcasts and leaderboard sends are visible to everyone. This filtering is client-side, not a security boundary — `firestore.rules` is unchanged.
- The message feed subscription is not gated on `gameStarted` — it starts as soon as `roomID`/`playerName` are known, matching the "no separate waiting-room screen" decision.
- A `MessageFeed` subscription error is logged via `console.error` only — it must never clear the session or navigate away (unlike the room/player-doc subscriptions in `PlayerGame.js`).

---

## Task 1: `fetchPlayerMessagesQueryForRoom` in `dbCalls.js`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/components/firebase_calls/dbCalls.integration.test.js`

**Interfaces:**

- Consumes: `collection`, `query`, `orderBy` (already imported in `dbCalls.js`), `addPlayerMessageForRoom` (already exists, `dbCalls.js:84-87`).
- Produces: `fetchPlayerMessagesQueryForRoom(roomID) → Query`, for Task 3's `MessageFeed` to subscribe to via `onSnapshot`.

This mirrors `fetchLogsQueryByAscendingTimestampForRoom` (`dbCalls.js:53-56`), which has direct integration-test coverage (`dbCalls.integration.test.js:226-268`, the "improvements item 22" describe block) — follow that same precedent here, not the untested doc-ref precedent used for `fetchRoomReferenceForRoom`/`fetchPlayerReferenceForRoom`, since this is a query with ordering semantics worth actually verifying against the real emulator.

- [ ] **Step 1: Write the failing test**

Add to `src/components/firebase_calls/dbCalls.integration.test.js`. First, replace the existing `import { ... } from './dbCalls';` block at the top of the file with (two new names added, keeping the list's existing alphabetical order):

```js
import {
    addLogForRoom,
    addPlayerForRoom,
    addPlayerMessageForRoom,
    endGame,
    fetchAliveRosterForRoom,
    fetchAllPlayersForRoom,
    fetchAssassinsForPlayer,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
    fetchTaskIndexThenIncrement,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from './dbCalls';
```

Then add this new describe block anywhere after the existing `describe('addLogForRoom and fetchLogsQueryByAscendingTimestampForRoom ...)` block:

```js
describe('addPlayerMessageForRoom and fetchPlayerMessagesQueryForRoom', () => {
    it('returns messages in the order they were written', async () => {
        await seedRoom(ROOM, []);

        await addPlayerMessageForRoom(
            { type: 'broadcast', recipient: null, text: 'first', standings: null },
            ROOM
        );
        await addPlayerMessageForRoom(
            { type: 'broadcast', recipient: null, text: 'second', standings: null },
            ROOM
        );

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs.map((docSnapshot) => docSnapshot.data().text)).toEqual([
            'first',
            'second',
        ]);
    });

    it('includes the timestamp field written by addPlayerMessageForRoom', async () => {
        await seedRoom(ROOM, []);

        await addPlayerMessageForRoom(
            { type: 'whisper', recipient: 'Alice', text: 'psst', standings: null },
            ROOM
        );

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs[0].data()).toEqual({
            type: 'whisper',
            recipient: 'Alice',
            text: 'psst',
            standings: null,
            timestamp: expect.anything(),
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:emulator -- --testPathPattern=dbCalls.integration`
Expected: FAIL — `fetchPlayerMessagesQueryForRoom is not a function` (or a similar import error), since it doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Add to `src/components/firebase_calls/dbCalls.js`, immediately after `addPlayerMessageForRoom` (`dbCalls.js:84-87`):

```js
// A query of a room's playerMessages in write order, for onSnapshot — lets
// MessageFeed (src/components/player_messages_components/MessageFeed.js)
// watch incoming /whisper, /broadcast, and /leaderboard messages live.
// Mirrors fetchLogsQueryByAscendingTimestampForRoom's exact shape.
export const fetchPlayerMessagesQueryForRoom = (roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    return query(messagesRef, orderBy('timestamp', 'asc'));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:emulator -- --testPathPattern=dbCalls.integration`
Expected: PASS, both new tests, plus the rest of the file's existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js src/components/firebase_calls/dbCalls.integration.test.js
git commit -m "Add fetchPlayerMessagesQueryForRoom to dbCalls.js"
```

---

## Task 2: `MessageComposer` (disabled placeholder UI)

**Files:**

- Create: `src/components/player_messages_components/MessageComposer.js`
- Create: `src/components/player_messages_components/MessageComposer.test.jsx`

**Interfaces:**

- Consumes: nothing (no props, no Firebase, no data layer).
- Produces: `MessageComposer` (default export, no props), for Task 6 to mount into `PlayerGame.js`.

- [ ] **Step 1: Write the failing test**

Create `src/components/player_messages_components/MessageComposer.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer is pure UI: a disabled text input, a disabled send
 * button, and a disabled photo button. No props, no Firebase, no state —
 * real message-sending and photo submission are separate, not-yet-built
 * features (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import MessageComposer from './MessageComposer';

describe('MessageComposer', () => {
    it('renders a disabled message input', () => {
        render(
            <ChakraProvider>
                <MessageComposer />
            </ChakraProvider>
        );

        expect(screen.getByPlaceholderText('Message coming soon...')).toBeDisabled();
    });

    it('renders a disabled send button', () => {
        render(
            <ChakraProvider>
                <MessageComposer />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('renders a disabled photo button', () => {
        render(
            <ChakraProvider>
                <MessageComposer />
            </ChakraProvider>
        );

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=MessageComposer`
Expected: FAIL — `Cannot find module './MessageComposer'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/player_messages_components/MessageComposer.js`:

```jsx
import React from 'react';
import { Flex, Input, Button } from '@chakra-ui/react';

// Pure UI placeholder — real sending (text and photo) is separate,
// not-yet-built work (docs/superpowers/specs/2026-08-10-player-chat-
// messaging-design.md, "Explicitly out of scope"). No props, no state,
// no Firebase.
const MessageComposer = () => {
    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input placeholder="Message coming soon..." isDisabled mr={2} />
            <Button isDisabled mr={2} aria-label="Send photo">
                📷
            </Button>
            <Button isDisabled colorScheme="teal">
                Send
            </Button>
        </Flex>
    );
};

export default MessageComposer;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=MessageComposer`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageComposer.js src/components/player_messages_components/MessageComposer.test.jsx
git commit -m "Add MessageComposer as a disabled placeholder UI"
```

---

## Task 3: `MessageFeed` — subscribe, filter, render text messages

**Files:**

- Create: `src/components/player_messages_components/MessageFeed.js`
- Create: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `fetchPlayerMessagesQueryForRoom(roomID)` (Task 1), `normalizePlayerName` (`src/game/playerNames.js`, already exists).
- Produces: `MessageFeed` (default export, props `{ roomID, playerName }`), consumed by this same task's tests and extended by Tasks 4-5, then mounted by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `src/components/player_messages_components/MessageFeed.test.jsx`:

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
 * Explicit mock factory for 'firebase/firestore', not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import MessageFeed from './MessageFeed';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));

const asMessageDocs = (messages) => messages.map((message) => ({ data: () => message }));

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
                docs: asMessageDocs([
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
                docs: asMessageDocs([
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
                docs: asMessageDocs([
                    { type: 'whisper', recipient: 'Bob', text: 'Secret for Bob', standings: null },
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
                docs: asMessageDocs([
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — `Cannot find module './MessageFeed'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/player_messages_components/MessageFeed.js`:

```jsx
import React, { useEffect, useState } from 'react';
import { Box, List, ListItem, Text } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { normalizePlayerName } from '../../game/playerNames';

// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins
// (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
const MessageFeed = ({ roomID, playerName }) => {
    const [messages, setMessages] = useState([]);

    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const normalizedName = normalizePlayerName(playerName);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                const visible = snapshot.docs
                    .map((messageDoc) => messageDoc.data())
                    .filter(
                        (message) =>
                            message.recipient === null ||
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

    return (
        <Box flex="1" overflow="auto" p={2} data-testid="message-feed">
            <List styleType="none">
                {messages.map((message, index) => (
                    <ListItem key={index} mb={2}>
                        <Text
                            bg={message.type === 'whisper' ? 'purple.700' : 'gray.700'}
                            borderRadius="md"
                            p={2}
                            display="inline-block"
                        >
                            {message.type === 'whisper' ? '🔒 ' : ''}
                            {message.text}
                        </Text>
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

export default MessageFeed;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Add MessageFeed: live subscription filtered to broadcasts and this player's whispers"
```

---

## Task 4: `MessageFeed` — render leaderboard sends as a standings list

**Files:**

- Modify: `src/components/player_messages_components/MessageFeed.js`
- Modify: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `messages` state from Task 3.
- Produces: nothing new consumed elsewhere — a render-only branch.

- [ ] **Step 1: Write the failing test**

Add to `src/components/player_messages_components/MessageFeed.test.jsx`, inside the `describe('MessageFeed', ...)` block:

```jsx
it('renders a leaderboard message as a standings list, not a text line', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'leaderboard',
                    recipient: null,
                    text: null,
                    standings: [
                        { name: 'Alice', score: 30, isAlive: true },
                        { name: 'Bob', score: 10, isAlive: false },
                    ],
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText('Alice: 30')).toBeInTheDocument();
    expect(screen.getByText('Bob: 10 (eliminated)')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — the current `<Text>{message.text}</Text>` branch renders nothing useful for a `leaderboard` message (`message.text` is `null`), so neither `Alice: 30` nor `Bob: 10 (eliminated)` is found.

- [ ] **Step 3: Implement**

In `src/components/player_messages_components/MessageFeed.js`, replace the `<ListItem>` body:

```jsx
<ListItem key={index} mb={2}>
    <Text
        bg={message.type === 'whisper' ? 'purple.700' : 'gray.700'}
        borderRadius="md"
        p={2}
        display="inline-block"
    >
        {message.type === 'whisper' ? '🔒 ' : ''}
        {message.text}
    </Text>
</ListItem>
```

with:

```jsx
<ListItem key={index} mb={2}>
    {message.type === 'leaderboard' ? (
        <Box bg="gray.700" borderRadius="md" p={2}>
            <Text fontWeight="bold" mb={1}>
                Leaderboard
            </Text>
            <List styleType="none">
                {message.standings.map((entry) => (
                    <ListItem key={entry.name}>
                        {entry.name}: {entry.score}
                        {!entry.isAlive ? ' (eliminated)' : ''}
                    </ListItem>
                ))}
            </List>
        </Box>
    ) : (
        <Text
            bg={message.type === 'whisper' ? 'purple.700' : 'gray.700'}
            borderRadius="md"
            p={2}
            display="inline-block"
        >
            {message.type === 'whisper' ? '🔒 ' : ''}
            {message.text}
        </Text>
    )}
</ListItem>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, new test plus all 5 from Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Render leaderboard messages as a standings list in MessageFeed"
```

---

## Task 5: `MessageFeed` — auto-scroll to the newest message

**Files:**

- Modify: `src/components/player_messages_components/MessageFeed.js`
- Modify: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `messages` state from Task 3.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Add to `src/components/player_messages_components/MessageFeed.test.jsx`, add `act` to the existing `import { render, screen } from '@testing-library/react';` line (`import { act, render, screen } from '@testing-library/react';`), and add this test inside the `describe('MessageFeed', ...)` block:

```jsx
it('scrolls to the bottom whenever a new message arrives', async () => {
    let deliverMessages;
    onSnapshot.mockImplementation((query, onNext) => {
        deliverMessages = onNext;
        onNext({ docs: [] });
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
            docs: asMessageDocs([
                { type: 'broadcast', recipient: null, text: 'New message', standings: null },
            ]),
        });
    });

    expect(feedBox.scrollTop).toBe(500);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — `feedBox.scrollTop` is still `0`, nothing sets it yet.

- [ ] **Step 3: Implement**

In `src/components/player_messages_components/MessageFeed.js`:

Add `useRef` to the React import:

```jsx
import React, { useEffect, useRef, useState } from 'react';
```

Add a ref alongside the existing state:

```jsx
const [messages, setMessages] = useState([]);
const feedBoxRef = useRef(null);
```

Add a new effect after the existing subscription `useEffect`:

```jsx
// Keeps the feed pinned to the newest message as it grows, matching the
// same pattern already built for the GM's log panel
// (GameMasterView.js's logsBoxRef).
useEffect(() => {
    const feedBox = feedBoxRef.current;
    if (!feedBox) return;
    feedBox.scrollTop = feedBox.scrollHeight;
}, [messages]);
```

Add the ref to the JSX:

```jsx
<Box flex="1" overflow="auto" p={2} ref={feedBoxRef} data-testid="message-feed">
```

(replaces `<Box flex="1" overflow="auto" p={2} data-testid="message-feed">`)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Confirm the auto-scroll test is a real check, not a vacuous pass**

Temporarily comment out the scroll-setting line (`feedBox.scrollTop = feedBox.scrollHeight;`) in the new effect, rerun:

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL on `scrolls to the bottom whenever a new message arrives` — `Expected: 500, Received: 0`, proving the test actually catches a missing auto-scroll.

Restore the line and rerun to confirm all 7 tests pass again.

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Auto-scroll MessageFeed to the newest message"
```

---

## Task 6: Restructure `PlayerGame.js` around the chat feed

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `MessageFeed` (Tasks 3-5, props `{ roomID, playerName }`), `MessageComposer` (Task 2, no props).
- Produces: nothing new consumed elsewhere — this is the plan's final integration point.

- [ ] **Step 1: Write the failing test**

In `src/pages/PlayerGame.test.jsx`, add stub mocks for the two new components right after the existing `jest.mock('../components/firebase_calls/dbCalls', ...)` block:

```jsx
// Stubbed — each has its own thorough test file (MessageFeed.test.jsx,
// MessageComposer.test.jsx). This file stays focused on PlayerGame's own
// status-line logic and on wiring MessageFeed's props, not re-testing
// MessageFeed's internals — same reasoning GameMasterView.test.jsx stubs
// ChatInput.
jest.mock('../components/player_messages_components/MessageFeed', () => (props) => (
    <div>
        message-feed-stub roomID={props.roomID} playerName={props.playerName}
    </div>
));
jest.mock('../components/player_messages_components/MessageComposer', () => () => (
    <div>message-composer-stub</div>
));
```

Add this test inside the `describe('PlayerGame', ...)` block:

```jsx
it('mounts the message feed even before the game has started', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: false }) });
        }
        return () => {};
    });

    renderWaiting();

    expect(screen.getByText(/message-feed-stub/)).toBeInTheDocument();
    expect(screen.getByText('message-composer-stub')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: FAIL — `message-feed-stub` and `message-composer-stub` are not found, since `PlayerGame.js` doesn't render either component yet.

- [ ] **Step 3: Implement**

In `src/pages/PlayerGame.js`, add the two imports after the existing `playerSession` import:

```jsx
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';
```

Replace the entire `return (...)` block with:

```jsx
return (
    <Flex height="100vh" direction="column" p={4}>
        <Flex justifyContent="space-between" alignItems="center" mb={2}>
            <Heading size="md">
                {playerName || 'You'} joined {roomID}
            </Heading>
            <Button size="sm" colorScheme="red" variant="outline" onClick={handleLeave}>
                Leave
            </Button>
        </Flex>
        {!gameStarted && <Text mb={4}>Waiting for the host to start...</Text>}
        {gameStarted && playerData?.isAlive && (
            <Text mb={4}>
                {(playerData.targets ?? []).length > 0
                    ? `Your target: ${(playerData.targets ?? []).join(', ')}`
                    : 'Waiting for your target...'}
            </Text>
        )}
        {gameStarted && playerData && !playerData.isAlive && (
            <>
                <Heading size="md" mb={2}>
                    You&apos;ve been eliminated
                </Heading>
                <Text mb={4}>You may be revived if the host assigns you a revival mission.</Text>
            </>
        )}
        <MessageFeed roomID={roomID} playerName={playerName} />
        <MessageComposer />
    </Flex>
);
```

This replaces the previous centered single-column `<Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>` layout (Leave button was previously centered below the status text, at the bottom of that same `Flex`) — no other logic in this file changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, all pre-existing `PlayerGame` tests (unaffected — they assert on text content, not layout) plus the new test.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Mount the chat feed and composer into PlayerGame, always visible"
```

---

## Task 7: Docs and final gate

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/testing.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — documentation only.

- [ ] **Step 1: Update `docs/architecture.md`**

Change the routes table row (`docs/architecture.md:89`):

```
| `/rooms/:roomID/waiting`        | `PlayerGame`     | Continuous post-join screen: status line (waiting/target/eliminated) plus a live chat feed of GM messages | ✅      |
```

Update the `playerMessages` paragraph (`docs/architecture.md:40-46`, the "two collaborators" section) — change "but never read by anything in this repository either" to note that `MessageFeed` (`src/components/player_messages_components/MessageFeed.js`) now reads it, filtered client-side to what each player should see. Keep the rest of that paragraph's content about `photos` remaining unread/unwritten — only the `playerMessages` half of the claim changes.

- [ ] **Step 2: Update `docs/data-model.md`**

In the `## rooms/{roomID}/playerMessages/{autoId}` section (`docs/data-model.md:219-228`), change "Nothing in this repository reads a `playerMessages` document; today this collection has a writer (`dbCalls.addPlayerMessageForRoom`) but no reader at all, except manual inspection." to note that `MessageFeed.js` now reads it via `fetchPlayerMessagesQueryForRoom`, filtering to broadcasts/leaderboard sends and whispers addressed to the subscribing player.

- [ ] **Step 3: Update `docs/testing.md`**

Run the real suite and copy its actual output — do not hand-type or estimate:

```bash
npx jest --selectProjects unit dom
npm run test:emulator
```

Update the illustrative `$ npm test` block and the module table (adding rows for `MessageFeed.test.jsx` and `MessageComposer.test.jsx`, and noting the two new `dbCalls.integration.test.js` cases) with this run's real counts, and update the total suite/test counts shown in the doc to match.

- [ ] **Step 4: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run test:emulator
npm run build
```

Expected: all succeed with zero warnings/errors.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/data-model.md docs/testing.md
git commit -m "Document player chat/messaging"
```
