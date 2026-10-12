# GM Chat Panel Parity Design

**Date:** 2026-08-14
**Status:** Approved

## Problem

`GMChatPanel.js` (the GM console's read-only view of player chat) has fallen
behind `MessageFeed.js` (the player-facing chat view) in two ways tracked in
`docs/improvements.md`:

- **Item 45:** `GMChatPanel.js` renders `sender: text` with no timestamp.
  `MessageFeed.js` gained timestamps in the 2026-08-12 chat-message-bubbles
  feature via `src/utils/formatMessageTime.js`.
- **Item 46:** `GMChatPanel.js`'s `onSnapshot` callback does
  `snapshot.docs.map(...).filter(...)` on every event — a full remap that
  creates brand-new message objects every time, defeating any memoization.
  `MessageFeed.js` fixed the equivalent problem in the 2026-08-12
  message-feed-render-perf feature by merging `snapshot.docChanges()` via
  `src/utils/applyMessageChanges.js` into an unfiltered state, deriving the
  filtered/rendered list via `useMemo`, and rendering through a
  `React.memo`-wrapped row component (`MessageBubble.js`) that skips
  re-rendering messages whose reference didn't change.

Both items name the exact fix and the exact prior-art files to reuse. This
is a port of an already-proven pattern, not new design territory.

## Decisions

**Combined change.** Both items touch the same file, and the fix for #46
(extracting a memoized row component) is the same work needed to add a
timestamp to that row for #45. Building them separately would mean
extracting the row component twice. One spec, one plan, one change.

**New file for the row component: `GMChatMessage.js`.** Mirrors the
`MessageBubble.js` precedent — a dedicated, independently testable,
`React.memo`-wrapped component — even though `GMChatMessage` only ever
renders one shape (sender + text + time), unlike `MessageBubble.js`'s four
branches (chat/leaderboard/mission/whisper). Keeps `GMChatPanel.js` focused
on subscription/state and matches the just-established codebase pattern
rather than mixing concerns back into one file.

## Architecture & data flow

`GMChatPanel.js`'s `onSnapshot` success callback changes from:

```js
const chatMessages = snapshot.docs
    .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() }))
    .filter((message) => message.type === 'chat');
setMessages(chatMessages);
```

to a merge into a new unfiltered `allMessages` state:

```js
setAllMessages((previous) => applyMessageChanges(previous, snapshot.docChanges()));
```

The rendered list is derived via `useMemo`:

```js
const messages = useMemo(
    () => allMessages.filter((message) => message.type === 'chat'),
    [allMessages]
);
```

Filtering happens **after** the merge, against the full unfiltered
accumulator — never merge an already-filtered array, since
`applyMessageChanges`' use of `change.newIndex` assumes positions in the
query's full unfiltered result set. This mirrors `MessageFeed.js`'s
whisper-visibility filter exactly, just with a simpler predicate (GM view
has no "mine vs theirs" concept, only the existing `type === 'chat'` check).

The effect resets `setAllMessages([])` when `roomID` changes, matching the
room-switch-reset fix `MessageFeed.js` already needed for the same
merge-based architecture.

The existing auto-scroll effect (`chatBox.scrollTop = chatBox.scrollHeight`
on `[messages]` change) is unchanged — it already depends on the derived,
filtered `messages` value.

## Components

### `src/components/player_messages_components/GMChatMessage.js` (new)

`React.memo`-wrapped, default shallow comparison (no custom comparator,
matching `MessageBubble.js`). Props: `{ message }`.

```jsx
import React from 'react';
import { ListItem, Text } from '@chakra-ui/react';
import { formatMessageTime } from '../../utils/formatMessageTime';

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

`formatMessageTime` already returns a falsy value for a pending
(not-yet-resolved) `serverTimestamp()`, so the timestamp `<Text>` simply
doesn't render until the write resolves — same behavior `MessageBubble.js`
already established for `MessageFeed.js`.

### `src/components/player_messages_components/GMChatPanel.js` (modified)

Imports `applyMessageChanges` and `GMChatMessage`. Replaces the `messages`
`useState` with `allMessages` `useState` + the `useMemo`-derived `messages`
described above. Render replaces the inline `ListItem`/`Text` JSX with
`<GMChatMessage key={message.id} message={message} />` per item.

## Testing

**`GMChatMessage.test.jsx` (new):**

- Renders sender and text.
- A resolved timestamp renders visible time text.
- A pending/null timestamp renders no time text (mirrors the equivalent
  `MessageBubble.test.jsx` case).

**`GMChatPanel.test.jsx` (existing, reworked):**

- Mock `onSnapshot` shape changes from `{ docs: [...] }` to
  `{ docChanges: () => [...] }` across all existing tests.
- New test: a second snapshot that only adds a new message, without
  touching an earlier one, does not cause the earlier message to re-render.
  Uses the same render-count-proxy technique `MessageFeed.test.jsx` uses:
  spy on `formatMessageTime` via `jest.fn(actual.formatMessageTime)` and
  assert its call count increases only for the new message, not the
  untouched one.

## Error handling

No change. The existing `onSnapshot` error callback (`console.error`) is
untouched. This is an internal data-flow refactor plus a rendering
addition — no new failure modes are introduced.

## Out of scope

- No change to `MessageFeed.js`, `MessageBubble.js`, or
  `applyMessageChanges.js` — all reused as-is.
- No change to what messages the GM can see (still `type === 'chat'` only,
  no moderator-only content).
- No visual/layout changes beyond adding the timestamp text.
