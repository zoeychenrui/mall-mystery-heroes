# Broadcast game events to players' chat feed

## Problem

The player-facing chat feed (`MessageFeed.js`, shipped this session) only
shows messages from the GM's explicit `/whisper`, `/broadcast`, and
`/leaderboard send` commands. Everything else that happens during a game —
a kill, a revival, open season starting or ending, a mission being
created, completed, or ending — is only written to the GM's own console
log (`rooms/{roomID}/logs`, via `dbCalls.addLogForRoom`), which players
never see. Players should see these events too, in the same chat feed.

## Decisions made

- **Scope: kill, revive, open season start/end, and the full mission
  lifecycle** (created, completed, ended — whether manually or via the
  completion cap). Not a partial subset of mission events — the user
  confirmed all three when asked.
- **Reuse the GM log's exact text**, not separate player-facing copy. The
  existing log strings are already plain and descriptive ("Alice was
  killed by Bob", "Mission 'Find the receipt' auto-ended — reached its
  3-completion cap") — writing a second, parallel set of player-facing
  strings would be duplicated copy to maintain for no real benefit.
- **These are `'broadcast'`-type `playerMessages`** — `recipient: null`,
  `standings: null` — the same shape `/broadcast` already writes. No new
  message type.
- **Out of scope: sender attribution.** The user explicitly flagged that
  the chat feed's underlying infrastructure will eventually need to know
  _who_ sent a message (most things come from the GM/moderator, but future
  player-to-player messaging will need real sender names). That's scope
  for the next full chat-feature design round, not this pass — every
  message this feature writes is a `'broadcast'` exactly like `/broadcast`
  already is, with no sender field, matching the existing schema as-is.

## Architecture

At each of the following 9 existing `addLog(...)` call sites (`handleKillPlayer`
contributes 2 of them), add a
parallel `addPlayerMessageForRoom(...)` call with the same text:

```js
await addPlayerMessageForRoom(
    { type: 'broadcast', recipient: null, text: <same string passed to addLog>, standings: null },
    roomID
);
```

**`src/pages/GameMasterView.js`:**

- `handleKillPlayer` — two sites: the open-season-ended-via-kill branch
  (`'open season has ended for ' + killedPlayerName`) and the kill itself
  (`killedPlayerName + ' was killed by ' + assassinName`).
- `handleOpenSznstarted` — `openSznplayer + ' has open season on them'`.
- `handleOpenSznended` — `'open season has ended for ' + openSznplayer`.
- `handlePlayerRevive` — `revivedPlayerName + ' was revived'`.
- `handleNewTaskAdded` — `'Added new task: ' + newTask.title`.
- `handleTaskCompleted` — `'Completed task: ' + task` (this fires from
  `/mission end`'s manual-end path, despite the handler's name).

**`src/components/logs_components/ChatInput.js`:**

- `/mission done`'s success path — `` `${playerDisplayName} completed mission: ${task.title}` ``.
- The completion-cap auto-end branch inside that same case —
  `` `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap` ``.

`addPlayerMessageForRoom` is already imported in `ChatInput.js` (used by
`/whisper`, `/broadcast`, `/leaderboard`). `GameMasterView.js` needs a new
import for it.

No changes to `MessageFeed.js`, `firestore.rules`, or the `playerMessages`
schema — this only adds more writers of the existing `'broadcast'` shape.

## Testing

Each of the 9 call sites gets one new assertion (in whichever test file
already covers that handler/command — `GameMasterView.test.jsx` for the
GameMasterView.js handlers, `ChatInput.test.jsx` for the two ChatInput.js
sites) confirming `addPlayerMessageForRoom` was called with
`{ type: 'broadcast', recipient: null, text: <expected string>, standings: null }`
alongside the existing assertion on `addLog`. No new test files.

## Scope

**In scope:** the 9 call sites above, broadcasting existing GM log text as
player-facing `'broadcast'` messages.

**Explicitly out of scope:**

- Sender attribution / a "who sent this" field on `playerMessages` — next
  chat-feature design round.
- Any change to `/whisper`, `/broadcast`, or `/leaderboard send`'s
  existing behavior.
- Any change to what the GM console itself logs or displays.
