# Player messaging: fleshing out /whisper, /broadcast, /leaderboard

## Problem

`/whisper`, `/broadcast`, and `/leaderboard` are whitelisted commands that do
nothing — `UNIMPLEMENTED_COMMANDS` in `src/game/commands.js` short-circuits
them straight to a "not implemented yet" toast. `docs/commands.md` has always
inferred their intended syntax from a stray `DISCORD_TOKEN` in `.env`, never
from a documented design.

Separately, the user wants the GM console prepared for eventual integration
with a player-facing mobile app (`docs/architecture.md`'s "aspirational —
does not exist" collaborator). These two asks turned out to be the same
piece of work: these three commands **are** the mobile-integration point —
they're how a GM sends something a player would see on their phone, once
that phone app exists to show it.

## Decisions made

- **`/whisper [player] [message]`** — a private message, visible only to
  that one player.
- **`/broadcast [message]`** — a message visible to every player.
- **`/leaderboard send`** — no custom message; packages up the live
  roster's current standings and sends that. Keeps the existing documented
  `send` syntax (no argument) rather than accepting free text.
- **Full data-layer prep, not GM-side-only.** A new Firestore subcollection
  is written now, even though nothing reads it yet — mirroring `photos`
  (`docs/data-model.md`), which was already designed the same way: written
  by a mobile app that doesn't exist, with no writer today except manual
  seeding. This is the mirror case — a collection _read_ by a mobile app
  that doesn't exist, with no reader today except manual inspection.

## Architecture

### New collection: `rooms/{roomID}/playerMessages/{autoId}`

```
{
  type: 'whisper' | 'broadcast' | 'leaderboard',
  recipient: string | null,          // player's real (display) name — whisper only
  text: string | null,               // free-text body — whisper/broadcast only
  standings: Array<{                 // leaderboard only
    name: string,
    score: number,
    isAlive: boolean,
  }> | null,
  timestamp: Timestamp,              // serverTimestamp()
}
```

Exactly one of `text`/`standings` is populated, matching `type`. `recipient`
is populated only for `type: 'whisper'`; `null` for the other two (a
future mobile app treats `recipient: null` as "show to everyone").

Field shape rationale: whisper/broadcast are inherently free text, so
`text` is a plain string. Leaderboard gets structured `standings` instead
of a pre-rendered string — a real mobile app will want to render its own
leaderboard UI (sort, style, animate), not display a wall of text a GM
happened to format for a chat log.

### Firestore rules

New `match /playerMessages/{messageId}` block inside `match /rooms/{roomId}`,
identical in shape to the existing `photos` block — both read and write
scoped to `isHostOfExistingRoom(roomId)`, with the same "interim, revisit
once a real player identity exists" comment `photos` already carries. No
new security primitive is introduced; this is the same open question
`photos` already has, applied to a second collection.

### `dbCalls.js`

One new function, matching `addLogForRoom`'s shape (`add…For…` = creates a
new document, per this file's own naming convention):

```js
export const addPlayerMessageForRoom = async (message, roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    await addDoc(messagesRef, { ...message, timestamp: serverTimestamp() });
};
```

### Leaderboard standings — pure logic

`src/game/leaderboard.js` (new, pure, no Firebase/React — per CLAUDE.md's
`src/game/` rule):

```js
/**
 * @param players Array<{ name, score, isAlive }>
 * @returns Array<{ name, score, isAlive }> sorted by score descending
 */
export const buildLeaderboardStandings = (players) => ...
```

Sorted by score descending; dead players included, not filtered — matches
`PlayersList`'s own existing sort/display convention (everyone shown,
alive/dead visually distinguished). Unit tested directly, no component, no
Firebase — same layer as `commandCompletion.js`.

## Command behavior

All three move out of `UNIMPLEMENTED_COMMANDS` in `src/game/commands.js`
into real `case` branches in `ChatInput.js`'s `handleCommandExecution`,
following the existing pattern every other command uses (validate against
`arrayOfPlayerNames`/args, write, then `addLog` a GM-facing confirmation).

- **`/whisper [player] [message]`**
    - Validate: player must be in the roster (same normalize-then-check
      pattern as `/kill`); message (everything after the player token) must
      be non-empty.
    - Invalid player → `createAlert('error', 'Error', \`Player ${args[0]} is invalid\`, 1500)`, matching every other command's wording.
    - Empty message → `createAlert('error', 'Error', 'Whisper message cannot be blank', 1500)`.
    - On success: `addPlayerMessageForRoom({ type: 'whisper', recipient: <resolved display name>, text: <message>, standings: null }, roomID)`, then `addLog(\`Whisper sent to ${displayName}: "${message}"\`, 'teal.400')`.
- **`/broadcast [message]`**
    - Validate: message non-empty → same "cannot be blank" alert shape if not.
    - On success: `addPlayerMessageForRoom({ type: 'broadcast', recipient: null, text: message, standings: null }, roomID)`, then `addLog(\`Broadcast sent: "${message}"\`, 'teal.400')`.
- **`/leaderboard send`**
    - Validate: second token must be literally `send` (case-insensitive,
      matching `/openseason`'s `start`/`end` literal-arg pattern) →
      `createAlert('error', 'Error', \`${args[0]} is not a valid input\`, 1500)` otherwise.
    - On success: `standings = buildLeaderboardStandings(players)`, `addPlayerMessageForRoom({ type: 'leaderboard', recipient: null, text: null, standings }, roomID)`, then `addLog('Leaderboard sent to all players', 'teal.400')`.

Message text for whisper/broadcast is the raw remainder of the input after
the command word (and, for whisper, the player token) — joined args, not
just `args[1]`, so multi-word messages don't need bracket syntax the way
player names do (a message isn't a lookup key, there's no ambiguity to
resolve).

### Tab-completion

`commandCompletion.js` already has `ARG_LABELS` entries for all three
(`/whisper`: `['[player_name]', '[message]']`, `/broadcast`:
`['[message]']`, `/leaderboard`: `['send']`) from the earlier
suggestion-line work — added while these were still on
`UNIMPLEMENTED_COMMANDS`, so they only ever drove the slot-0 command-word
preview, never real per-slot completion. Now that these are real commands,
`candidatesForSlot` needs new cases:

- `/whisper` slot 1 → `playerNames(players)` (same as `/kill`'s player
  slots). Slot 2 (the message) → no candidates; free text.
- `/broadcast` slot 1 → no candidates; free text.
- `/leaderboard` slot 1 → the literal `['send']`.

## Testing

- `src/game/leaderboard.test.js` — sort order, dead players included, empty
  roster.
- `src/game/commandCompletion.test.js` — new cases for the three commands'
  slot behavior now that they're implemented.
- `src/components/logs_components/ChatInput.test.jsx` — one success + one
  validation-failure case per command, following the existing per-command
  `describe` block convention in that file.
- `test/firestore.rules.test.js` — new `describe` block for
  `playerMessages`, mirroring the existing `photos` block exactly (non-host
  write denied, host write allowed).

## Docs

- `docs/commands.md` — move all three out of "Declared but not
  implemented" into the main command reference table, each with its own
  argument-shape row like every other implemented command.
- `docs/data-model.md` — new `## rooms/{roomID}/playerMessages/{autoId}`
  section, styled after the existing `photos` section (including the same
  "designed to be read by a mobile app that doesn't exist yet" framing,
  mirrored).
- `docs/architecture.md` — the mobile-app "aspirational" note currently
  only mentions `photos` as the one prepared-but-unconsumed contract;
  update it to mention `playerMessages` as the second.

## Out of scope

- Actually building the mobile app, or anything that reads
  `playerMessages`. Nothing consumes this collection yet — this spec is the
  write-side contract only.
- Solving player identity/auth. `playerMessages` uses the same host-only
  interim rule `photos` already uses; a real per-player read scope needs a
  player-facing auth system that doesn't exist yet, tracked by the same
  open question `photos` already carries.
- Editing or retracting a sent whisper/broadcast/leaderboard snapshot once
  written — not requested, and `photos` has no precedent for it either.
- Any change to `/whisper`/`/broadcast`/`/leaderboard`'s relationship to
  the stray `DISCORD_TOKEN` env var. That was always speculative inference,
  never a documented design; this spec supersedes it with an actual one.
