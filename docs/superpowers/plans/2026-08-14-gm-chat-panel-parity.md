# GM Chat Panel Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `GMChatPanel.js` (the GM console's read-only player-chat view) up to parity with `MessageFeed.js`: add message timestamps and stop remapping the full snapshot on every event.

**Architecture:** Extract a `React.memo`-wrapped `GMChatMessage.js` row component (mirroring `MessageBubble.js`) that renders sender + text + an optional timestamp via the existing `formatMessageTime` helper. Rewire `GMChatPanel.js`'s `onSnapshot` callback to merge `snapshot.docChanges()` via the existing `applyMessageChanges` helper into an unfiltered `allMessages` state, deriving the rendered, `type === 'chat'`-filtered list via `useMemo`. Both helpers and the memoization pattern already exist and are proven in `MessageFeed.js`/`MessageBubble.js` — this is a port, not new design.

**Tech Stack:** React (hooks), Chakra UI, Firebase Firestore client SDK (`onSnapshot`, `docChanges()`), Jest + React Testing Library (jsdom).

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) must pass before any task is considered done.
- TDD: write the failing test first, watch it fail, then implement (per CLAUDE.md).
- Never merge an already-filtered array into `applyMessageChanges` — its `change.newIndex` is a position in the query's full, unfiltered result set. Filter only the derived, rendered `messages` value, never `allMessages` itself.
- No change to `MessageFeed.js`, `MessageBubble.js`, or `applyMessageChanges.js` — reused as-is.
- No change to what messages the GM can see (still `type === 'chat'` only).

---

### Task 1: Extract `GMChatMessage.js` row component

**Files:**

- Create: `src/components/player_messages_components/GMChatMessage.js`
- Create: `src/components/player_messages_components/GMChatMessage.test.jsx`

**Interfaces:**

- Consumes: `formatMessageTime(timestamp)` from `src/utils/formatMessageTime.js` (existing, exported, returns a formatted clock-time string or `null`/falsy for a pending/null timestamp).
- Produces: `GMChatMessage`, default export, `React.memo`-wrapped, props `{ message }` where `message` is `{ id, sender, text, timestamp, type, ... }`. Task 2 renders `<GMChatMessage key={message.id} message={message} />` per item.

- [ ] **Step 1: Write the failing test**

Create `src/components/player_messages_components/GMChatMessage.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * GMChatMessage renders one player chat message for the GM console's
 * read-only chat panel — extracted from GMChatPanel.js and wrapped in
 * React.memo so unchanged messages skip re-rendering when new ones arrive
 * (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
 * No onSnapshot mocking needed — this component doesn't subscribe to
 * anything, it just renders whatever message prop it's given.
 */
import React from 'react';
import { ChakraProvider, List } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import GMChatMessage from './GMChatMessage';
import { formatMessageTime } from '../../utils/formatMessageTime';

const mountMessage = (message) =>
    render(
        <ChakraProvider>
            <List>
                <GMChatMessage message={message} />
            </List>
        </ChakraProvider>
    );

describe('GMChatMessage', () => {
    it('shows a chat message with its sender', () => {
        mountMessage({
            type: 'chat',
            recipient: null,
            text: 'lol where are you',
            sender: 'Bob',
            timestamp: null,
        });

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it('shows a formatted time on a message with a resolved timestamp', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };
        mountMessage({
            type: 'chat',
            recipient: null,
            text: 'hi',
            sender: 'Bob',
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows no time text for a message with a pending (null) timestamp', () => {
        mountMessage({
            type: 'chat',
            recipient: null,
            text: 'sending this now',
            sender: 'Bob',
            timestamp: null,
        });

        expect(screen.getByText('sending this now')).toBeInTheDocument();
        expect(screen.queryByText(/^\d{1,2}:\d{2}/)).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/player_messages_components/GMChatMessage.test.jsx`
Expected: FAIL — `Cannot find module './GMChatMessage'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/player_messages_components/GMChatMessage.js`:

```jsx
import React from 'react';
import { ListItem, Text } from '@chakra-ui/react';
import { formatMessageTime } from '../../utils/formatMessageTime';

// One player chat message's rendering, extracted from GMChatPanel.js and
// wrapped in React.memo so an unchanged message (same object reference,
// preserved by applyMessageChanges) is skipped entirely on re-render — the
// whole point of this split
// (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
const GMChatMessage = ({ message }) => {
    const time = formatMessageTime(message.timestamp);

    return (
        <ListItem mb={1}>
            <Text as="span" fontWeight="bold">
                {message.sender}:
            </Text>{' '}
            <Text as="span">{message.text}</Text>
            {time && (
                <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                    {time}
                </Text>
            )}
        </ListItem>
    );
};

export default React.memo(GMChatMessage);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/player_messages_components/GMChatMessage.test.jsx`
Expected: PASS — 3/3 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass. (`GMChatPanel.js`/`GMChatPanel.test.jsx` are untouched by this task, so the pre-existing `GMChatPanel.test.jsx` suite still passes as-is at this point — Task 2 rewires it.)

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/GMChatMessage.js src/components/player_messages_components/GMChatMessage.test.jsx
git commit -m "Extract GMChatMessage row component with timestamp support"
```

---

### Task 2: Rewire `GMChatPanel.js` to merge via `applyMessageChanges` and render `GMChatMessage`

**Files:**

- Modify: `src/components/player_messages_components/GMChatPanel.js` (full current content below)
- Modify: `src/components/player_messages_components/GMChatPanel.test.jsx` (full current content below)

**Interfaces:**

- Consumes: `applyMessageChanges(previousMessages, docChanges)` from `src/utils/applyMessageChanges.js` (existing, exported, returns a new merged array); `GMChatMessage` from Task 1, default export, props `{ message }`.
- Produces: no new exports — `GMChatPanel` itself keeps its existing default export and `{ roomID }` prop signature.

**Current content of `src/components/player_messages_components/GMChatPanel.js`** (for reference — this is what Step 3 replaces):

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

- [ ] **Step 1: Write the failing test**

Replace the full content of `src/components/player_messages_components/GMChatPanel.test.jsx` with:

```jsx
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/player_messages_components/GMChatPanel.test.jsx`
Expected: FAIL — the current `GMChatPanel.js` reads `snapshot.docs`, which is `undefined` on these new `{ docChanges: () => [...] }` fixtures, so `snapshot.docs.map` throws (`Cannot read properties of undefined (reading 'map')`) in every test that delivers a snapshot.

- [ ] **Step 3: Write the implementation**

Replace the full content of `src/components/player_messages_components/GMChatPanel.js` with:

```jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, List } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { applyMessageChanges } from '../../utils/applyMessageChanges';
import GMChatMessage from './GMChatMessage';

// Read-only view of the players' group chat, for the GM console — a
// separate panel from the GM's own game-event Logs (different collection,
// different purpose), so the GM isn't blind to player banter
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
//
// Merges via docChanges() rather than remapping the full snapshot.docs
// every time, so a message untouched by a given snapshot keeps its exact
// object reference — what lets GMChatMessage's React.memo skip
// re-rendering messages that haven't changed
// (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
const GMChatPanel = ({ roomID }) => {
    const [allMessages, setAllMessages] = useState([]);
    const chatBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID) return undefined;
        setAllMessages([]);
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                setAllMessages((previous) => applyMessageChanges(previous, snapshot.docChanges()));
            },
            (error) => {
                console.error('Error watching player chat:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID]);

    // allMessages stays unfiltered — applyMessageChanges' newIndex is a
    // position in the query's full result set, so filtering before storing
    // would corrupt future merges. messages (below) is the filtered,
    // rendered view.
    const messages = useMemo(
        () => allMessages.filter((message) => message.type === 'chat'),
        [allMessages]
    );

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
                    <GMChatMessage key={message.id} message={message} />
                ))}
            </List>
        </Box>
    );
};

export default GMChatPanel;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/player_messages_components/GMChatPanel.test.jsx`
Expected: PASS — 5/5 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/GMChatPanel.js src/components/player_messages_components/GMChatPanel.test.jsx
git commit -m "Merge GM chat panel updates via docChanges instead of full-snapshot remap"
```

---

## Self-Review Notes

- **Spec coverage:** Item 45 (timestamps) is covered by `GMChatMessage.js`'s `formatMessageTime` usage (Task 1). Item 46 (render efficiency) is covered by `GMChatPanel.js`'s `applyMessageChanges`/`useMemo`/`GMChatMessage` rewiring (Task 2). The spec's "own file for the row component" decision is Task 1's deliverable. The spec's "filter after merge, never merge an already-filtered array" constraint is implemented exactly as `MessageFeed.js` does it and stated in Global Constraints.
- **Placeholder scan:** none — every step has complete, concrete code.
- **Type consistency:** `GMChatMessage` accepts `{ message }` in both Task 1 (definition) and Task 2 (usage). `applyMessageChanges(previousMessages, docChanges)` signature matches its existing implementation, unchanged.
