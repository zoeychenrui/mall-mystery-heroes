# Mission Completion via Photo Design

**Date:** 2026-08-27
**Status:** Approved

## Problem

Missions can only be marked complete by typing `/mission done <player>
<index>` in the GM chat log. Kill photos already let a moderator approve a
submitted photo from a dropdown instead of typing a command
(`PhotosDisplay.js`). Since most missions involve a photo of something (a
traffic cone, a landmark, etc.), the GM wants the same photo-approval
dropdown to also offer mission titles, so approving a mission completion
never requires typing a command either.

## Decisions

- **One combined dropdown**, not a separate submission-time toggle. A
  submitted photo still carries no category — the moderator's dropdown
  disambiguates after the fact, exactly like kill targets already do
  today. The dropdown groups two kinds of options: the photo's submitter's
  live kill targets, and every mission still open to them.
- **Both regular ("Task") missions and Revival Missions are in scope.**
  Since a Revival Mission can only be completed by a dead player, and the
  "Send Photo" button is currently disabled whenever a player has no
  targets (which is true of every dead player), that gate is removed
  entirely — any player can submit a photo at any time, regardless of
  target count.
- **The photo's submitter is automatically the player credited with
  completing the mission** — no separate "who" picker, mirroring how a
  kill photo already identifies the assassin from who submitted it, not
  from a typed name.
- **A mission only appears in the dropdown if it is still completable by
  this player**: not deleted, not already fully completed
  (`isComplete`), and not already completed by this specific player. This
  matches the validations `/mission done` already enforces — an option
  that would obviously fail is simply never offered.
- **Approving a photo as a mission reuses the exact same completion logic
  `/mission done` already runs** (recording the completion, awarding
  points or reviving the player, regenerating targets for a revival,
  auto-ending on a completion cap, logging to the GM log and player chat)
  — extracted into one shared piece of logic both the chat command and
  the new photo flow call, so the two paths can never quietly diverge.
- **Denying a photo stays a single click with no dropdown selection
  required**, and its log/chat wording becomes generic ("`<name>`'s photo
  submission was denied") instead of always saying "kill attempt," since a
  denied photo's category was never decided.
- **Undo is out of scope for mission approvals.** It keeps working exactly
  as it does today for kills and denials. Clicking Undo on a
  mission-approved photo tells the GM plainly that this isn't supported
  yet and does nothing — listed under Future improvements below, since no
  undo capability exists anywhere for mission completions today, even via
  the chat command.
- **A pre-existing bug gets fixed as part of this refactor**: today,
  attempting to complete a Revival Mission for a player who isn't actually
  dead shows an error but still records the completion and can still
  trigger the mission's completion cap, as if it had worked. The shared
  logic validates this before writing anything, matching every other
  validation in the same command.

## Components

### `src/game/missionCompletion.js` (new)

Pure, no Firebase, no React — matches `src/game/missionEdit.js`'s
decide-then-write pattern (CLAUDE.md's "Separate deciding from writing").

```js
/**
 * Decides what a mission completion should do, without performing any of
 * it. Returns { error } when the attempt is invalid — a bad index, a
 * mission that has already ended, a player who already completed it, or a
 * Revival Mission attempted by a player who is not dead — checked in
 * that order, before anything is ever written, so an invalid attempt
 * never partially lands. Otherwise returns a plan: `awardsPoints` is the
 * point value to add (a Task's own pointValue) or null (a Revival
 * Mission never awards points); `revivesPlayer` is true only for a
 * Revival Mission; `autoEnds` is true once this completion would meet or
 * exceed the mission's own optional maxCompletions cap.
 */
const planMissionCompletion = (task, playerName, { isPlayerDead }) => {
    if (!task) return { error: 'Invalid task index' };
    if (task.isComplete) return { error: `Mission ${task.taskIndex} has already ended` };
    if (task.completedBy.includes(playerName)) {
        return { error: `Player ${playerName} has already completed the mission` };
    }
    if (task.taskType === 'Revival Mission' && !isPlayerDead) {
        return { error: `Player ${playerName} is not dead` };
    }

    const completedCount = task.completedBy.length + 1;
    return {
        awardsPoints: task.taskType === 'Task' ? parseInt(task.pointValue) : null,
        revivesPlayer: task.taskType === 'Revival Mission',
        autoEnds: Boolean(task.maxCompletions) && completedCount >= task.maxCompletions,
    };
};

/**
 * Which of `missions` a given player could still complete: not deleted
 * (the caller only ever passes missions that currently exist), not
 * already ended, and not already completed by this player. Feeds the
 * photo-approval dropdown's mission options directly.
 */
const openMissionsForPlayer = (missions, playerName) =>
    missions.filter((mission) => !mission.isComplete && !mission.completedBy.includes(playerName));

module.exports = { planMissionCompletion, openMissionsForPlayer };
```

### `src/components/completeMission.js` (new)

The thin I/O shell around the decision above — matches
`src/components/RemapPlayers.js`'s exact factory-function shape (a
function of the caller's handlers, returning the actual worker function),
since both `ChatInput.js` and `PhotosDisplay.js` already construct
`RemapPlayers(handleRemapping, createAlert)` this same way.

```js
const CompleteMission = (handlers) => {
    const {
        addLog,
        handleTargetRegeneration,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
        handlePlayerRevive,
    } = handlers;

    return async (playerName, missionIndex, roomID, players) => {
        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);

        let isPlayerDead = false;
        if (task && task.taskType === 'Revival Mission') {
            const deadPlayers = (await fetchPlayersByStatusForRoom(false, roomID)).map(
                normalizePlayerName
            );
            isPlayerDead = deadPlayers.includes(playerName);
        }

        const plan = planMissionCompletion(task, playerName, { isPlayerDead });
        if (plan.error) throw new Error(plan.error);

        const taskDocRef = await fetchReferenceByIndexForTask(missionIndex, roomID);
        const displayName = resolvePlayerDisplayName(playerName, players);

        await addPlayerToCompletedByForTask(taskDocRef, playerName);
        await addLog(`${displayName} completed mission: ${task.title}`, 'green.400');
        await addPlayerMessageForRoom(
            {
                type: 'broadcast',
                recipient: null,
                text: `${displayName} completed mission: ${task.title}`,
                standings: null,
            },
            roomID
        );

        if (plan.awardsPoints !== null) {
            await updatePointsForPlayer(playerName, plan.awardsPoints, roomID);
        }

        if (plan.revivesPlayer) {
            await updateIsAliveForPlayer(playerName, true, roomID);
            handlePlayerRevive(displayName);
            const roster = await fetchAliveRosterForRoom(roomID);
            const { needTargets, needAssassins } = playersNeedingConnections(roster);
            const [targets, assassins] = await handleTargetRegeneration(
                needTargets,
                needAssassins,
                roster.map((player) => player.name),
                roomID
            );
            handleAddNewAssassins(assassins);
            handleAddNewTargets(targets);
            handleSetShowMessageToTrue();
        }

        if (plan.autoEnds) {
            await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
            await addLog(
                `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
                'purple.400'
            );
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: `Mission ${task.title} has been completed!`,
                    standings: null,
                },
                roomID
            );
        }
    };
};
```

Throws rather than catching its own errors, matching `executeKill.js`'s
convention — each caller wraps its own call in its own existing
`try`/`catch` and alert style, since the two callers already show errors
differently (`ChatInput.js`'s outer command catch vs. `PhotosDisplay.js`'s
own per-action `createAlert` call).

### `src/components/logs_components/ChatInput.js` (modified)

The `/mission done` branch's body (currently ~120 lines of inline
Firestore calls) is replaced by constructing `completeMission =
CompleteMission({ addLog, handleTargetRegeneration, handleAddNewAssassins,
handleAddNewTargets, handleSetShowMessageToTrue, handlePlayerRevive })`
(mirroring the existing `handleTargetRegeneration =
RemapPlayers(handleRemapping, createAlert)` line already there) and
calling `await completeMission(playerName, missionIndex, roomID,
players)`. The existing player-on-roster check stays in `ChatInput.js`
itself — it's about validating the typed name, not about mission
completion. A thrown error surfaces through the existing outer
try/catch's `${commandLine} failed: ${error.message}` alert, the same way
every other command's unexpected failure already does; this is a small,
acceptable wording change from today's dedicated `createAlert('error',
'Error', 'Invalid task index', 1500)`-style messages for this one
sub-command.

### `src/components/photos_display_component/PhotosDisplay.js` (modified)

- Gains its own live subscription to the room's missions
  (`onSnapshot(fetchTasksQueryForRoom(roomID), ...)`, matching
  `TaskList.js`'s existing pattern — no other component holds a live
  mission list to share).
- `currentOpenMissions = openMissionsForPlayer(missions, currentPhoto.assassin)`.
- The dropdown's options become two `<optgroup>` groups — "Kill Target"
  (the existing `currentAssassinTargets`) and "Mission" (`currentOpenMissions`,
  labeled by title). Each option's `value` is prefixed to keep the two
  kinds unambiguous even if a target's name and a mission's title happen
  to collide: `target:<name>` / `mission:<taskIndex>`. Auto-resolution
  (today's "only one option, so pick it automatically" behavior) now
  looks at the combined option count across both groups, not just
  targets.
- `handlePass` branches on the selected value's prefix. A `target:`
  selection runs exactly the existing `executeKill` flow, unchanged. A
  `mission:` selection calls `completeMission` (constructed the same way
  as in `ChatInput.js`, using this component's own already-destructured
  `addLog`/`handleRemapping`/`handleAddNewAssassins`/`handleAddNewTargets`/
  `handleSetShowMessageToTrue` from `executionContext`, plus
  `handlePlayerRevive` — already provided by the same `executionContext`
  this component already reads from, so no new plumbing is needed in
  `GameMasterView.js`), then marks the photo approved via a new
  `approvePhotoAsMissionForRoom(roomID, photoId, missionIndex)`.
- `handleDeny`'s log/chat text changes to the generic wording decided
  above, for every photo regardless of category.
- `handleUndo`'s existing `action === 'pass'` branch only ever meant "a
  kill was approved." A mission-approved photo is now a third judged
  state; clicking Undo on one shows an alert explaining undo isn't
  available for mission completions yet, and performs no write.

### `src/game/photoJudgments.js` (modified)

`splitPhotosByStatus`'s `action` for an approved photo becomes `'pass'`
when `photo.mission` is null (a kill) and `'missionPass'` when it isn't —
this is what lets `handleUndo` tell the two apart.

### `src/components/firebase_calls/dbCalls.js` (modified)

One new function, matching `approvePhotoForRoom`'s exact shape:

```js
export const approvePhotoAsMissionForRoom = async (roomID, photoID, missionIndex) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, { status: 'approved', mission: missionIndex });
};
```

### `functions/callableFunctions/submitKillPhoto.js` (modified)

The photo doc's initial write gains `mission: null`, alongside the
existing `target: null`, so the field always exists from creation —
matching how `target` is always present even before a moderator resolves
it. No other change: this function stays category-agnostic, since a
submitted photo still never declares what it's evidence of.

## Data flow

Player submits a photo (unchanged: `submitKillPhoto`, now also writing
`mission: null`) → GM opens the photo in `PhotosDisplay.js` → dropdown
shows the submitter's live kill targets and their still-open missions,
grouped → GM picks one → **kill path**: `executeKill` (unchanged) →
**mission path**: `completeMission` (`planMissionCompletion` decides,
then writes land: completedBy, GM log, player chat, points-or-revival,
auto-end) → `approvePhotoAsMissionForRoom` marks the photo approved with
its resolved mission → the existing `onSnapshot` listener picks up the
status change and moves the photo into the judged list, same as a kill
approval already does.

## Error handling

`completeMission` throws on any invalid attempt (bad index, ended
mission, already completed, not-dead-for-revival) or on any write
failure, exactly like every other function in this codebase
(`docs/improvements.md` item 10's throw-don't-swallow convention).
`PhotosDisplay.js`'s mission-approval handler wraps the call in the same
try/catch its kill-approval handler already uses — on failure, the
optimistic queue-advance is rolled back and `createAlert('error', 'Error
approving photo', error.message, 1500)` fires, so a mission that raced
into an invalid state between when the dropdown was built and Approve was
clicked (deleted, capped, or already completed by someone else in the
meantime) fails cleanly rather than partially applying.

## Testing

- `src/game/missionCompletion.test.js` (new, unit): `planMissionCompletion`
  — returns each error case (missing task, already-ended, already
  completed by this player, Revival Mission attempted by a player who
  isn't dead) without a plan; returns the correct plan for a Task
  (`awardsPoints` set, `revivesPlayer` false); for a Revival Mission
  (`awardsPoints` null, `revivesPlayer` true); `autoEnds` true once the
  completion count would meet or exceed `maxCompletions`, false
  otherwise, and false when `maxCompletions` is unset. `openMissionsForPlayer`
  — excludes an ended mission; excludes one this player already completed;
  includes everything else.
- `src/components/logs_components/ChatInput.test.jsx` (extended): the
  existing `/mission done` describe block's tests still pass against the
  refactored code path unchanged, plus a new test asserting a Revival
  Mission attempted by a player who is not dead no longer adds them to
  `completedBy` (the bug fix).
- `src/components/photos_display_component/PhotosDisplay.test.jsx`
  (extended): the dropdown lists open missions alongside kill targets,
  grouped, excluding ended/already-completed-by-this-player missions;
  approving a mission selection calls `completeMission`'s underlying
  writes (via mocked `dbCalls`) with the photo submitter as the
  completing player and marks the photo approved with the resolved
  mission index; denying any photo shows the new generic wording; Undo on
  a mission-approved photo shows the not-yet-supported message and
  performs no write.

## Documentation

`docs/data-model.md`'s `photos` collection table gains a `mission` field
row (mirroring the existing `target` row's shape: null until resolved,
then the completed mission's `taskIndex`).

## Future improvements

- **Undo for mission-approved photos.** No reversal logic exists for a
  mission completion anywhere in the app today, whether it was typed as a
  command or approved from a photo — building that is a separate,
  standalone piece of work, not part of this feature.

## Out of scope

- Moving mission completion onto a server-side Cloud Function (matching
  how kills already work via `executeKill`/`killPlayer.js`). Mission
  completion stays client-orchestrated, exactly as it is today — this
  feature only lets a moderator trigger the existing client-side logic
  from a different UI, not changes where that logic runs.
- Renaming the `killPhoto` `playerMessages` type or its rendering. A
  submitted photo's own chat entry stays generic in name only; nothing
  about its behavior changes.
