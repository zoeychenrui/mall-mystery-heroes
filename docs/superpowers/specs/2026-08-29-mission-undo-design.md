# Mission Undo Design

**Date:** 2026-08-29
**Status:** Approved

## Problem

No reversal logic exists for a mission completion anywhere in the app,
whether it was typed as `/mission done` or approved from a photo — a
mistake (wrong player, wrong mission, a moderator misreading a photo) is
permanent. Kills already have this via an Undo button, and mission
completion via photo already has an inert guard for it
(`PhotosDisplay.js`'s `handleUndo` shows "Undo isn't available for mission
completions yet" for a `missionPass` photo). Flagged as a Future
improvement when mission-completion-via-photo shipped
(docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).

## Decisions

- **Mission completion moves onto Firebase's servers**, one atomic step,
  mirroring `killPlayer.js`. Today `completeMission.js` runs entirely from
  the GM's browser as a sequence of separate writes — safe enough for
  completion itself, but undo needs a "before" snapshot taken at the exact
  same instant as the writes it's reversing, the same guarantee kill-undo
  already has from running inside one Cloud Function transaction. Doing
  this the same way as kill-undo (snapshot-then-replay from separate
  client reads) would leave a race window where something else changes a
  player's data between the snapshot and the completion's own writes.
  Reopens an explicit "stays client-orchestrated" decision from the
  mission-completion-via-photo spec — a deliberate choice this time, not
  an oversight.
- **Two independent undo stacks, not one shared "last completion
  anywhere."** A GM who approves a photo as a mission, then later types a
  different mission's completion, expects the photo screen's Undo button
  to undo _that photo_ — not whatever happened most recently regardless of
  which UI it came from. So: photo-approved completions and typed
  (`/mission done`) completions each track their own separate "most
  recent" independently. Both still call the same underlying reversal
  logic server-side — only where each looks up "what to reverse" differs.
- **Undo only reaches the single most recent completion in its own
  stack** — no history, no picking an older one, matching exactly how
  kill-undo's own Undo button already works (scoped to the last judged
  photo, not an arbitrary one).
- **Photo-approved missions reuse the existing Undo button.** No new UI —
  `PhotosDisplay.js`'s `missionPass` guard, which currently just shows a
  message and does nothing, gets real reversal logic instead.
- **Typed completions get a new `/mission undo` command, with no
  arguments.** It always means "undo the last typed completion," the same
  one-action simplicity as clicking the existing Undo button — no player
  name, no mission number to type. Shows up in the same `/mission`
  tab-completion list as `done`/`end`/`start`/`view`.
- **Neither undo path needs a confirmation step**, matching the existing
  Undo button's own one-click behavior today.
- **The pure decision logic (`planMissionCompletion`) moves server-side
  too**, vendored into `functions/vendor/game/` the same way
  `remapPlan.js`/`playerNames.js`/`targetGraph.js`/`rateLimit.js`/`killPhotoUrl.js`
  already are for `killPlayer.js`'s use — it's pure, no Firebase, exactly
  the kind of logic this repo already shares between the client and
  Cloud Functions this way. `openMissionsForPlayer` (client-only — it only
  ever feeds the photo-approval dropdown) stays exactly where it is.
- **`src/components/completeMission.js` (the current client-side
  orchestration) is deleted.** Its job moves entirely into the new Cloud
  Function; keeping it around unused would be dead code (matching this
  repo's own precedent of deleting `addPlayerForRoom`/`remapPlayerAsTarget`
  once they became unreferenced — docs/improvements.md items 47, 49).

## Components

### `functions/callableFunctions/completeMission.js` (new)

Replaces `src/components/completeMission.js`'s orchestration, called by
both `ChatInput.js`'s `/mission done` and `PhotosDisplay.js`'s
photo-approval flow. Mirrors `killPlayer.js`'s shape exactly: one
`db.runTransaction`, read phase gathers the task and (for a Revival
Mission) whether the player is dead, decides via the vendored
`planMissionCompletion`, then a write phase that mirrors
`completeMission.js`'s current five effects (record `completedBy`, award
points or revive-and-regenerate-targets, auto-end on `maxCompletions`) —
but with every touched player's _pre-write_ state captured first, the same
`preWriteDataByName`-then-`preKillSnapshot` pattern `killPlayer.js` already
uses. For a Task completion, that's just the completing player (if points
were awarded). For a Revival Mission, that's the revived player plus every
player the target/assassin regeneration reassigned — `planRemap`
(vendored, same as `killPlayer.js` already uses) runs _inside_ this
transaction now, not via the client's `RemapPlayers.js`, so the same roster
read/write ordering guarantees `killPlayer.js` already relies on apply
here too.

Returns:

```js
{
    reversalSnapshot: {
        missionIndex,
        playerName, // normalized
        wasAutoEnded: boolean, // task's isComplete flipped by this completion
        players: {
            [normalizedName]: { score, targets, assassins, isAlive, openSeason },
        },
    },
    addedTargets, // for the client's RemapPlayerModal, same as killPlayer's response
    addedAssassins,
    remapLogs,
}
```

`reversalSnapshot` is the one shape both undo stacks store and both undo
paths consume — the mission-completion equivalent of `preKillSnapshot`,
just carrying the extra task-level facts (`missionIndex`, `wasAutoEnded`)
a kill's snapshot doesn't need since a kill has no equivalent to
`completedBy`/`isComplete`.

Throws the same `planMissionCompletion` error strings
(`Invalid task index`, already-ended, already-completed,
not-dead-for-revival) as `HttpsError`s, matching every other callable in
this codebase.

### `functions/callableFunctions/undoMissionCompletion.js` (new)

The one shared reversal step both undo paths call. Takes a
`reversalSnapshot` (looked up by the caller — see below — not trusted from
the client directly, to avoid a client forging one) plus enough to locate
it server-side, and inside one transaction: writes every entry in
`players` back verbatim (mirrors `undoKillPlayer.js`'s replay exactly),
removes `playerName` from the task's `completedBy`, and — only if
`wasAutoEnded` — sets the task's `isComplete` back to `false`. Two thin
`onCall` wrappers around one shared internal function, since the two
stacks look up their snapshot differently:

- **`undoMissionPhotoApproval`** — takes `{roomId, photoId}` (exactly
  `undoKillPlayer`'s own argument shape). Reads the snapshot from the
  photo document's new `missionUndoSnapshot` field, verifies the photo's
  `status` is `'approved'` and `mission` is set (mirrors
  `undoKillPlayer.js`'s own `status !== 'approved'` guard), then runs the
  shared reversal and resets the photo back to `pending` — mirrors
  `undoKillPlayer.js` line for line, just reading a different snapshot
  field.
- **`undoMissionCommand`** — takes `{roomId}` only. Reads the snapshot
  from the room document's new `lastMissionCommandCompletion` field,
  errors with a clear message if that field is absent (nothing to undo —
  either nothing was ever typed-completed, or it was already undone), runs
  the shared reversal, then clears the field back to `null` so a second
  `/mission undo` with nothing pending gives that same clear error rather
  than silently redoing the last undo.

### `dbCalls.js` (modified)

- `approvePhotoAsMissionForRoom(roomID, photoID, missionIndex, reversalSnapshot)`
  gains a fourth argument, writing `missionUndoSnapshot: reversalSnapshot`
  alongside the existing `status`/`mission` fields.
- New: `fetchLastMissionCommandCompletion`/whatever the client needs to know
  whether `/mission undo` has anything to act on is **not** needed as a
  separate read — the command just calls `undoMissionCommand` unconditionally
  and shows whatever error it throws, the same way the existing photo Undo
  button doesn't pre-check either (its own no-op guard is just "is there a
  judged photo at all," not "is undo actually possible").

### `src/components/logs_components/ChatInput.js` (modified)

- `/mission done`'s case body calls the new `completeMission` Cloud
  Function (a new thin client wrapper, `src/components/completeMission.js`
  — reusing the now-freed filename, since the old orchestration file this
  name belonged to is deleted — mirrors `executeKill.js`'s three-line
  shape exactly) instead of constructing `CompleteMission({...})`. The
  returned `reversalSnapshot` is written to the room's
  `lastMissionCommandCompletion` field via a new `dbCalls` function
  (`recordLastMissionCommandCompletion`). `addedTargets`/`addedAssassins`/
  `remapLogs` route to the same handlers `/kill` already uses for these.
- New `case 'undo':` under `case '/mission':`, calling a new client
  wrapper (`undoMissionCommand.js`, mirroring `undoKill.js`'s shape) with
  just `roomID`, no arguments parsed from the command line. Success logs
  and broadcasts a generic undo announcement — `'Undo: the last mission
completion was reverted'` — for the GM log and player chat, both.
  (Amendment: this is deliberately generic, not `` `Undo: ${displayName}'s
completion of "${task.title}" was reverted` `` as originally specified
  here. `undoMissionCommand`/`undoMissionPhotoApproval` don't return who
  or what was undone — only that the reversal succeeded — and neither
  client-side undo path has an independent reason to need that detail
  beyond display text, so building it out was judged disproportionate to
  the value of a more specific string. A deliberate implementation
  choice, not an oversight.)

### `src/components/photos_display_component/PhotosDisplay.js` (modified)

- The `mission:` branch of `handlePass` calls the new `completeMission`
  Cloud Function directly (not the deleted client orchestration), then
  passes its `reversalSnapshot` into `approvePhotoAsMissionForRoom`'s new
  fourth argument.
- `handleUndo`'s `action === 'missionPass'` branch stops showing the
  "not supported yet" alert — it now calls the new
  `undoMissionPhotoApproval` client wrapper with `{roomId, photoId}`
  (mirroring the existing `undoKill(roomID, photo.id)` call one branch up),
  logs/broadcasts the same generic undo-announcement wording described
  above, and relies on the same `onSnapshot` listener (already existing)
  to pick up the photo's `status: 'pending'` reset.

### `src/game/commandCompletion.js` (modified)

`MISSION_SUBCOMMANDS` gains `'undo'`; `MISSION_ARG_LABELS` gains
`undo: []` (no further arguments to complete).

### `functions/scripts/sync-shared-game-logic.js` (modified)

Adds `missionCompletion.js` (specifically its `planMissionCompletion`
export — `openMissionsForPlayer` still only runs client-side, but vendoring
the whole file is simpler than splitting it, matching how the other
vendored files are copied whole even when a Cloud Function only uses part
of what they export) to the list of files synced into
`functions/vendor/game/`.

### Deleted

- `src/components/completeMission.js` (the current client orchestration —
  superseded by the new Cloud Function; the filename is reused above for
  the new thin callable wrapper, matching `executeKill.js`'s naming).

## Data model changes

- **`rooms/{roomID}/photos/{autoId}`**: new field `missionUndoSnapshot`
  (`object | null`) — the `reversalSnapshot` `completeMission` returned,
  persisted at approval time, mirroring `originalPlayerData`'s role for
  kills. `null`/absent for a kill-approved or denied photo.
- **`rooms/{roomID}`**: new field `lastMissionCommandCompletion`
  (`object | null`) — the most recent `/mission done` completion's
  `reversalSnapshot`, overwritten by every new typed completion, cleared
  to `null` by `undoMissionCommand` once used. Absent/`null` means nothing
  to undo.

## Error handling

Both new Cloud Functions throw `HttpsError`s on every failure path
(unauthenticated, room/photo not found, not the host, nothing to undo,
a player named in the snapshot no longer exists — mirrors
`undoKillPlayer.js`'s own `failed-precondition` for exactly that case),
matching this codebase's throw-don't-swallow convention. `ChatInput.js`'s
`/mission undo` surfaces a thrown error through the same outer
`` `${commandLine} failed: ${error.message}` `` catch every other command
already uses. `PhotosDisplay.js`'s mission-undo call reuses its existing
`handleUndo` `try`/`catch`/`createAlert` pattern, unchanged in shape from
the kill-undo branch two lines above it.

## Testing

- `functions/callableFunctions/completeMission.test.js` (new, emulator):
  mirrors `killPlayer.integration.test.js`'s structure — a Task completion
  awards points and returns a snapshot naming only the completing player;
  a Revival Mission completion revives the player, reassigns targets for
  everyone the regen touched, and the snapshot names every one of them;
  hitting `maxCompletions` sets `isComplete` and the snapshot's
  `wasAutoEnded` is `true`; every `planMissionCompletion` error case
  throws the matching `HttpsError` and writes nothing.
- `functions/callableFunctions/undoMissionCompletion.test.js` (new,
  emulator): both `undoMissionPhotoApproval` and `undoMissionCommand`
  restore every player in a snapshot verbatim, un-set `isComplete` only
  when `wasAutoEnded` was true, remove the player from `completedBy`;
  `undoMissionPhotoApproval` resets the photo to `pending`;
  `undoMissionCommand` clears `lastMissionCommandCompletion`; a second
  `/mission undo`-equivalent call with nothing pending throws a clear
  error; a snapshot naming a player who no longer exists throws instead
  of partially reversing.
- `src/game/commandCompletion.test.js` (extended): `/mission u` completes
  to `/mission undo` with no further argument slots.
- `ChatInput.test.jsx` (extended): `/mission undo` calls the new client
  wrapper with just `roomID`; logs and broadcasts the undo announcement on
  success; surfaces a thrown error through the existing outer-catch
  wording.
- `PhotosDisplay.test.jsx` (extended): clicking Undo on a `missionPass`
  photo now calls `undoMissionPhotoApproval` instead of showing the
  placeholder alert, and logs/broadcasts the same wording kill-undo's
  branch already does.

## Future improvements

- Undoing the same completion twice in a row (a double-click race) is not
  specifically guarded beyond what the "nothing to undo" error already
  catches for the command path, and beyond the photo's own `status`
  precondition check for the photo path — both already prevent a
  double-undo from partially reversing twice, but neither has dedicated
  test coverage for the exact double-click timing. Worth a follow-up test
  if this ever surfaces as a real report.

## Out of scope

- Undo history beyond the single most recent completion in each stack.
- Undoing an undo (redo).
- Any change to kill-undo's own behavior, or to `TaskEditModal.js`'s
  separate, already-existing "adjust scores on edit" flow (a different
  feature — editing a mission's point value retroactively — not touched
  here).
