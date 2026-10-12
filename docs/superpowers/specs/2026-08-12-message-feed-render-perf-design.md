# Message feed render performance

## Problem

The user reported the player chat feed feels "a lot laggier" right after
the chat-message-bubbles feature shipped (right-aligned own messages,
timestamps). Root cause, found via systematic debugging:

`MessageFeed.js`'s `onSnapshot` handler rebuilds the entire messages array
from scratch on every single incoming message —
`snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))` creates
brand-new plain objects for all ~50 messages on every snapshot event, even
ones that haven't changed. Because `messages.map(...)` renders each
message's JSX inline (not as a separate component), every one of those new
object references forces React — and Chakra's runtime CSS-in-JS, which is
not cheap per styled element — to re-render and re-style every message in
the feed whenever _anyone_ sends a new one, not just the new message.

This inefficiency predates today's feature. What today's feature did was
make each of those unnecessary re-renders measurably heavier: roughly
doubling the styled elements per message (an extra `<Text>` for the
timestamp, a `<Flex>` wrapper for chat bubbles) and adding a
`toLocaleTimeString` call per message that constructs a fresh `Intl`
formatter every time. The pre-existing disease became a noticeable
symptom right when this shipped.

## Decision

Fix the actual root cause, not just the added weight: stop rebuilding the
whole array on every snapshot, and give React a real component boundary
so it can skip re-rendering messages that haven't changed.

Two pieces, both required — neither alone fixes this:

1. **Preserve object identity for unchanged messages.** Use Firestore's
   `snapshot.docChanges()` instead of `snapshot.docs` to merge only
   `'added'`/`'modified'`/`'removed'` changes into the existing messages
   array. A message not present in a given snapshot's `docChanges()`
   keeps the exact same object reference it already had.
2. **Give React something to memoize.** A plain `.map()` over inline JSX
   always re-executes for every item on every parent re-render, regardless
   of whether the array elements' references changed — memoizing an array
   element does nothing unless it's rendered through an actual child
   component. Extract each message's render into a new `MessageBubble`
   component wrapped in `React.memo`, so a message whose object reference
   didn't change (per #1) is skipped by React entirely.

`docChanges()` reports every document as `'added'` on the very first
snapshot, so this also correctly bootstraps the initial load — no special
case needed.

## Architecture

### `src/utils/applyMessageChanges.js` (new, pure)

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

`change.newIndex` is the document's position in the _query's full,
unfiltered_ result set, which is exactly what `next` represents here —
`MessageFeed`'s existing whisper-visibility `.filter()` stays a separate
step applied _after_ this merge, not folded in, because filtering
doesn't break reference stability for the objects that pass through, and
folding it in would make Firestore's `newIndex` (an unfiltered-array
position) wrong for splicing into an already-filtered array.

### `MessageFeed.js`: subscription rewrite

The `onSnapshot` success callback changes from mapping `snapshot.docs`
directly to:

```js
setMessages((previous) => {
    const merged = applyMessageChanges(previous, snapshot.docChanges());
    return merged.filter(
        (message) => !message.recipient || normalizePlayerName(message.recipient) === normalizedName
    );
});
```

Everything else about the effect (the `roomID`/`playerName` guard, the
`unsubscribe` cleanup, the error handler) is unchanged.

### `src/components/player_messages_components/MessageBubble.js` (new)

The exact JSX currently inline in `MessageFeed.js`'s `.map()` — all four
branches (`leaderboard`/`mission`/`chat`/whisper-broadcast), byte-for-byte
identical rendering output — moves into this new component, taking
`{ message, playerName }` as props and computing `isMine`/`time`
internally exactly as `MessageFeed.js` does today. Wrapped in
`React.memo` with no custom comparator — the default shallow prop
comparison is exactly right here: `playerName` is referentially stable
across a `MessageFeed` render (it's a prop passed down unchanged), and
`message` is now reference-stable for anything unchanged per
`applyMessageChanges`, so the default comparison correctly skips
re-rendering a message that's still the same object.

`MessageFeed.js` shrinks to:

```jsx
{
    messages.map((message) => (
        <MessageBubble key={message.id} message={message} playerName={playerName} />
    ));
}
```

No visual or behavioral change — this is a pure internal refactor for
render performance. Every existing rendering test (alignment, sender
prefix, timestamps, leaderboard/mission cards) continues to describe the
same, unchanged output; they just exercise it through `MessageBubble`
instead of inline JSX in `MessageFeed`.

## Testing

- `applyMessageChanges.test.js` (new, `src/utils/`): an `'added'` change
  inserts at `newIndex`; a `'modified'` change replaces the existing
  entry in place; a `'removed'` change removes it; **the core regression
  test** — a message not present in a given call's `docChanges` keeps the
  exact same object reference (`toBe`, not `toEqual`) across two
  successive calls to `applyMessageChanges`.
- `MessageBubble.test.jsx` (new): the four rendering branches (moved
  verbatim from `MessageFeed.test.jsx`'s existing chat/leaderboard/
  mission/whisper/broadcast assertions), tested directly against
  `MessageBubble` with explicit `message`/`playerName` props — no
  `onSnapshot` mocking needed, since this component doesn't subscribe to
  anything.
- `MessageFeed.test.jsx`: every existing test's `onSnapshot` mock
  currently delivers `onNext({ docs: asMessageDocs([...]) })`; the mock
  helper changes to produce a `docChanges()`-shaped fixture instead
  (`type: 'added'`, `newIndex`, `doc: { id, data: () => message }` per
  message) so the tests exercise the real code path. A new test verifies
  the actual regression this whole fix targets: render the feed with one
  message, capture its DOM node, deliver a second snapshot that adds a
  new message via `docChanges()` (not touching the first), and assert the
  first message's DOM node reference (`toBe`) is unchanged — proving
  `MessageBubble`'s memoization actually took effect end-to-end, not just
  in the pure merge function's unit test.

## Scope

**In scope:** `applyMessageChanges.js`, `MessageBubble.js`, `MessageFeed.js`'s
subscription rewrite, and updating `MessageFeed.test.jsx`'s mock shape to
match Firestore's real `docChanges()` API.

**Explicitly out of scope:**

- `GMChatPanel.js` — has the identical `snapshot.docs`-remapping
  inefficiency (it's the same `fetchPlayerMessagesQueryForRoom` query,
  filtered client-side), but wasn't the subject of this performance
  report and isn't touched here. Worth a follow-up note once this pattern
  is proven out in `MessageFeed.js`.
- Any change to what's rendered, `firestore.rules`, or the bounded
  `limitToLast(50)` query itself — this is a render-path fix only.
- Windowing/virtualization of the message list — not needed at a 50-message
  ceiling; the problem was unnecessary re-renders, not raw list size.
