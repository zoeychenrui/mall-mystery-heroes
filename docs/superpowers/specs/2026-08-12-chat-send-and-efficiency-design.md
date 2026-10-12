# Chat send functionality and feed efficiency

## Problem

`MessageFeed.js` (a live, read-only feed) and `MessageComposer.js` (a
disabled placeholder — text input, send button, photo button) shipped
this session. Players can see GM broadcasts, whispers, mission
announcements, and leaderboard sends, but can't send anything back — the
composer does nothing. The user wants it to actually work, as a real
group chat everyone in the room can see and use to talk to each other
("like Jackbox... people can actually text and have fun, troll a bit
about where their friends are"), and wants lag eliminated and the
implementation designed for efficiency.

Investigating the current architecture surfaced a real, separate
inefficiency worth fixing in the same pass: `fetchPlayerMessagesQueryForRoom`
has no `limit`, and `MessageFeed.js` re-renders its entire message history
on every single new message. This gets significantly worse once players
are chatting live instead of occasionally receiving a GM broadcast.

## Decisions made

- **Group chat, not player-to-GM.** Every message a player sends is
  visible to everyone in the room — other players and the GM. Not a
  reversed `/whisper`.
- **Spam/moderation is explicitly low priority.** This is a casual
  friend-group game; no rate-limiting or moderation tooling in this pass.
- **The GM sees it too.** The GM console currently has zero visibility
  into `playerMessages`; a new, separate, read-only panel is added rather
  than leaving the GM blind to player chat.
- **Sender attribution, finally addressed.** A group chat needs to show
  who said what — a real gap identified earlier this session and
  explicitly deferred to this round. A new `sender` field is added to the
  `playerMessages` schema, populated only for player-authored `'chat'`
  messages.
- **Trust the client for `sender`, same as everywhere else in this app.**
  No `firestore.rules`-side verification that `sender` matches the
  writer's real identity (that would need a `get()` per write). This app
  already trusts client-provided display names for `/whisper`'s recipient
  and everywhere else a name is written; a friends-only party game doesn't
  need a stronger bar here.
- **Photo submission stays out of scope.** The composer's photo button
  remains disabled — a fully separate, not-yet-designed sub-project.
- **Bound the query, not just fix the send path.** "Eliminate lag" covers
  the read/render cost too, not only round-trip send latency — the
  unbounded full-history re-render is fixed in this same pass.

## Architecture

### Data: `playerMessages` schema addition

One new field, alongside the existing `type`/`recipient`/`text`/
`standings`/`mission`/`timestamp`:

| Field    | Type             | Notes                                                                                                                                                                           |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sender` | `string \| null` | The display name of the player who sent a `'chat'` message. `null`/absent for every other `type` (whisper/broadcast/leaderboard/mission are all GM-authored; no sender needed). |

A `'chat'` message: `{ type: 'chat', recipient: null, text: <message>, standings: null, mission: null, sender: <playerName> }`.

### Security: `firestore.rules`

The `playerMessages` match block currently allows writes only from
`isHostOfExistingRoom(roomId)`. Add a second `allow create` clause scoped
narrowly to what a player is allowed to write:

```
allow create: if isPlayerOfRoom(roomId) &&
  request.resource.data.type == 'chat' &&
  request.resource.data.recipient == null;
```

This lets any player of the room create a `'chat'`-type, group-visible
message, but not a `'whisper'`/`'broadcast'`/`'leaderboard'`/`'mission'`
document (those stay GM-only, unchanged). The existing `isHostOfExistingRoom`
write grant is untouched — the GM can still write anything.

### Efficiency: bound the query and the render

`fetchPlayerMessagesQueryForRoom(roomID)` changes from
`query(messagesRef, orderBy('timestamp', 'asc'))` to
`query(messagesRef, orderBy('timestamp', 'asc'), limitToLast(50))`.
`limitToLast` (not `limit`) is required to get the newest 50 in ascending
order rather than the oldest 50. This bounds both the Firestore read cost
and `MessageFeed.js`'s render cost as a game's message history grows —
neither ever processes more than 50 documents, regardless of how long the
game has been running. This one change benefits every consumer of this
query (the existing player feed and the new GM panel below), so it's
fixed once at the data layer, not per-consumer.

50 is a starting point, not a tuned constant — chosen because it's enough
scrollback to feel like a real chat history without materially changing
render cost versus today's typical low-volume GM-broadcast traffic.

### Send path: `MessageComposer.js`

Gains `roomID`/`playerName` props (currently has neither). The text input
and Send button become enabled; submitting (Enter or click) calls a new
`dbCalls.js` function:

```js
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

A thin, purpose-named wrapper rather than reusing `addPlayerMessageForRoom`
directly at the call site — matches this file's existing convention of a
distinct function per logical write (`addLogForRoom`, `addPlayerMessageForRoom`
itself, etc.), and keeps the `'chat'` shape's construction in one place.

The input clears immediately on submit. No additional optimistic-UI state
is needed: the Firestore client SDK already surfaces a client's own
pending write in its local `onSnapshot` callback before server
acknowledgment, so the sender sees their own message appear through the
existing live subscription with effectively no perceived delay, once the
query itself isn't doing wasted full-history work.

The photo button stays exactly as it is today: disabled, no props, no
wiring.

### `MessageFeed.js`: a new `'chat'` render branch

Players need to see chat messages in their own feed too, not just send
them — a new branch, sibling to the existing `'leaderboard'`/`'mission'`
branches, renders `sender: text` (e.g. `"Alice: watch your back"`) in a
style visually distinct from GM broadcasts/whispers (which have no
sender), so it's immediately clear a message came from a friend, not the
GM.

### GM-side read UI: a new chat panel

A new component, `src/components/player_messages_components/GMChatPanel.js`,
sibling to `MessageFeed.js` — same live-subscription pattern
(`fetchPlayerMessagesQueryForRoom`, now with the `limitToLast(50)` bound),
filtered client-side to `message.type === 'chat'` only (the GM doesn't
need whisper/broadcast/leaderboard/mission echoed back to them — those
are things _they_ sent). Renders `sender: text` per message, auto-scrolling
to the newest, reusing the same ref/effect pattern already established in
`MessageFeed.js` and the GM's own log panel.

Mounted into `GameMasterView.js` as its own panel, kept separate from the
existing Logs panel (`rooms/{roomID}/logs`) — different collection,
different schema, different purpose (game-event audit trail vs. player
social chat). Read-only: the GM doesn't reply into the group chat in this
pass.

## Testing

- `test/firestore.rules.test.js`: a player of the room can create a
  `'chat'` message with `recipient: null`; a player cannot create a
  `'whisper'`/`'broadcast'`/`'leaderboard'`/`'mission'` message or a
  `'chat'` message with a non-null `recipient`; a stranger (not a player
  or host of the room) cannot create any `playerMessages` document,
  unchanged from today.
- `dbCalls.integration.test.js`: `addChatMessageForRoom` writes the
  correct shape, readable via `fetchPlayerMessagesQueryForRoom`; the query
  actually bounds to the newest 50 when more than 50 messages exist in a
  room (seed 51+, assert the oldest is excluded).
- `MessageFeed.test.jsx`: a `'chat'` message renders `sender: text`, in
  its own recognizable style (distinct from GM broadcasts/whispers/
  missions, though visually simple).
- `MessageComposer.test.jsx`: input/button are now enabled given
  `roomID`/`playerName` props; submitting calls `addChatMessageForRoom`
  with the typed text, the player's name, and the room ID; the input
  clears after submit; the photo button remains disabled.
- `GMChatPanel.test.jsx` (new): live-subscribes, filters to `'chat'` only
  (a whisper/broadcast/leaderboard/mission in the same snapshot is not
  shown), renders `sender: text`, auto-scrolls to the newest message
  (verified non-vacuous the same way the existing auto-scroll tests are).

## Scope

**In scope:** the `sender` field, the player-write `firestore.rules`
grant (scoped to `'chat'`/`recipient: null`), the `limitToLast(50)` query
bound, `MessageComposer.js`'s send wiring, and the new GM-side
`GMChatPanel.js`.

**Explicitly out of scope:**

- Photo submission — the composer's photo button stays disabled; separate,
  not-yet-designed sub-project.
- Rate-limiting/spam/moderation tooling.
- The GM replying into the group chat, or any player-to-player private
  messaging (whispers stay GM-only, unchanged).
- Message editing/deletion.
- `sender` verification against the writer's real identity in
  `firestore.rules` — client-trusted, matching this app's existing
  pattern for player-provided display names.
