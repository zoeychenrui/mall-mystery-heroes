# Chat message bubbles: sender alignment and timestamps

## Problem

`MessageFeed.js` shipped group chat this session (`docs/superpowers/specs/
2026-08-12-chat-send-and-efficiency-design.md`), but every message in the
feed — mission cards, broadcasts, whispers, and now chat — renders as a
single left-aligned block. A `'chat'` message shows only `"sender: text"`
in a blue box, with no way to tell your own messages apart from a friend's
at a glance, and no visible time for anything in the feed even though every
`playerMessages` document already carries a `timestamp` field
(`serverTimestamp()`).

The user wants this to read like an ordinary group chat: their own
messages align to the right, and every message shows when it was sent.

## Decisions made

- **Right/left alignment is chat-only.** Only `'chat'` messages have a
  real "sent by me vs. sent by someone else" distinction — whispers and
  broadcasts are GM-authored, and leaderboard/mission cards aren't
  "sent" by anyone in that sense. Those four branches keep their current
  layout, unchanged.
- **Timestamps are everywhere.** Every message type in the feed —
  `leaderboard`, `mission`, `chat`, and the whisper/broadcast default
  branch — gains a small, muted timestamp.
- **Clock time, not relative time.** `"3:45 PM"`, not `"2m ago"`. Stable
  and doesn't need the feed to re-render on a timer to stay accurate —
  matches how iMessage/WhatsApp/Discord show times in an open thread.
- **"My message" is determined by name, the same way the whisper filter
  already works.** `normalizePlayerName(message.sender) ===
normalizePlayerName(playerName)`, reusing the exact helper and
  normalization the whisper-recipient filter already applies. `sender` is
  client-provided and trusted, same as everywhere else in this feature —
  no new verification is added here.
- **A pending (not-yet-acknowledged) message's timestamp is blank, not a
  placeholder.** `serverTimestamp()` reads as `null` locally until the
  server acks the write (the same local-echo behavior the original chat
  spec already relies on for instant self-send feedback). Showing nothing
  for that brief window is simpler than a "sending…" placeholder and the
  gap self-resolves within a moment.

## Architecture

### `src/utils/formatMessageTime.js` (new, pure)

```js
export const formatMessageTime = (timestamp) => {
    if (!timestamp) return null;
    return timestamp.toDate().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
};
```

`src/utils/**/*.test.js` already routes to the `node` (no-DOM) Jest
project per this repo's `jest.config.js` — a pure, unit-testable helper,
consistent with `src/game/playerNames.js`'s `normalizePlayerName`.
`toLocaleTimeString` with `hour: 'numeric', minute: '2-digit'` produces
`"3:45 PM"`-style output using the browser's locale, matching the
system's existing preference for built-in formatting over a hand-rolled
one.

### `MessageFeed.js`: per-message setup

Inside the existing `messages.map((message) => { const mission =
message.mission ?? {}; ... })`, two more values are computed alongside
`mission`:

```js
const isMine = normalizePlayerName(message.sender) === normalizePlayerName(playerName);
const time = formatMessageTime(message.timestamp);
```

(`normalizePlayerName` is already imported; `formatMessageTime` is a new
import from `../../utils/formatMessageTime`.)

### The `'chat'` branch: alignment + own-message styling

Replaces the current single `<Text bg="blue.900" ...>` block:

```jsx
<Flex justifyContent={isMine ? 'flex-end' : 'flex-start'}>
    <Box bg={isMine ? 'teal.700' : 'blue.900'} borderRadius="md" p={2} maxWidth="75%">
        {!isMine && (
            <Text as="span" fontWeight="bold">
                {message.sender}:{' '}
            </Text>
        )}
        <Text as="span">{message.text}</Text>
        {time && (
            <Text fontSize="xs" color="gray.400" mt={1}>
                {time}
            </Text>
        )}
    </Box>
</Flex>
```

Your own bubble drops the `"sender:"` prefix — the right alignment and
`teal.700` color (matching the composer's existing teal Send button)
already signal "this is you." Everyone else's chat bubbles keep the
sender name and the existing `blue.900`. `maxWidth="75%"` keeps a short
message from stretching edge-to-edge, the same convention every
mainstream chat UI uses.

### The other three branches: timestamp only, no layout change

- **`leaderboard`**: the `time` line is added directly under the existing
  `"Leaderboard"` heading, before the standings list.
- **`mission`**: added as a second line under the existing `taskType ·
pointValue · players` meta line.
- **whisper/broadcast default branch**: added the same way as chat's,
  directly under the message text, inside the same box.

All three use the identical `fontSize="xs" color="gray.400"` treatment as
the chat branch, so a timestamp looks the same everywhere in the feed.

## Testing

- `formatMessageTime.test.js` (new, `src/utils/`): a real Firestore-shaped
  `{ toDate: () => new Date(...) }` object formats to the expected
  `"H:MM AM/PM"` string; `null`/`undefined` returns `null`.
- `MessageFeed.test.jsx`: a chat message from the current player
  (`sender` matching `playerName`) renders inside a container whose
  `justifyContent` is `flex-end` and without a sender-name prefix in the
  DOM; a chat message from someone else renders with `justifyContent:
flex-start` and the sender prefix still shown; a message with a
  resolved `timestamp` shows its formatted time text; a message with a
  `null` timestamp (pending server ack) shows no time text. One test per
  non-chat branch (`leaderboard`, `mission`, whisper/broadcast)
  confirming each now also shows a formatted time.

## Scope

**In scope:** the `formatMessageTime` helper, `MessageFeed.js`'s
`'chat'` branch alignment/styling change, and a timestamp line added to
all four render branches.

**Explicitly out of scope:**

- `GMChatPanel.js` (the GM's read-only chat view) — not mentioned in the
  request; the GM isn't "sending" chat messages in the my-message sense,
  so alignment doesn't apply there. Whether it should also gain
  timestamps is left for a future round if wanted.
- Relative/live-updating timestamps ("2m ago").
- Any change to how a message's `sender` is determined or trusted.
- Read receipts, delivery status, or any other group-chat affordance
  beyond alignment and time.
