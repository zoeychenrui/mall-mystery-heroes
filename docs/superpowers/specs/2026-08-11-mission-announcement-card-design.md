# New-mission announcement card

## Problem

`handleNewTaskAdded` (`GameMasterView.js`) broadcasts a new mission to
players' chat feed (`MessageFeed.js`) as plain text —
`'Added new task: ' + newTask.title`. The user tested this live and said
it "sounds like a bot" — a mission is a multi-field thing (title,
description, type, points, how many players can attempt it) and a single
text line loses all of that. They want a real "New Mission!" card instead,
showing the mission's details.

## Decisions made

- **Mission creation only.** Mission completion and mission-end broadcasts
  (both currently plain text) are out of scope — they're short,
  single-fact statements that read fine as text, unlike a new mission's
  several fields.
- **Replaces, not adds to, the current text broadcast.** `handleNewTaskAdded`
  sends the new structured message instead of the plain-text one, not both.
  The GM's own console log (`addLog`) is unchanged — this only changes
  what players see.
- **Follows the existing `'leaderboard'` pattern exactly**, not a new
  mechanism. `playerMessages` already has one non-text, structured message
  type (`'leaderboard'`, carrying a `standings` field instead of `text`)
  with its own rendering branch in `MessageFeed.js`. This adds a second:
  `'mission'`, carrying a `mission` field.

## Architecture

### Data shape

```js
{
    type: 'mission',
    recipient: null,
    text: null,
    standings: null,
    mission: {
        title: string,
        description: string,
        taskType: 'Task' | 'Revival Mission',
        pointValue: string | number,
        maxCompletions: number | null,
    },
}
```

`mission`'s five fields are copied directly from the `newTask` object
`handleNewTaskAdded` already receives (`docs/data-model.md`'s
`rooms/{roomID}/tasks` schema) — no new data is computed, just forwarded.

### `src/pages/GameMasterView.js`

`handleNewTaskAdded` replaces its current
`await broadcast('Added new task: ' + newTask.title);` with a direct
`addPlayerMessageForRoom` call carrying the shape above (matching how
`/leaderboard send` builds its own message directly rather than going
through the `broadcast(text)` helper, since that helper is `text`-only).
The existing `addLog('Added new task: ' + newTask.title, 'yellow.400')`
call is unchanged.

### `src/components/player_messages_components/MessageFeed.js`

A new render branch, sibling to the existing `'leaderboard'` branch:

- Heading: **"New Mission!"**
- The mission's `title`
- The mission's `description`
- A details line: `taskType`, `pointValue`, and the participant limit —
  `"Unlimited players"` when `maxCompletions` is `null`, `"Limited to {N}
players"` when set. Revival missions show `0` points plainly (that's
  genuinely what they award), not hidden.

## Testing

- `MessageFeed.test.jsx`: a `'mission'`-type message renders "New
  Mission!", the title, the description, and the details line; the
  unlimited-vs-limited participant copy is tested for both states.
- `GameMasterView.test.jsx`: `handleNewTaskAdded`'s existing test is
  updated (or a new one added) asserting `addPlayerMessageForRoom` was
  called with the `'mission'` shape above instead of the old plain-text
  broadcast; `addLog`'s existing assertion is unchanged.

## Scope

**In scope:** the `'mission'` message type, `handleNewTaskAdded`'s change,
and `MessageFeed.js`'s new render branch.

**Explicitly out of scope:**

- Mission completion/end broadcasts — stay plain text.
- Any change to the GM console's own log output.
- Any change to `/leaderboard`'s existing structured-message pattern
  beyond following it as precedent.
