# Chat send functionality and feed efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players can actually send group-chat messages (visible to everyone in the room, including the GM), and the message feed stops re-fetching/re-rendering its entire history on every new message.

**Architecture:** A new `'chat'` `playerMessages` type with a `sender` field, writable by any player of the room (not just the GM) via a narrowly-scoped `firestore.rules` grant. `fetchPlayerMessagesQueryForRoom` gets a `limitToLast(50)` bound, fixing the unbounded-history problem for every consumer at once. `MessageComposer.js` becomes functional; `MessageFeed.js` gets a new render branch for `'chat'` messages; a new `GMChatPanel.js` (read-only, GM-side) mirrors `MessageFeed.js`'s subscription pattern, filtered to `'chat'` only, mounted into `GameMasterView.js`.

**Tech Stack:** React (CRA), Firebase Firestore client SDK (`onSnapshot`, security rules), Chakra UI, Jest + React Testing Library (jsdom project), Firebase emulator (integration + rules projects).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`); tasks touching `firestore.rules` also need `npm run test:rules`, and tasks touching `dbCalls.js` integration coverage also need `npm run test:emulator`.
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js`.
- Never import `dbCalls.js` or `utils/firebase.js` from a unit test; component tests use explicit `jest.mock` factories.
- Write the test first and watch it fail, for every behavioral change.
- Group chat, not player-to-GM — every `'chat'` message has `recipient: null`, visible to everyone in the room.
- `sender` is client-trusted, not verified against the writer's real identity in `firestore.rules` — matches this app's existing pattern for player-provided display names (`docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md`, "Decisions made").
- A player may only create a `'chat'`-type, `recipient: null` `playerMessages` document — not `'whisper'`/`'broadcast'`/`'leaderboard'`/`'mission'`, which stay GM-only.
- The photo button in `MessageComposer.js` stays disabled — out of scope, a separate future sub-project.
- No message editing/deletion, no rate-limiting/moderation, no GM reply-into-chat in this plan.

---

## Task 1: `firestore.rules` — players can create `'chat'` messages

**Files:**

- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Consumes: `isPlayerOfRoom(roomId)` (already exists, `firestore.rules:56-61`).
- Produces: a player-write grant on `playerMessages`, consumed by Task 2's `addChatMessageForRoom` in production (not directly by later tasks' code, but later tasks assume this grant exists).

- [ ] **Step 1: Write the failing tests**

In `test/firestore.rules.test.js`, rename the `playerMessages` describe block (currently titled `'rooms/{roomId}/playerMessages/{messageId} (interim: host-only write, see firestore.rules comment)'`, at line 373) to `'rooms/{roomId}/playerMessages/{messageId}'` — the "interim: host-only write" framing is no longer accurate. Add these three tests inside that same describe block, after the existing `'allows the host to write'` test:

```js
it('allows a player to create a chat message with a null recipient', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(
        addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
            type: 'chat',
            recipient: null,
            text: 'hey where are you',
            standings: null,
            mission: null,
            sender: 'bob',
        })
    );
});

it('denies a player creating a chat message with a non-null recipient', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
            type: 'chat',
            recipient: 'alice',
            text: 'psst',
            standings: null,
            mission: null,
            sender: 'bob',
        })
    );
});

it('denies a player creating a non-chat message, e.g. a fake broadcast', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
            type: 'broadcast',
            recipient: null,
            text: 'fake broadcast',
            standings: null,
        })
    );
});
```

`PLAYER_UID` is already seeded as a joined player of `room-a` (`test/firestore.rules.test.js:76`) and as the `uid` on player doc `bob` (`:82-86`) — no new seed data needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — the first new test fails (`assertSucceeds` receives a permission-denied rejection), since no player-write grant exists yet. The second and third tests pass vacuously at this point (a player can't create anything yet, so denial is already true for the wrong reason) — that's expected; Step 5 will make them meaningful.

- [ ] **Step 3: Write minimal implementation**

In `firestore.rules`, replace the `playerMessages` match block (`:111-115`):

```
// Interim scope, same reasoning as photos above — see file header.
match /playerMessages/{messageId} {
  allow read: if isHostOrPlayerOfRoom(roomId);
  allow write: if isHostOfExistingRoom(roomId);
}
```

with:

```
// Interim scope, same reasoning as photos above — see file header.
match /playerMessages/{messageId} {
  allow read: if isHostOrPlayerOfRoom(roomId);
  allow write: if isHostOfExistingRoom(roomId);
  // Lets a player post a group-chat message without general write access
  // to this collection — scoped narrowly to the 'chat' type with a null
  // recipient so a player can't spoof a whisper/broadcast/leaderboard/
  // mission message
  // (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
  allow create: if isPlayerOfRoom(roomId) &&
    request.resource.data.type == 'chat' &&
    request.resource.data.recipient == null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS, all 3 new tests, plus every pre-existing rules test.

- [ ] **Step 5: Confirm the two denial tests are real checks, not vacuous passes**

Temporarily change the new rule's condition from `request.resource.data.type == 'chat'` to `true` (i.e. `allow create: if isPlayerOfRoom(roomId) && true && request.resource.data.recipient == null;`), rerun:

Run: `npm run test:rules`
Expected: the `'denies a player creating a non-chat message, e.g. a fake broadcast'` test now FAILS (the fake broadcast succeeds), proving that test is a real check.

Restore the condition to `request.resource.data.type == 'chat'`. Then temporarily change `request.resource.data.recipient == null` to `true`, rerun — the `'denies a player creating a chat message with a non-null recipient'` test should now FAIL. Restore the condition. Rerun once more to confirm all rules tests pass again.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules test/firestore.rules.test.js
git commit -m "Let players write group-chat messages to playerMessages"
```

---

## Task 2: `dbCalls.js` — bound the query and add the chat write function

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/components/firebase_calls/dbCalls.integration.test.js`

**Interfaces:**

- Consumes: `collection`, `query`, `orderBy`, `addDoc`, `serverTimestamp` (already imported).
- Produces: `fetchPlayerMessagesQueryForRoom(roomID)` now returns a bounded query (same signature, same callers — Tasks 4/5 consume it unchanged); `addChatMessageForRoom(text, sender, roomID) → Promise<void>`, consumed by Task 3's `MessageComposer`.

- [ ] **Step 1: Write the failing tests**

In `src/components/firebase_calls/dbCalls.integration.test.js`, add `addChatMessageForRoom` to the existing `import { ... } from './dbCalls';` block, keeping alphabetical order (it sorts before `addLogForRoom`):

```js
import {
    addChatMessageForRoom,
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

Add this new describe block anywhere after the existing `describe('addPlayerMessageForRoom and fetchPlayerMessagesQueryForRoom', ...)` block:

```js
describe('addChatMessageForRoom and the limitToLast(50) bound', () => {
    it('writes a chat message with the correct shape', async () => {
        await seedRoom(ROOM, []);

        await addChatMessageForRoom('hey where are you', 'Alice', ROOM);

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(1);
        expect(snapshot.docs[0].data()).toEqual({
            type: 'chat',
            recipient: null,
            text: 'hey where are you',
            standings: null,
            mission: null,
            sender: 'Alice',
            timestamp: expect.anything(),
        });
    });

    it('bounds fetchPlayerMessagesQueryForRoom to the newest 50 messages when more than 50 exist', async () => {
        await seedRoom(ROOM, []);

        for (let i = 0; i < 51; i++) {
            await addChatMessageForRoom(`msg-${i}`, 'Alice', ROOM);
        }

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(50);
        const texts = snapshot.docs.map((docSnapshot) => docSnapshot.data().text);
        expect(texts).not.toContain('msg-0');
        expect(texts[texts.length - 1]).toBe('msg-50');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:emulator -- --testPathPattern=dbCalls.integration`
Expected: FAIL — `addChatMessageForRoom is not a function` (or a similar import error), since it doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/components/firebase_calls/dbCalls.js`, add `limitToLast` to the existing `firebase/firestore` import block (`:2-17`):

```js
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    updateDoc,
    addDoc,
    orderBy,
    limitToLast,
    deleteDoc,
    arrayUnion,
    runTransaction,
    increment,
    serverTimestamp,
} from 'firebase/firestore';
```

Replace `fetchPlayerMessagesQueryForRoom`:

```js
// A query of a room's playerMessages in write order, for onSnapshot — lets
// MessageFeed and GMChatPanel watch incoming messages live. Bounded to the
// newest 50 with limitToLast (not limit, which would return the OLDEST 50
// instead) — without this, every subscriber re-fetches and re-renders the
// entire message history on every single new message, which gets
// significantly worse once players are chatting live instead of
// occasionally receiving a GM broadcast
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
export const fetchPlayerMessagesQueryForRoom = (roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    return query(messagesRef, orderBy('timestamp', 'asc'), limitToLast(50));
};
```

Add `addChatMessageForRoom` immediately after `fetchPlayerMessagesQueryForRoom`:

```js
// Player-authored group chat — a distinct, purpose-named write from
// addPlayerMessageForRoom (which the GM's own commands use), matching
// this file's convention of one function per logical write. sender is the
// writing player's display name, client-trusted like every other
// player-provided name in this file
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
export const addChatMessageForRoom = async (text, sender, roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    await addDoc(messagesRef, {
        type: 'chat',
        recipient: null,
        text,
        standings: null,
        mission: null,
        sender,
        timestamp: serverTimestamp(),
    });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:emulator -- --testPathPattern=dbCalls.integration`
Expected: PASS, both new tests, plus every other test in this file (the two pre-existing `fetchPlayerMessagesQueryForRoom` tests each write only 1-2 messages, well under the new 50-message bound, so they're unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js src/components/firebase_calls/dbCalls.integration.test.js
git commit -m "Bound the player-messages query and add addChatMessageForRoom"
```

---

## Task 3: `MessageComposer` — make sending actually work

**Files:**

- Modify: `src/components/player_messages_components/MessageComposer.js`
- Modify: `src/components/player_messages_components/MessageComposer.test.jsx`

**Interfaces:**

- Consumes: `addChatMessageForRoom(text, sender, roomID)` (Task 2).
- Produces: `MessageComposer` (default export, props `{ roomID, playerName }`), for Task 6 to mount with updated props (it's already mounted by `PlayerGame.js` with no props today — that call site needs no change here, since `PlayerGame.js` already renders `<MessageComposer />` inside the same component that has `roomID`/`playerName` in scope from its own props/state, per `docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md`; adding the two props to that existing JSX call is included in this task).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/components/player_messages_components/MessageComposer.test.jsx` with:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
 * The photo button stays disabled — kill-photo submission is a separate,
 * not-yet-built sub-project.
 *
 * Explicit mock factory for dbCalls.js, not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
}));

const mountComposer = () =>
    render(
        <ChakraProvider>
            <MessageComposer roomID="room-a" playerName="Alice" />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    addChatMessageForRoom.mockResolvedValue(undefined);
});

describe('MessageComposer', () => {
    it('renders an enabled message input and Send button', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('renders a disabled photo button', () => {
        mountComposer();

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('sends the typed message when Send is clicked', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hey where are you');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(addChatMessageForRoom).toHaveBeenCalledWith('hey where are you', 'Alice', 'room-a');
    });

    it('sends the typed message when Enter is pressed', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        expect(addChatMessageForRoom).toHaveBeenCalledWith('hi', 'Alice', 'room-a');
    });

    it('clears the input after sending', async () => {
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        expect(input).toHaveValue('');
    });

    it('does not send a blank or whitespace-only message', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), '   {Enter}');

        expect(addChatMessageForRoom).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=MessageComposer`
Expected: FAIL — the current component renders everything disabled with the old placeholder text `"Message coming soon..."`, so `getByPlaceholderText('Type a message...')` finds nothing, and nothing is enabled.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/components/player_messages_components/MessageComposer.js` with:

```jsx
import React, { useState } from 'react';
import { Flex, Input, Button } from '@chakra-ui/react';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';

// Sends player-authored group-chat messages
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
// The photo button stays disabled — kill-photo submission is a separate,
// not-yet-built sub-project.
const MessageComposer = ({ roomID, playerName }) => {
    const [text, setText] = useState('');

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        try {
            await addChatMessageForRoom(trimmed, playerName, roomID);
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching MessageFeed's own subscription-error handling —
            // log only, no toast/alert plumbing in this simple composer.
            console.error('Error sending chat message:', error);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            handleSend();
        }
    };

    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input
                placeholder="Type a message..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                mr={2}
            />
            <Button isDisabled mr={2} aria-label="Send photo">
                📷
            </Button>
            <Button onClick={handleSend} colorScheme="teal">
                Send
            </Button>
        </Flex>
    );
};

export default MessageComposer;
```

In `src/pages/PlayerGame.js:118-119`, replace:

```jsx
            <MessageFeed roomID={roomID} playerName={playerName} />
            <MessageComposer />
```

with:

```jsx
            <MessageFeed roomID={roomID} playerName={playerName} />
            <MessageComposer roomID={roomID} playerName={playerName} />
```

`roomID` and `playerName` are already in scope in this file (`:16`, `:21`) and passed to `MessageFeed` the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=MessageComposer`
Expected: PASS, all 6 tests.

Then run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, all pre-existing `PlayerGame` tests still pass (they stub `MessageComposer` entirely, so the new required prop doesn't affect them — but confirm this for real rather than assuming).

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageComposer.js src/components/player_messages_components/MessageComposer.test.jsx src/pages/PlayerGame.js
git commit -m "Make MessageComposer send real group-chat messages"
```

---

## Task 4: `MessageFeed` — render `'chat'` messages with their sender

**Files:**

- Modify: `src/components/player_messages_components/MessageFeed.js`
- Modify: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `messages` state (existing).
- Produces: nothing new consumed elsewhere — a render-only branch, sibling to the existing `'leaderboard'`/`'mission'` branches.

- [ ] **Step 1: Write the failing test**

Add to `src/components/player_messages_components/MessageFeed.test.jsx`, inside the `describe('MessageFeed', ...)` block:

```jsx
it('shows a chat message with its sender', () => {
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
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText('Bob:')).toBeInTheDocument();
    expect(screen.getByText('lol where are you')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — a `'chat'`-type message currently falls into the default (whisper/broadcast) branch and renders `message.text` alone with no sender name, so `getByText('Bob:')` finds nothing.

- [ ] **Step 3: Implement**

In `src/components/player_messages_components/MessageFeed.js`, insert a new branch between the `'mission'` branch and the final default branch — replace:

```jsx
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
                                </Text>
                            )}
```

with:

```jsx
                            ) : message.type === 'chat' ? (
                                <Text bg="blue.900" borderRadius="md" p={2} display="inline-block">
                                    <Text as="span" fontWeight="bold">
                                        {message.sender}:
                                    </Text>{' '}
                                    <Text as="span">{message.text}</Text>
                                </Text>
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
                                </Text>
                            )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, the new test plus all 9 pre-existing `MessageFeed` tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Render chat messages with their sender in MessageFeed"
```

---

## Task 5: `GMChatPanel` — read-only group chat view for the GM

**Files:**

- Create: `src/components/player_messages_components/GMChatPanel.js`
- Create: `src/components/player_messages_components/GMChatPanel.test.jsx`

**Interfaces:**

- Consumes: `fetchPlayerMessagesQueryForRoom(roomID)` (Task 2, already bounded).
- Produces: `GMChatPanel` (default export, props `{ roomID }`), for Task 6 to mount into `GameMasterView.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/player_messages_components/GMChatPanel.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Read-only view of the players' group chat, for the GM console — a
 * separate panel from the GM's own game-event Logs (different collection,
 * different purpose)
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
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

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));

const asMessageDocs = (messages) =>
    messages.map((message, index) => ({ id: `message-${index}`, data: () => message }));

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
                docs: asMessageDocs([
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
                docs: asMessageDocs([
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
            onNext({ docs: [] });
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
                docs: asMessageDocs([
                    { type: 'chat', recipient: null, text: 'new message', sender: 'Bob' },
                ]),
            });
        });

        expect(panel.scrollTop).toBe(500);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=GMChatPanel`
Expected: FAIL — `Cannot find module './GMChatPanel'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/player_messages_components/GMChatPanel.js`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Box, List, ListItem, Text } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';

// Read-only view of the players' group chat, for the GM console — a
// separate panel from the GM's own game-event Logs (different collection,
// different purpose), so the GM isn't blind to player banter
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
const GMChatPanel = ({ roomID }) => {
    const [messages, setMessages] = useState([]);
    const chatBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID) return undefined;
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                const chatMessages = snapshot.docs
                    .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
                    .filter((message) => message.type === 'chat');
                setMessages(chatMessages);
            },
            (error) => {
                console.error('Error watching player chat:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID]);

    // Same auto-scroll pattern as MessageFeed.js and GameMasterView.js's
    // logsBoxRef.
    useEffect(() => {
        const chatBox = chatBoxRef.current;
        if (!chatBox) return;
        chatBox.scrollTop = chatBox.scrollHeight;
    }, [messages]);

    return (
        <Box flex="1" overflow="auto" p={2} ref={chatBoxRef} data-testid="gm-chat-panel">
            <List styleType="none">
                {messages.map((message) => (
                    <ListItem key={message.id} mb={1}>
                        <Text as="span" fontWeight="bold">
                            {message.sender}:
                        </Text>{' '}
                        <Text as="span">{message.text}</Text>
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

export default GMChatPanel;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=GMChatPanel`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Confirm the auto-scroll test is a real check, not a vacuous pass**

Temporarily comment out the scroll-setting line (`chatBox.scrollTop = chatBox.scrollHeight;`) in the second `useEffect`, rerun:

Run: `npx jest --selectProjects dom --testPathPattern=GMChatPanel`
Expected: FAIL on `'scrolls to the bottom whenever a new message arrives'` — `Expected: 500, Received: 0`.

Restore the line and rerun to confirm all 4 tests pass again.

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/GMChatPanel.js src/components/player_messages_components/GMChatPanel.test.jsx
git commit -m "Add GMChatPanel: read-only group chat view for the GM"
```

---

## Task 6: Mount `GMChatPanel` into `GameMasterView`

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `GMChatPanel` (Task 5, props `{ roomID }`).
- Produces: nothing new consumed elsewhere — this is the plan's final integration point.

- [ ] **Step 1: Write the failing test**

In `src/pages/GameMasterView.test.jsx`, add a stub mock for the new component right after the existing `PhotosDisplay` mock:

```jsx
jest.mock('../components/player_messages_components/GMChatPanel', () => (props) => (
    <div>gm-chat-panel-stub roomID={props.roomID}</div>
));
```

Add this test inside a `describe` block (a new one, e.g. `describe('the GM chat panel', ...)`, placed after the existing `describe("isGameActive is read, not just written ...")` block):

```jsx
describe('the GM chat panel', () => {
    it('mounts with the current room ID', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        expect(await screen.findByText('gm-chat-panel-stub roomID=room-a')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: FAIL — `GMChatPanel` isn't imported or rendered in `GameMasterView.js` yet.

- [ ] **Step 3: Implement**

In `src/pages/GameMasterView.js`, add the import after the existing `PhotosDisplay` import (`:23`):

```js
import PhotosDisplay from '../components/photos_display_component/PhotosDisplay';
import GMChatPanel from '../components/player_messages_components/GMChatPanel';
```

Replace the `rightHandStack` JSX (`:277-283`):

```jsx
<executionContext.Provider value={executionContextProviderValues}>
    <VStack sx={styles.rightHandStack}>
        <Box sx={styles.photosBox}>
            <PhotosDisplay />
        </Box>
    </VStack>
</executionContext.Provider>
```

with:

```jsx
<executionContext.Provider value={executionContextProviderValues}>
    <VStack sx={styles.rightHandStack}>
        <Box sx={styles.photosBox}>
            <PhotosDisplay />
        </Box>
        <Box sx={styles.chatPanelWrapper}>
            <Heading sx={styles.chatHeaderText}>Player Chat</Heading>
            <Divider />
            <GMChatPanel roomID={roomID} />
        </Box>
    </VStack>
</executionContext.Provider>
```

`GMChatPanel` doesn't need `executionContext` — it only reads `roomID`, already in scope in `GameMasterView` — but it's fine to sit inside the existing `executionContext.Provider` wrapper alongside `PhotosDisplay`; nothing about that provider affects it.

In the `styles` object at the bottom of the file, change `photosBox`'s height and add a new `chatPanelWrapper` entry — replace:

```js
    photosBox: {
        w: { base: '100%', md: '100%' },
        // PhotosDisplay is the only child of rightHandStack again — the
        // mission panel that used to share this space moved into on-demand
        // modals instead (docs/superpowers/specs/2026-08-04-mission-modal-
        // ui-design.md), so there's no sibling to split height with anymore.
        h: '100%',
    },
```

with:

```js
    photosBox: {
        w: { base: '100%', md: '100%' },
        // PhotosDisplay shares rightHandStack with the new GM chat panel
        // below (docs/superpowers/specs/2026-08-12-chat-send-and-
        // efficiency-design.md) — no longer the sole child.
        h: '58%',
    },
    chatPanelWrapper: {
        w: '100%',
        h: '35%',
        mt: '8px',
        borderWidth: '2px',
        borderRadius: '2xl',
        p: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: PASS, the new test plus every pre-existing `GameMasterView` test.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Mount GMChatPanel into GameMasterView"
```

---

## Task 7: Docs and final gate

**Files:**

- Modify: `docs/data-model.md`
- Modify: `docs/testing.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — documentation only.

- [ ] **Step 1: Update `docs/data-model.md`**

Find the `## rooms/{roomID}/playerMessages/{autoId}` section's field table (currently listing `type`, `recipient`, `text`, `standings`, `mission`, `timestamp`). Update the `type` row's enumerated values to include `'chat'`, and add a `sender` row:

| Field    | Type             | Notes                                                                                                                                                                                                                                                        |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sender` | `string \| null` | The display name of the player who sent a `'chat'` message. `null`/absent for every other `type`. Client-provided, not verified against the writer's real identity in `firestore.rules` — matches this app's existing trust level for player-provided names. |

Also add a sentence noting that `firestore.rules` now grants players (not just the host) write access to this collection, scoped to `'chat'`-type, `recipient: null` documents.

- [ ] **Step 2: Update `docs/testing.md`**

Run the real suites and copy their actual output — do not hand-type or estimate:

```bash
npx jest --selectProjects unit dom
npm run test:emulator
npm run test:rules
```

Update the illustrative `$ npm test` block, the module table (adding rows for `GMChatPanel.test.jsx`; updating `MessageComposer.test.jsx`'s description, since it's no longer "always disabled"; updating `MessageFeed.test.jsx`'s description to mention chat rendering; updating `dbCalls.integration.test.js`'s and `test/firestore.rules.test.js`'s counts) with these runs' real counts, and update the doc's total suite/test counts (both the unit+dom total and the separate emulator/rules totals) to match.

- [ ] **Step 3: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run test:emulator
npm run test:rules
npm run build
```

Expected: all succeed with zero warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add docs/data-model.md docs/testing.md
git commit -m "Document chat send functionality and feed efficiency"
```
