# Shell-style, argument-aware command completion for the GM chat bar

## Problem

The chat bar's Tab-completion (shipped earlier this session, `improvements.md`
item 42) matches the _entire_ typed line against a static list of full
command strings (e.g. `/kill [player] [assassin]`) and completes the whole
line at once. Used it, didn't like it: typing `/ki` and hitting Tab jumps
straight to the full placeholder text, guessing arguments rather than
helping fill them in. What's wanted instead is closer to a shell: complete
one argument at a time, and where an argument has a knowable, finite set of
real values right now — a player's name, an active mission's index — offer
those actual values instead of a generic placeholder.

## Decisions made (confirmed with the user before this was written)

1. **Missions are fetched on demand, not via an always-on subscription.**
   The player roster is reused from `GameMasterView`'s existing live
   `onSnapshot` subscription (free — no new listener). Missions have no
   equivalent already-live source reaching `ChatInput`, and keeping a
   permanent listener open for something used occasionally isn't worth it.
   Fetched once, the moment typing reaches a mission-index argument
   position, and cached for that stretch of typing.
2. **Ambiguous matches complete to the longest common prefix**, shell-style
   (`al` with both "Alice" and "Alex" present completes to `al` and stops),
   with the existing dropdown still showing every candidate so the GM can
   see what's ambiguous and keep typing. Not cycling-on-repeated-Tab.

## Architecture

A new pure module, `src/game/commandCompletion.js`, alongside
`src/game/commands.js` — no Firebase, no React, per this codebase's
established convention (`CLAUDE.md`: "Game rules, parsing, anything
decidable from data" belongs in `src/game/`). Given the raw chat bar text
and whatever live data is relevant (players, missions), it decides what the
current argument slot is and what completes it. `ChatInput.js` stays a thin
shell: it hands this module the input plus whatever data it currently has,
and applies whatever comes back — the same relationship `ChatInput.js`
already has with `parseCommand` today.

## Command shapes

A small, declarative table — one entry per command, an ordered list of
argument "slots." Reuses `src/game/commands.js`'s existing `TOKEN` regex
tokenization, so a bracketed multi-word name (`[Alice Smith]`) is still one
slot, not two, consistent with how `parseCommand` already treats it.

`/mission` is a special case: `parseCommand` treats it as a single known
command whose _first argument_ (`done`/`end`/`start`/`view`) selects the
actual behavior — the existing `/mission` case in `ChatInput.js` already
works this way, with its own inner `switch`. The shape table mirrors that:
`/mission`'s first argument slot is a literal enum (`done`, `end`, `start`,
`view`), and which further slots follow depends on which of those four was
typed. In the table below, each `/mission …` row's "Slot 1"/"Slot 2" are
numbered relative to _that row_ — i.e. counting from after the sub-command
word, the same way `docs/commands.md` already documents
`/mission done <player> <index>` as its own entry rather than as `/mission`
plus three trailing arguments.

| Command                                  | Slot 1                                                             | Slot 2                  |
| ---------------------------------------- | ------------------------------------------------------------------ | ----------------------- |
| `/add`                                   | player                                                             | number (no suggestions) |
| `/kill`                                  | player                                                             | player                  |
| `/mission done`                          | player                                                             | active mission index    |
| `/mission end`                           | active mission index                                               | —                       |
| `/mission start`                         | — (opens a modal, no args)                                         | —                       |
| `/mission view`                          | — (opens a modal, no args)                                         | —                       |
| `/openseason`                            | player                                                             | literal: `start`, `end` |
| `/revive`                                | **dead** player only                                               | —                       |
| `/whisper`, `/broadcast`, `/leaderboard` | unimplemented — command-word completion only, unchanged from today | —                       |

"Dead player only" for `/revive` is a deliberate narrowing, not the full
roster — you can only revive someone who's dead, so suggesting the living
would just be noise. `/mission done`/`/mission end`'s mission-index slot
only offers missions where `isComplete` is still `false` — completing
_or ending_ an already-ended mission is rejected outright by items 39/40
from this session, so suggesting a closed mission's index would only lead
to that rejection.

## Data flow

- **Players**: `GameMasterView` already holds a live roster via its own
  `onSnapshot` subscription (`players` state, `src/pages/GameMasterView.js`).
  Today `ChatInput.js` ignores it and re-fetches the roster fresh via
  `fetchAllPlayersForRoom` every time a command is _submitted_ (not while
  typing — there's no roster available for suggestions at all right now).
  This design threads that same live list through `gameContext`, which
  currently provides just `{ roomID }` and becomes `{ roomID, players }`.
  `ChatInput.js` reads `players` from context for both the new
  typing-time suggestions _and_ the existing submit-time roster-membership
  check, deleting the redundant `fetchAllPlayersForRoom` call entirely —
  one live source of truth instead of two, matching this session's
  `improvements.md` item 13 precedent (collapsing disagreeing state
  sources into one subscription).
- **Missions**: no equivalent live source exists yet reaching `ChatInput.js`
  (`TaskList.js` has its own subscription, but only while a mission modal is
  open — `ChatInput.js` is always mounted). `ChatInput.js` calls
  `fetchTasksByCompletionForRoom(false, roomID)` (already exists in
  `dbCalls.js`, already used by `TaskList.js` for exactly "active missions")
  the moment typing reaches a mission-index slot, caches the result in
  local state for the rest of that typing session, and clears the cache
  once the command bar is cleared (submitted or emptied) so the next
  mission command re-fetches fresh data rather than reusing a stale list.

## Completion behavior

- Tab completes the **current slot only** — the token currently being typed
  (no trailing space yet) — not the rest of the line.
- A prefix match against the slot's candidate set (player names, mission
  indices, or a literal enum) narrows to the longest common prefix across
  all matches and replaces the in-progress token with it. A single
  unambiguous match completes fully and appends a trailing space, so typing
  can continue straight into the next slot — same as a shell.
- Completing a player name containing a space wraps it in `[brackets]`
  automatically, matching what `parseCommand`'s tokenizer already expects
  for multi-word names (`improvements.md` item 35).
- The command word itself (`/kill`, `/mission`, etc.) is slot 0, sourced
  from `src/game/commands.js`'s existing `KNOWN_COMMANDS` list rather than
  the player/mission data the later slots draw from — the same source the
  current whole-line matching already uses. This already works today and
  doesn't change in kind, only in that it now completes just that one word
  (with a trailing space) instead of guessing the rest of the line.
  `/mission`'s own sub-command word (`done`/`end`/`start`/`view`) is the
  next slot after it, sourced from that literal four-value enum.
- The existing dropdown continues to _display_ every candidate for the
  current slot (not just the longest-common-prefix result) — this is what
  answers "let me see all the existing player names" without requiring a
  full retype for each one; arrow keys + Enter still work to pick a specific
  one, same as today.
- No candidates for the current slot (e.g. mid-typing a number, or a
  `freeText`-style slot) → nothing to complete, Tab does nothing, matching
  the pre-existing "Tab does nothing when no suggestions" behavior for
  positions with nothing sensible to suggest.

## Testing

`commandCompletion.js` gets Layer 0 pure unit tests (`node` project, no
mocks, no React) — this is where the actual complexity lives (slot
resolution per command shape, longest-common-prefix matching, bracket
wrapping, the dead-players-only and active-missions-only filters) and where
it's cheapest to test thoroughly. `ChatInput.test.jsx` gets a small number
of integration tests proving the wiring only: `gameContext`'s `players`
reaches the module and drives a real completion, a mission-index slot
triggers the on-demand fetch, Tab applies the module's result to the input
— not re-testing the algorithm itself, which the pure module's tests
already cover directly.

## Out of scope

- Filtering `/mission done`'s mission-index suggestions by "missions this
  specific player (slot 1) hasn't already completed" — every active mission
  is suggested regardless of who slot 1 named. A reasonable future
  enhancement, not required by what was asked for.
- Cycling through matches on repeated Tab presses (decided against above).
- Mid-string cursor completion — the whole design assumes typing left to
  right with the cursor at the end, same assumption the existing command
  bar already makes.
- Changing anything about `/whisper`, `/broadcast`, `/leaderboard` beyond
  what they already have today (command-word completion only) — they're
  unimplemented (`improvements.md` item 21) and out of scope here.
