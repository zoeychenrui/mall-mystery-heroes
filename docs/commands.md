# GM command bar reference

The command bar at the bottom of the log panel is the primary way a Game Master
drives the game. It is implemented entirely in
`src/components/logs_components/ChatInput.js`.

---

## How input is parsed

```js
const parts = value.match(/\/\S+|(\[[^\]]+\]|\S+)/g).map((s) => s.replace(/[\[\]]/g, ''));
const commandLine = parts[0].toLowerCase();
const args = parts.slice(1);
```

- The first token is lowercased and matched against a whitelist
  (`sanityCheckCommandInputs`); anything else produces an "not legal" toast.
- Remaining tokens are split on whitespace, **except** that a bracketed group
  like `[player name]` is captured whole. Brackets are then stripped, so
  `/whisper [Jane Doe] hello` yields `args = ["Jane Doe", "hello"]`. This is the
  only way to pass an argument containing a space.
- Arguments are **not** trimmed or normalized beyond what each command does
  individually.

Two parser caveats:

- Pressing Enter on an **empty input** throws. `.match()` returns `null` and
  `.map()` is called on it before the `if (!parts) return null` guard runs.
- **Tab completion is shell-style, one argument at a time** (see
  `docs/superpowers/specs/2026-08-05-shell-style-command-completion-design.md`),
  not a whole-line guess. Tab resolves only the argument slot currently being
  typed — the command word, a player name, a mission index, and so on — and
  completes it to the longest prefix shared by every remaining match. A
  unique match gets a trailing space appended so typing can continue straight
  into the next argument; an ambiguous match stops at the shared prefix with
  no trailing space, and the dropdown still lists every candidate. A
  multi-word player name is wrapped in `[brackets]` automatically. Candidates
  come from live data where it makes sense — the current player roster (via
  `gameContext`, the same live subscription `GameMasterView` uses) and active
  mission indices (fetched on demand the first time a `/mission …` slot needs
  them, cached for that typing session).

## Argument case sensitivity

Most commands lowercase their arguments before use, but every Firestore lookup
queries the raw `name` field. **Commands therefore only work for players whose
names were entered in all lowercase.** This affects `/kill`, `/revive`,
`/openseason`, and `/mission done`. `/add` is broken in the opposite direction —
it does _not_ lowercase `args[0]` before validating it against a lowercased
roster, so a capitalized name fails validation instead of failing the lookup.

See [improvements.md](./improvements.md#1-player-names-must-be-all-lowercase-or-commands-silently-fail).

---

## Implemented commands

### `/add <player> <points>`

Adds points to a player's score. Points may be negative.

| Check                                                         | Failure                     |
| ------------------------------------------------------------- | --------------------------- |
| `args[0]` is in the roster (compared **without** lowercasing) | `Player {name} is invalid`  |
| `args[1]` parses as a number                                  | `Please input valid points` |

Writes via `updatePointsForPlayer`, which is a read-modify-write, not an atomic
`increment()`. Two GMs adding points at once can lose one of the updates.

### `/kill <target> <assassin>`

Records a kill. See [game-flows.md](./game-flows.md#2-killing-a-player-kill-target-assassin)
for the full sequence.

| Check                                                                                                               | Failure                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| At least 2 arguments                                                                                                | `Missing Arguments`                                                      |
| Both names in roster                                                                                                | `Invalid players: …`                                                     |
| Target is on the assassin's target list, **or** the target is in open season, **or** the assassin is in open season | `{target} is not a valid taret for {assassin}` _(typo is in the source)_ |

Effects: assassin gains the target's full score (floored at 0); target's score
is zeroed, `isAlive` set false, `openSeason` cleared; target is unmapped from the
graph; affected neighbours are remapped; a modal shows the new assignments.

### `/revive <player>`

Brings a dead player back and remaps them into the target graph.

Requires the player to be in the dead list. If they are not, **nothing happens
and no error is shown** — the `if` has no `else` branch.

The revived player keeps the score of `0` assigned at death.

### `/openseason <player> start|end`

Toggles the `openSeason` flag. While set, the player is a valid target for
everyone and may kill anyone.

| Check                               | Failure                        |
| ----------------------------------- | ------------------------------ |
| Player in roster                    | `{name} is not a valid player` |
| Second argument is `start` or `end` | `{arg} is not a valid input`   |

The command does not check the current state first — a `TO DO` comment in the
source acknowledges this — so `start` on an already-open-season player re-logs
the event.

### `/mission done <player> <index>`

Marks a player as having completed mission `<index>` (the `taskIndex`, i.e. the
number shown in the mission list — not a document ID).

| Check                               | Failure                                           |
| ----------------------------------- | ------------------------------------------------- |
| `Number(args[2])` is not `-1`       | `{arg} is not a valid index`                      |
| Player in roster                    | `Player {name} is invalid`                        |
| Mission with that index exists      | `Invalid task index`                              |
| Mission is not already `isComplete` | `Mission {index} has already ended`               |
| Player not already in `completedBy` | `Player {name} has already completed the mission` |

Effect depends on `taskType`:

- **`Task`** — awards `parseInt(pointValue)` points.
- **`Revival Mission`** — requires the player to be dead (`Player {name} is not
dead` otherwise), revives them, and remaps them into the graph.

Either way: the player is appended to `completedBy`, the completion is
logged to chat and broadcast to players' chat feed (`{player} completed mission: {title}`), and — if the
mission has a `maxCompletions` cap (improvements item 41) and this
completion reaches it — the mission auto-ends the same way `/mission end`
does, with its own chat announcement also broadcast to players
(`Mission "{title}" auto-ended — reached its {N}-completion cap`).

Note the index validation only rejects the literal value `-1`; any other
non-numeric argument becomes `NaN`, passes the check, and fails later as
"Invalid task index".

### `/mission end <index>`

Closes a mission for everyone by setting `isComplete: true`.

The index is validated and the mission is looked up and written **before**
the success toast ("Task has been saved as completed") fires, mirroring
`/mission done`'s guard — a bad index now fails with "Invalid task index"
instead of toasting success and then throwing on `task.title` (improvements
item 20).

### `/mission start`

Opens a popup (`TaskCreationModal`) with the mission creation form —
title, description, task type, points, and an optional completion cap
(improvements item 41) — the same form `TaskCreation` always had. Ignores
any extra arguments. Closes automatically once a mission is created
successfully; stays open on a validation error or a duplicate title so the
GM can fix the form without retyping.

### `/mission view`

Opens a read-only popup (`TaskListModal`) listing missions split into
Active/Completed tabs — this popup has no actions of its own
(docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md). Closing a
mission out is still only done via `/mission end`; marking one done is now
reachable two ways — `/mission done`, or approving a submitted photo as
that mission from the kill-photo moderation screen
(`PhotosDisplay.js`, docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).

### `/mission undo`

Takes no arguments. Undoes the single most recent mission completed via
`/mission done` — not one approved via a photo, which has its own,
separate Undo button on the photo-moderation screen
(`PhotosDisplay.js`), tracked independently
(docs/superpowers/specs/2026-08-29-mission-undo-design.md). Restores the
completing player's score/revival/target-regeneration state exactly as it
was before the completion, and removes them from the mission's
`completedBy` list — reversing an auto-end too, if the completion had
triggered one. Shows an error ("Nothing to undo.") if there is no typed
completion left to undo, either because none was ever made or because it
was already undone.

### `/kick <player>`

Permanently removes a player from the game — self-service leaving has an
equivalent player-facing "Leave" button
(docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).

| Check            | Failure                    |
| ---------------- | -------------------------- |
| Player in roster | `Player {name} is invalid` |

Effects: the player is unmapped from the target graph (whoever was
hunting them gets a new target; whoever they were hunting gets a new
assassin, the same remap `/kill` triggers), and their document is deleted
outright — not marked dead, no trace kept. No score changes hands. This
cannot be undone, and the removed player won't be able to rejoin once the
game has started. (`/kick` itself is only reachable once the game has
already started — the console it lives in doesn't exist before Begin
Game — so this is unconditional for `/kick`; it's the player-facing
Leave button, reachable pre-game too, where a player who leaves during
the Lobby phase can still rejoin under a new identity before Begin Game
is clicked.)

### `/whisper <player> <message>`

Sends a private, player-facing message — visible only to the named player,
in their in-game chat feed (`MessageFeed`,
`src/components/player_messages_components/MessageFeed.js`, mounted in
`PlayerGame.js`). Writes to `rooms/{roomID}/playerMessages`
(docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).

| Check                                                    | Failure                           |
| -------------------------------------------------------- | --------------------------------- |
| Player in roster                                         | `Player {name} is invalid`        |
| Message (everything after the player token) is non-empty | `Whisper message cannot be blank` |

Logs a GM-facing confirmation to chat: `Whisper sent to {name}: "{message}"`.

### `/broadcast <message>`

Sends a player-facing message visible to every player, in their in-game
chat feed (`MessageFeed`). Same `playerMessages` write as `/whisper`, with
`recipient: null`.

| Check                | Failure                             |
| -------------------- | ----------------------------------- |
| Message is non-empty | `Broadcast message cannot be blank` |

Logs: `Broadcast sent: "{message}"`.

### `/leaderboard send`

Packages the live roster's current standings (sorted by score descending,
dead players included), keeps only the top 3, and sends that snapshot as a
player-facing message, visible to every player as a standings list (not
text) in their in-game chat feed (`MessageFeed`) — a quick reminder, not the
full roster, so a routine send doesn't spam the chat feed with everyone's
score. Takes no custom text — the second word must be the literal `send`.

| Check                                                  | Failure                      |
| ------------------------------------------------------ | ---------------------------- |
| Second argument is literally `send` (case-insensitive) | `{arg} is not a valid input` |

Logs: `Leaderboard sent to all players`.

### `/leaderboard view`

Opens a read-only popup (`LeaderboardModal`) on the moderator's own screen
showing every player's current score, full roster, sorted highest to
lowest — nothing is sent to players and nothing is logged. The same popup a
player can open for themselves via the "View Leaderboard" button on their
own screen (`PlayerGame.js`).

| Check                                                  | Failure                      |
| ------------------------------------------------------ | ---------------------------- |
| Second argument is literally `view` (case-insensitive) | `{arg} is not a valid input` |

---

## Implementation note

Completion is a pure function, `complete(input, { players, missions })` in
`src/game/commandCompletion.js`, unit tested independently of any component
(`src/game/commandCompletion.test.js`). It tokenizes the raw input the same
way `parseCommand` does (`src/game/commands.js`'s own `TOKEN` regex, so a
`[bracketed group]` is one argument, not several), works out which argument
slot is currently being typed, and returns the candidates and shared prefix
for that slot — nothing else. `ChatInput.js` calls it, applies the result to
the input value, and is responsible for sourcing the live `players`/
`missions` data the pure function needs; it does not decide the completion
itself.
