# Mission Edit and Delete Design

**Date:** 2026-08-20
**Status:** Approved

## Problem

A live-game-flow audit this session found that missions can be created
(`TaskCreation.js`) and marked complete (`/mission done`/`/mission end`
via `ChatInput.js`), but never edited or deleted — `src/components/task_components/TaskListModal.js`'s
own comment explicitly says `TaskList is read-only`. Re-verified this
session: still true. A GM who creates a mission with a wrong title,
description, point value, or type has no way to fix or remove it.

## Decisions

- **Both edit and delete**, not just one — covers the full original
  finding.
- **UI lives inside each mission's existing `TaskAccordion` panel** (the
  expandable card `TaskListModal` already shows for every mission), not a
  new chat-command pair. Editing multiple fields via one chat line would
  be unwieldy; the accordion panel is already where a GM looks to manage
  a mission.
- **Editing a mission's `pointValue` retroactively recalculates the score
  of every player already in its `completedBy` list**, by the delta
  between old and new values — matches this session's explicit
  confirmation, and reuses the existing, already-additive
  `dbCalls.updatePointsForPlayer` (built on Firestore's `increment()`).
- **Changing a mission's `taskType` (Task ↔ Revival Mission) is blocked
  once anyone has completed it.** A Task completion awards points; a
  Revival Mission completion revives a player — these are different
  actions, not just different numbers, and retroactively un-reviving a
  player or stripping points from a type-changed mission is out of scope.
  A GM in that situation creates a new mission instead. `title`,
  `description`, `pointValue`, and `maxCompletions` stay editable
  regardless of completion state.
- **Deleting a mission is always allowed, confirmed via an `AlertDialog`**
  (matching `PlayerRemove.js`'s just-shipped pattern), regardless of
  completion state. Deleting the mission doc never touches player
  scores/alive-status — those are historical facts, same philosophy as
  edits not retroactively changing a _different_ field's past effect. The
  confirmation dialog's text mentions the completion count when
  `completedBy.length > 0`, so the GM knows players already got credit
  for it before removing the record.
- **No title-uniqueness re-check on edit.** The create-time
  `checkForTaskDupesForRoom` guard doesn't re-apply here — editing one
  mission's title into a collision with another's is a rare,
  low-consequence edge case not worth the added complexity.

## Components

### `src/game/missionEdit.js` (new)

Pure, no Firebase, no React — matches `src/game/remapPlan.js`'s
decide-then-write pattern (CLAUDE.md's "Separate deciding from writing").

```js
/**
 * Decides what player score adjustment (if any) results from editing a
 * mission's pointValue. Returns null when no adjustment is needed:
 * taskType isn't (or didn't stay) 'Task', or pointValue didn't change.
 * Callers apply the result via dbCalls.updatePointsForPlayer, which is
 * additive (Firestore increment()), so `delta` is added directly.
 */
export const planScoreAdjustment = (oldTask, newTask) => {
    if (newTask.taskType !== 'Task') return null;
    const delta = newTask.pointValue - oldTask.pointValue;
    if (delta === 0) return null;
    return { delta, players: oldTask.completedBy };
};
```

### `src/components/firebase_calls/dbCalls.js` (modified)

Two new functions, both built on the existing
`fetchReferenceByIndexForTask(index, roomID)`:

```js
export const updateTaskForRoom = async (index, updates, roomID) => {
    const taskDocRef = await fetchReferenceByIndexForTask(index, roomID);
    await updateDoc(taskDocRef, updates);
};

export const deleteTaskForRoom = async (index, roomID) => {
    const taskDocRef = await fetchReferenceByIndexForTask(index, roomID);
    await deleteDoc(taskDocRef);
};
```

No new function needed for the score adjustment itself — `planScoreAdjustment`'s
`{delta, players}` output feeds directly into the existing
`updatePointsForPlayer(player, delta, roomID)` in a loop, one call per
affected player.

### `src/components/task_components/TaskAccordion.js` (modified)

Gains "Edit" and "Delete" buttons inside the existing `AccordionPanel`.
Reads `roomID` via `useContext(gameContext)` directly (matching
`ResetTargetsButton.js`'s existing pattern) — no prop drilling from
`TaskList.js`, which needs no changes at all: its live `onSnapshot`
subscription on the tasks collection already reflects an edit or delete
the moment it lands.

"Edit" opens the new `TaskEditModal` (below), passing the current `task`.
"Delete" opens an inline `AlertDialog` (own `useDisclosure`/`cancelRef`,
matching `PlayerRemove.js`'s exact structure and dark styling) whose body
reads roughly "Delete `<title>`? This cannot be undone." plus, when
`task.completedBy.length > 0`, an additional line naming how many players
already completed it. Confirming calls `deleteTaskForRoom(task.taskIndex,
roomID)`.

### `src/components/task_components/TaskEditModal.js` (new)

Self-contained form, pre-filled from the `task` prop — not a reuse of
`TaskCreation.js`, since editing's semantics genuinely differ (no
dupe-check, no new `taskIndex`, `isComplete`/`completedBy` preserved
untouched, `taskType` select disabled when `completedBy.length > 0`).
Fields: title, description, taskType, pointValue, maxCompletions — same
set `TaskCreation.js` collects, independently implemented here.

On submit:

1. Build `updates` from the changed fields.
2. Call `planScoreAdjustment(task, { ...task, ...updates })`.
3. If it returns non-null, show a confirmation notice before proceeding
   ("This will adjust N players' scores by `<sign><delta>` each") —
   confirming calls `updateTaskForRoom(task.taskIndex, updates, roomID)`
   followed by one `updatePointsForPlayer(player, delta, roomID)` call per
   name in `players`. If it returns null, just call `updateTaskForRoom`.
4. Close the modal on success; show an error alert (matching
   `TaskCreation.js`'s existing `createAlert` pattern) on failure, leaving
   the modal open so the GM doesn't lose their edits.

## Data flow

GM clicks Edit → `TaskEditModal` opens pre-filled → GM changes fields →
submit → `planScoreAdjustment` (pure decision) → `updateTaskForRoom` +
zero-or-more `updatePointsForPlayer` calls (writes) → `TaskList`'s live
`onSnapshot` picks up the task doc change → accordion re-renders with new
values; affected players' live score subscriptions (already existing,
e.g. `GameMasterView`'s `PlayersList`) pick up the score change the same
way any other score-affecting action already does.

GM clicks Delete → confirms in the `AlertDialog` → `deleteTaskForRoom` →
`TaskList`'s live subscription removes the accordion item.

## Error handling

Both new `dbCalls.js` functions throw on failure rather than swallowing
(matching every other function in that file, per `docs/improvements.md`
item 10) — `TaskEditModal` and `TaskAccordion`'s delete handler both wrap
their calls in `try`/`catch` and surface failures via `createAlert`,
matching `TaskCreation.js`'s existing pattern. A failure partway through
the score-adjustment loop (one player's `updatePointsForPlayer` succeeds,
a later one fails) is a real, accepted risk — not a Firestore transaction,
matching this repo's existing precedent for multi-player loops (e.g.
`ResetTargetsButton.js`'s `UpdateDatabase`) — surfaced as an error alert
naming which step failed, not silently retried.

## Testing

- `src/game/missionEdit.test.js` (unit, no DOM/Firebase): `planScoreAdjustment`
  — returns the correct `{delta, players}` when a Task's `pointValue`
  changes with existing completions; returns `null` when `pointValue` is
  unchanged; returns `null` when `taskType` isn't `'Task'`; returns `null`
  for a Revival Mission regardless of any field change.
- `src/components/task_components/TaskAccordion.test.jsx` (new or
  extended): Edit button opens `TaskEditModal` with the task's current
  values; Delete button opens the confirmation dialog and does not call
  `deleteTaskForRoom` until confirmed; the dialog's text includes the
  completion count when `completedBy` is non-empty and omits it when
  empty.
- `src/components/task_components/TaskEditModal.test.jsx` (new): submits
  `updateTaskForRoom` with only the changed fields; shows the score-
  adjustment confirmation notice when `pointValue` changes on a Task with
  existing completions, and skips it otherwise; calls
  `updatePointsForPlayer` once per name in `completedBy` with the correct
  delta when confirmed; disables the `taskType` select when
  `completedBy.length > 0`; shows an error alert and keeps the modal open
  on a failed submit.

## Out of scope

- Title-uniqueness re-checking on edit (see Decisions).
- Retroactively reversing a Revival Mission's revival, or un-scoring a
  mission whose type changed before this feature existed.
- Any change to mission creation (`TaskCreation.js`) or completion
  (`ChatInput.js`'s `/mission done`/`/mission end`) — this plan only adds
  edit and delete.
