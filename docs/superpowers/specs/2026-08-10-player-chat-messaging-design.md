# Player chat/messaging

## Problem

`rooms/{roomID}/playerMessages` has been write-only since it was built: the
GM console's `/whisper`, `/broadcast`, and `/leaderboard send` commands
already write to it (`ChatInput.js`, `dbCalls.addPlayerMessageForRoom`),
but nothing anywhere reads it. This is the second of four independent
pieces of the "in-game player experience" (the first, viewing your
target/status, is built and live at `src/pages/PlayerGame.js`; kill-photo
submission and a real leave-game flow remain separate, not-yet-designed
sub-projects).

## Decisions made

- **Receive only, for now.** Players see messages the GM sends; they can't
  send any yet. Player-to-GM/player-to-player messaging is a separate
  future piece — it needs its own `firestore.rules` changes (player writes
  to `playerMessages` are currently blocked entirely) and real questions
  around moderation that don't need answering to ship this.
- **No separate waiting-room screen.** `PlayerGame.js` becomes the
  player's one continuous screen from the moment they join through the end
  of the game — not a "waiting room" that hands off to a different
  "in-game" screen once `gameStarted` flips. Only the status line at the
  top changes text as the game progresses ("Waiting for the host to
  start..." → target → eliminated); the chat feed underneath is present
  and live the entire time, not gated on `gameStarted`.
- **The composer ships as UI only.** A text input, send button, and photo
  button are built and visible now, but disabled — no write path, no
  photo upload. Real behavior for both is future work (photo submission is
  already a separate planned sub-project; text sending would be part of
  the future two-way-messaging piece above).
- **Client-side filtering, not a security boundary.** A player's feed
  shows broadcasts, leaderboard sends, and whispers addressed to them —
  filtered in the component, not the query. `firestore.rules` already
  grants any player-of-the-room read access to the whole
  `playerMessages` collection (`allow read: if isHostOrPlayerOfRoom(roomId)`,
  unchanged by this work), the same trust model this app already applies
  to `players`/`logs`/`tasks`. A player who inspected raw Firestore traffic
  could see whispers meant for someone else; this is an existing,
  accepted property of this app's security model, not a new gap this
  feature introduces.

## Architecture

### Layout change: `src/pages/PlayerGame.js`

Current layout (single centered column: status text + a "Leave" button)
becomes a full-height vertical layout:

1. A compact header row: player name/room ID, and "Leave" moved to a
   smaller button in the top-right (was centered below the status text).
2. The status line, unchanged logic (`!gameStarted` → waiting text;
   `gameStarted && isAlive` → target; `gameStarted && !isAlive` →
   eliminated).
3. `MessageFeed`, filling the remaining vertical space, scrollable.
4. `MessageComposer`, docked at the bottom.

No changes to the existing `gameStarted`/player-doc subscriptions or their
error handling — this only adds a third, independent subscription and
restructures the JSX around it.

### `src/components/player_messages_components/MessageFeed.js`

- Subscribes via `onSnapshot` to `fetchPlayerMessagesQueryForRoom(roomID)`
  (new `dbCalls.js` function, below) as soon as `roomID` and `playerName`
  are both known — same gating reasoning `PlayerGame.js`'s player-doc
  subscription already uses (an empty `playerName` means an invalid/stale
  session; subscribing anyway risks the same class of crash the final
  review caught there). Not gated on `gameStarted`.
- Filters the subscribed snapshot client-side: a message is shown if
  `recipient === null` (broadcast/leaderboard) or
  `normalizePlayerName(recipient) === normalizePlayerName(playerName)`
  (a whisper addressed to this player).
- Renders each message by `type`:
    - `broadcast`/`whisper`: a text line (whispers visually marked as
      private — e.g. a distinct background — since only their recipient
      ever sees one).
    - `leaderboard`: a compact standings list (name, score, alive status)
      from the `standings` field, not rendered as text.
- Auto-scrolls to the newest message on arrival, reusing the exact
  ref/effect pattern already built for the GM's log panel
  (`GameMasterView.js`'s `logsBoxRef` + `useEffect` keyed on the message
  list).
- A subscription error is logged via `console.error` only — it does not
  clear the session or navigate away. Losing the chat feed doesn't mean
  this player's session is invalid, unlike losing the room or player-doc
  subscription.

### `src/components/player_messages_components/MessageComposer.js`

A disabled text `Input`, a disabled "Send" `Button`, and a disabled photo
`Button` (icon-only). No props, no state, no Firebase imports — pure UI
until a future piece wires it up.

### Data: `src/components/firebase_calls/dbCalls.js`

```js
export const fetchPlayerMessagesQueryForRoom = (roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    return query(messagesRef, orderBy('timestamp', 'asc'));
};
```

Mirrors `fetchLogsQueryByAscendingTimestampForRoom`'s exact shape.

## Testing

- `MessageFeed.test.jsx` (jsdom): broadcasts and leaderboard sends are
  visible regardless of `playerName`; a whisper addressed to this player
  is visible; a whisper addressed to someone else is not; the feed updates
  live without a reload; a leaderboard message renders as a standings
  list, not a text line; the auto-scroll is verified non-vacuous the same
  way the logs panel's was (temporarily break the scroll-setting line,
  confirm the test fails, restore).
- `MessageComposer.test.jsx`: input, send button, and photo button all
  render and are disabled.
- `PlayerGame.test.jsx`: `MessageFeed`/`MessageComposer` are stubbed (same
  reasoning `GameMasterView.test.jsx` stubs `ChatInput`) so this file
  stays focused on its own status-line logic. One new test confirms
  `MessageFeed` is mounted (i.e. the subscription can start) even while
  `gameStarted` is still `false` — the point of removing the waiting-room
  gate.

## Scope

**In scope:** the message feed described above (broadcast/whisper/
leaderboard, receive-only, live), and the disabled composer UI.

**Explicitly out of scope:**

- Sending messages (player-to-GM or player-to-player) — needs new
  `firestore.rules` write permissions and its own design questions
  (moderation, spam) not answered here.
- Kill-photo submission — a separate, not-yet-designed sub-project; the
  photo button here is a disabled placeholder only.
- A real leave-game flow — unchanged from the target/status view's spec;
  still out of scope.
