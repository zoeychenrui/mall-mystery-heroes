# Firestore data model

There is no schema declaration anywhere in the codebase — no rules file, no
converters, no TypeScript types. This document is reconstructed from the call
sites in `src/components/firebase_calls/dbCalls.js` and is the only written
record of the shape of the data.

Everything is scoped under a single top-level collection:

```
rooms/{roomID}
  ├─ players/{trimmedNameLowerCase}
  ├─ tasks/{autoId}
  ├─ photos/{autoId}
  └─ logs/{autoId}
```

`roomID` is a human-readable document ID, not an auto-ID — see
[Room ID generation](#room-id-generation).

---

## `rooms/{roomID}`

The room document holds game-wide state. Chat logs live in a subcollection
(below), not on this document.

| Field                          | Type                     | Written by                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hostId`                       | `string`                 | `DashBoard`'s `resolveDestination`                                                                                            | The creating user's `auth.uid`. Read by `firestore.rules` to scope access — see [architecture.md](./architecture.md#authentication-and-authorization). Not read anywhere in application code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `isGameActive`                 | `boolean`                | `DashBoard`'s `resolveDestination` (`true`), the `endGame` Cloud Function (`false`, `functions/callableFunctions/endGame.js`) | `GameMasterView` subscribes to this and disables `ChatInput` once it's `false` (docs/improvements.md item 15) — no longer write-only. Also read by `dbCalls.fetchActiveRoomForHost`, which `DashBoard.js` uses to find a room the signed-in GM is already running rather than always creating a new one (docs/superpowers/specs/2026-08-08-dashboard-removal-design.md). Also read by `src/pages/PlayerGame.js`, which hides the target/status text and disables kill-photo submission (though not chat) once it's `false`. Also read by `functions/callableFunctions/joinRoom.js`, which rejects self-registration on a room where it's `false`. `firestore.rules` denies any direct client write to this field — only the Cloud Function (Admin SDK) may change it, since it also has to clear exposure in the same transaction.                                                                                                                                                                                                                                                                                 |
| `gameStarted`                  | `boolean`                | `DashBoard`'s `resolveDestination` (`false`), `dbCalls.markGameAsStarted` (`true`, called from `TargetGenerator.onYesClose`)  | Distinct from `isGameActive`: this answers "has the Lobby phase ended," not "does the room still exist." Read by `joinRoom` (`functions/callableFunctions/joinRoom.js`) via the Admin SDK to reject self-registration once targets have been generated (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md). Also read by `dbCalls.fetchActiveRoomForHost` to decide whether a returning GM's existing room routes to the lobby or straight to `GameMasterView`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `endedAt`                      | `Timestamp \| undefined` | the `endGame` Cloud Function (`functions/callableFunctions/endGame.js`)                                                       | `FieldValue.serverTimestamp()`, set when "End Game" (or "Abandon Room") is confirmed. Absent on a room that's never been ended. Read by the scheduled `cleanupEndedRooms` function to decide what's old enough to delete. `firestore.rules` denies any direct client write to this field, same reason as `isGameActive` above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `createdAt`                    | `Timestamp \| undefined` | `DashBoard`'s `resolveDestination` (`serverTimestamp()`)                                                                      | Absent on rooms created before `docs/improvements.md` item 56. Read only by `dbCalls.fetchActiveRoomForHost`, which sorts a host's active rooms newest-first so two rooms created by a near-simultaneous double-login race still resolve to the same one on every reload; a room missing this field sorts as older than any timestamped room.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `taskIndex`                    | `number`                 | `DashBoard`'s `resolveDestination` (`1`), `dbCalls.fetchTaskIndexThenIncrement`                                               | Monotonic counter handing out human-facing mission numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `joinedUids`                   | `array<string>`          | `DashBoard`'s `resolveDestination` (`[]`), `joinRoom` (`arrayUnion`)                                                          | Every `auth.uid` that has self-registered via `joinRoom`. Read by `firestore.rules`' `isPlayerOfRoom` to scope reads to "host or player of this room" — Firestore rules can't query "does any player doc have field X == Y," only fetch a known path, so this room-level list is what makes room-scoped reads checkable at all (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `lastMissionCommandCompletion` | `object \| null`         | `dbCalls.recordLastMissionCommandCompletion` (`ChatInput.js`'s `/mission done`), cleared to `null` by `undoMissionCommand`    | The most recent `/mission done` completion's `reversalSnapshot`, overwritten by every new typed completion. Absent/`null` means `/mission undo` has nothing to act on. Independent from `missionUndoSnapshot` on a photo doc — two separate undo stacks, one per way a mission can be completed (docs/superpowers/specs/2026-08-29-mission-undo-design.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `gameBoundary`                 | `object \| undefined`    | `publishGameBoundary` and `disableGameBoundary` (Cloud Functions, Admin SDK)                                                  | The game-area boundary, absent on rooms that never had one published. Fields: `enabled` (`boolean`), `revision` (`number`, increases on every publish or disable), `shapeType` (`'freehand' \| 'rectangle' \| 'circle' \| 'oval'`), `vertices` (`array<{lat, lng}>`, the closed polygon, at most 500 entries including closure), `shapeParameters` (`object \| null`, the center/radii or corners needed to reopen the editor — for `rectangle` and `oval`, also an optional `rotationDegrees` (`number`, clockwise, absent/`0`/`null` meaning unrotated); `circle` has no rotation field, since rotating a circle doesn't change it, and `freehand` has no `shapeParameters` at all, its `vertices` being the only record), `updatedAt` (`serverTimestamp()`). `reportPlayerLocation` reads it to check each report's `boundaryRevision`. Client writes to this field are denied by `firestore.rules`, and room writes must update fields, not overwrite the whole room document: a non-merge `setDoc` over an existing room that has a `gameBoundary` field is denied, because the overwrite removes that field. |
| `storageReference`             | `array`                  | `DashBoard`'s `resolveDestination` (`[]`)                                                                                     | Written empty at creation, never read or appended. Vestigial.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## `rooms/{roomID}/logs/{autoId}` ✅ Resolved (improvements item 22)

The chat/event log. One document per entry — until this item, `logs` was an
array field on the room document itself, appended with `arrayUnion`. Two
problems followed from that: Firestore's 1 MiB document limit capped a
game's total log history and every message rewrote the whole document, and
`arrayUnion` deduplicates by deep equality, so two identical messages in the
same second (same `time`/`log`/`color`) silently collapsed into one.

| Field       | Type        | Notes                                                                      |
| ----------- | ----------- | -------------------------------------------------------------------------- |
| `time`      | `string`    | e.g. `"3:42:07 PM"`, from `Date#toLocaleTimeString()`. Display only.       |
| `log`       | `string`    | The message text.                                                          |
| `color`     | `string`    | A Chakra color token (e.g. `"red.400"`) or a raw CSS color.                |
| `timestamp` | `Timestamp` | `serverTimestamp()`. Used only for `orderBy` — mirrors `photos.timestamp`. |

Written by `dbCalls.addLogForRoom` (an `addDoc`, replacing the old
`updateLogsForRoom`'s `updateDoc` + `arrayUnion`). Read by
`GameMasterView` via a live `onSnapshot` subscription on
`fetchLogsQueryByAscendingTimestampForRoom`, not a one-time fetch — see
[improvements.md item 13](./improvements.md) for why that matters (a second
GM's log entries are no longer invisible until reload).

The colors in use, by event type:

| Color        | Event                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `red.400`    | player killed                                                                                                 |
| `blue.300`   | player revived                                                                                                |
| `blue.200`   | photo judgment undone                                                                                         |
| `blue.400`   | new target assigned (target reset)                                                                            |
| `blue.500`   | remapping after a kill                                                                                        |
| `lightblue`  | open season started                                                                                           |
| `pink.400`   | open season ended                                                                                             |
| `green.400`  | mission completed (by `/mission end`, or by a player via `/mission done` — improvements item 40)              |
| `purple.400` | mission auto-ended by reaching its completion cap (improvements item 41)                                      |
| `orange.300` | power-up bought from the player shop, by `purchasePowerUp` (global pings also name who was pinged)            |
| `orange.500` | GPS alert from a ping, by `purchasePowerUp`: a pinged player's position was stale (older than 30s) or missing |
| `purple.300` | a Horcrux saved a player from a kill, by `killPlayer`                                                         |
| `yellow.400` | mission created                                                                                               |
| `gray`       | revive undone, photo denied                                                                                   |

---

## `rooms/{roomID}/players/{trimmedNameLowerCase}`

One document per player. Created by the `joinRoom` Cloud Function
(`functions/callableFunctions/joinRoom.js`), which runs the duplicate
check and the write in a single Firestore transaction keyed on the
document ID — this is what makes two concurrent joins under the same name
safe (one succeeds, one rejects). `dbCalls.fetchPlayerReferenceForRoom`
(used by `PlayerGame.js` to live-subscribe to a player's own doc) also
builds this same ID directly from the player's name, so the ID scheme is a
public contract, not just an implementation detail of `joinRoom`. Before
the 2026-08-14 simplified-lobby redesign, players could also be created by
a GM's manual "Add Player" form (`dbCalls.addPlayerForRoom`, since deleted
— docs/improvements.md item 47) using the same ID scheme; that path no
longer exists, so every player doc today is created by `joinRoom` and
carries a `uid`. Player docs created before either change keep their old
auto-generated IDs; those are invisible to `fetchPlayerReferenceForRoom`'s
by-ID lookup, so such a player would not get a live player-doc
subscription (everything that queries by `trimmedNameLowerCase` is
unaffected).

| Field                  | Type                                                                                                                                                       | Initial                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                 | `string`                                                                                                                                                   | as typed                            | Display value only. Not queried anywhere — see `trimmedNameLowerCase`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `trimmedNameLowerCase` | `string`                                                                                                                                                   | `name` minus whitespace, lowercased | The actual lookup key — every function in `dbCalls.js` that finds a player by name queries this field, via `normalizePlayerName()`. Also the document ID for players created by `joinRoom`, the current, sole creation path.                                                                                                                                                                                                                                   |
| `isAlive`              | `boolean`                                                                                                                                                  | `true`                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `score`                | `number`                                                                                                                                                   | `10`                                | Reset to `0` on death. Read back with `parseInt` in places, implying it is sometimes a string. Also lowered by `purchasePowerUp` by the item's price (always written back as a number).                                                                                                                                                                                                                                                                        |
| `targets`              | `array<string>`                                                                                                                                            | `[]`                                | Names this player is hunting.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `assassins`            | `array<string>`                                                                                                                                            | `[]`                                | Names hunting this player.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `openSeason`           | `boolean`                                                                                                                                                  | `false`                             | When true, _anyone_ may kill this player, and this player may kill anyone.                                                                                                                                                                                                                                                                                                                                                                                     |
| `rateLimits`           | `{photo: {windowStart: Timestamp, count: number}, chat: {windowStart: Timestamp, count: number}, boundaryReport: {windowStart: Timestamp, count: number}}` | absent                              | Written and read by `submitKillPhoto`/`submitChatMessage`/`reportPlayerLocation` (inside their own transactions) to enforce a rolling 60-second burst allowance per player — 10 kill photos, 20 chat messages, and 20 location reports (`boundaryReport`). Each key is absent until that player's first submission of that kind, and the keys are independent. Nothing else reads this field; it is never shown in the UI.                                     |
| `powerUpCooldowns`     | `{ [itemId]: Timestamp }`                                                                                                                                  | absent                              | Written and read by `purchasePowerUp` (inside its transaction): each key is a `src/game/powerUps.js` item id, each value when that item can next be bought, on the server's clock. A key is absent until the player's first purchase of that item and is overwritten, never deleted, by later purchases. Read by `PlayerGame.js` via its player-doc subscription and passed to `PowerUpShopModal` to draw the cooldown cover.                                  |
| `horcrux`              | `boolean`                                                                                                                                                  | absent                              | Set `true` by `purchasePowerUp` when the player buys (or rolls) a Horcrux, with `horcruxEndsAt: null`. Read through `src/game/powerUpEffects.js`'s `isHorcruxActive`, never directly: it protects while `horcruxEndsAt` is null or in the future. Set `false` by `killPlayer` when a kill goes through.                                                                                                                                                        |
| `horcruxEndsAt`        | `Timestamp \| null`                                                                                                                                        | absent                              | `null` while a held Horcrux hasn't saved anyone. Set by `killPlayer` to 5 seconds after the first kill attempt it blocks — the grace period during which every further attempt also fails.                                                                                                                                                                                                                                                                     |
| `cameraBlockedUntil`   | `Timestamp`                                                                                                                                                | absent                              | Set by `purchasePowerUp` ("Block a player's camera") to 30 seconds ahead on the _targeted_ player's doc. Until then `submitKillPhoto` rejects their photos and `MessageComposer.js` disables the camera button with an X over it.                                                                                                                                                                                                                              |
| `pendingMysteryItem`   | `string`                                                                                                                                                   | absent                              | An item id (`'global-ping-picked'` or `'block-camera'`) the mystery box rolled that needs a player picked. Set by `purchasePowerUp`, deleted by `claimMysteryReward` once used. Another mystery box can't be bought while it's set.                                                                                                                                                                                                                            |
| `uid`                  | `string`                                                                                                                                                   | absent                              | The Firebase Auth uid that self-registered as this player, written only by `joinRoom` (`functions/callableFunctions/joinRoom.js`). Historically absent on GM-added players, created via the now-deleted `dbCalls.addPlayerForRoom` before the 2026-08-14 simplified-lobby redesign removed the manual-add UI; every player doc today is created by `joinRoom` and carries a `uid` (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md). |

**One `uid` is not guaranteed to own only one player doc in a room.**
`joinRoom` checks that the _name_ is free, not that the joining `uid` is
new to the room, so the same person joining twice under two names ends up
with two player docs sharing a `uid` (docs/improvements.md item 66).
`submitKillPhoto`/`submitChatMessage` reject such a caller outright rather
than guessing which doc is "them"; `Homepage.js`'s session recovery, whose
collection-group query legitimately spans rooms, prefers a candidate whose
room is still `isGameActive`.

### The target graph

`targets` and `assassins` are two directed adjacency lists that must stay
mutually consistent: if `A.targets` contains `B`, then `B.assassins` must
contain `A`. Nothing enforces this at the schema level. Three separate code
paths maintain it:

- `TargetGenerator` (initial assignment, in the lobby) — writes players one
  at a time, no batch or transaction.
- `ResetTargetsButton` (hard reset mid-game — a near-verbatim copy of the
  above) — same caveat.
- `RemapPlayers` (incremental repair after a revival; used to also run after
  a kill, before item 4) — same caveat.

Kills are the exception: `functions/callableFunctions/killPlayer.js`
(improvements item 4) does the removal-from-the-graph step that used to be
`UnmapPlayers` (deleted) and the post-kill remap step that used to be a
separate `RemapPlayers` call, both inside one Firestore transaction. A
partial write is no longer possible for a kill specifically — either the
whole graph update lands or none of it does. `TargetGenerator`,
`ResetTargetsButton`, and `RemapPlayers`'s remaining caller (`/revive`) are
still one-write-at-a-time and can still leave the two lists disagreeing if
interrupted.

`targetsLength`/`assassinsLength` used to exist here as a denormalized
`array.length`, so Firestore queries could `orderBy` array size — removed
entirely (improvements item 9). Nothing had read them since `RemapPlayers`
moved to in-memory matching via `planRemap` (item 17); the two
`fetchAlivePlayersByAscend…LengthForRoom` functions that queried by them
were confirmed-dead code, and `killPlayer` (item 4) never maintained them in
the first place, so every kill was already leaving them stale. Deleting the
fields removes the drift rather than chasing every writer.

### Name casing ✅ Resolved (improvements item 1)

Stored names preserve the GM's capitalization. Every lookup in `dbCalls.js`
now queries `trimmedNameLowerCase`, and `ChatInput.js`'s comparisons against
arrays that come back case-preserved (`fetchPlayersByStatusForRoom`)
normalize both sides before comparing — so a player named `Alice` can be
referenced from the command bar as `alice`. `killPlayer.js` (the Cloud
Function, `improvements.md` item 4) does the same normalization on the
server side for kills specifically.

Not covered: `trimmedNameLowerCase` strips all whitespace, but `ChatInput`'s
`.toLowerCase()` calls don't strip any, so a multi-word bracketed name like
`[Alice Smith]` can still mismatch. See
[improvements.md item 35](./improvements.md).

---

## `rooms/{roomID}/tasks/{autoId}`

Missions the GM sets for players. Created by `TaskCreation` via
`dbCalls.addTaskForRoom`, edited by `TaskEditModal` via
`dbCalls.updateTaskForRoom`, and deleted by `TaskAccordion` via
`dbCalls.deleteTaskForRoom` — the collection has all three write paths as of
`docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md`. Editing a
mission's `pointValue` after players have completed it also writes each
completing player's `score` (`rooms/{roomID}/players/{trimmedNameLowerCase}`
above), via `dbCalls.updatePointsForPlayer` once per name in `completedBy` —
the delta is decided by `src/game/missionEdit.js`'s `planScoreAdjustment` and
applied only after the GM confirms it. Not a transaction: the mission write
and the per-player increments are separate, sequential writes.

| Field                   | Type                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                 | `string`                      | Required, non-blank — enforced on both the create and the edit path.                                                                                                                                                                                                                                                                                                                                           |
| `titleTrimmedLowerCase` | `string`                      | `title` minus whitespace, lowercased. Used by `checkForTaskDupesForRoom` to reject duplicates. Recomputed by `TaskEditModal` whenever the title is edited, so the dupe index never drifts from the visible title.                                                                                                                                                                                              |
| `description`           | `string`                      | Defaults to `'No description provided'` if left blank.                                                                                                                                                                                                                                                                                                                                                         |
| `pointValue`            | `string \| number`            | Stored as a **string** from the Chakra `NumberInput` on both the create and the edit path, except for revival missions, which are forced to zero — the number `0` by `TaskCreation`, the string `'0'` by `TaskEditModal`. Read back with `parseInt`.                                                                                                                                                           |
| `taskType`              | `'Task' \| 'Revival Mission'` | Drives what completion does — points, or resurrection.                                                                                                                                                                                                                                                                                                                                                         |
| `taskIndex`             | `number`                      | From `fetchTaskIndexThenIncrement`. The number GMs type in `/mission` commands.                                                                                                                                                                                                                                                                                                                                |
| `dateCreated`           | `string`                      | `"HH:MM"` local time. No date component.                                                                                                                                                                                                                                                                                                                                                                       |
| `isComplete`            | `boolean`                     | Set true by `/mission end`, or automatically once `maxCompletions` is reached by a completion recorded via `/mission done` or photo approval (item 41; docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md) — both call the same shared `completeMission` logic. Also checked by that same completion path (item 39) — a mission that's already `isComplete` rejects further completions. |
| `completedBy`           | `array<string>`               | Player names, appended by `/mission done` or by approving a submitted photo as this mission (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md). Normalized (`normalizePlayerName` — lowercase, all whitespace stripped, see the `recipient` row below), not display-cased.                                                                                                             |
| `maxCompletions`        | `number \| null`              | Optional (improvements item 41). `null`/unset means unlimited — every mission created before this field existed reads this way. When set, `/mission done` auto-sets `isComplete: true` once `completedBy.length` reaches it, and logs an announcement.                                                                                                                                                         |

`taskType` decides the completion effect:

- **`Task`** — awards `parseInt(pointValue)` to the player.
- **`Revival Mission`** — brings the player back to life and triggers a remap.
  `pointValue` is forced to `0` and the input is disabled in the UI.

Creation and listing are reachable from the GM console again as of
`improvements.md` item 15 — missions used to only be completable via the
command bar (`/mission done`/`/mission end`), with no way to create one
through the app at all. Both now open as on-demand popups,
`TaskCreationModal`/`TaskListModal`, via `/mission start`/`/mission view` —
not a permanently-visible panel.

---

## `rooms/{roomID}/photos/{autoId}`

Kill-proof photos, written by a player claiming a kill — the `submitKillPhoto` Cloud Function
(`functions/callableFunctions/submitKillPhoto.js`), called from
`MessageComposer.js` through the thin `httpsCallable` wrapper
`src/components/submitKillPhoto.js` after the photo is uploaded to Storage
via `storageCalls.uploadKillPhoto`
(docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
The client no longer writes here at all: `dbCalls.addPhotoForRoom` and
`firestore.rules`' player-facing `photos` `allow create` clause are both
deleted, and the function runs under the Admin SDK, which bypasses rules
entirely — so the function _is_ the enforcement now.

What it enforces, all server-side: the caller must be a player of this
room (matched by their own `uid`, not by any name they send), the game
must still be active, `status`/`originalPlayerData` are hardcoded rather
than accepted from the client, and the `url` must be a legitimate
download URL for this room's own Storage path. The player now names their
own claim at submission time — `submitKillPhoto` requires exactly one of
`target`/`mission` to be present (shape-only validation); it does not
check whether the claim is actually valid game state (a real target on
the assassin's list, an open mission), which is still checked only later,
at approval time, exactly as before
(`docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md`).
The `url` check moved out of
`firestore.rules` and into `src/game/killPhotoUrl.js`'s
`isValidKillPhotoUrl` (vendored into `functions/vendor/game/` by
`functions/scripts/sync-shared-game-logic.js`), unchanged in substance: the
whole string must begin with an allowed Storage origin
(`https://firebasestorage.googleapis.com` in production, or
`http://localhost:9199` — what `getDownloadURL` actually returns against
the Storage emulator) and then carry
`/v0/b/{bucket}/o/rooms%2F{roomID}%2Fphotos%2F`, this room's own
percent-encoded object path. The bucket segment stays a wildcard because
production and the emulator use different buckets
(docs/improvements.md item 60). Submissions are also rate-limited per
player — see `rateLimits` in the `players` table above. A caller whose
`uid` matches more than one player doc in the room is rejected outright
rather than attributed to whichever doc sorts first (docs/improvements.md
item 66).

The host's own writes to this collection (approve/deny/undo, via
`dbCalls`) are unaffected by any of the above — they still go through the
client SDK under `firestore.rules`' `allow write: if isHostOfExistingRoom`.

| Field                 | Type                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | `string`                                                                         | Download URL from `storageCalls.uploadKillPhoto`. Rendered directly into an `<Image src>`, which is why `submitKillPhoto` requires a player-submitted value to match an allowed Storage origin _and_ this room's own `rooms/{roomID}/photos/` object path (see above) rather than any host the client cares to name.                                                                                                                                                                                                   |
| `assassin`            | `string`                                                                         | The claiming player's name, derived server-side by `submitKillPhoto` from the caller's own `uid` (the `name` on their player doc). Never client-supplied — the callable takes no assassin argument at all.                                                                                                                                                                                                                                                                                                             |
| `target`              | `string \| null`                                                                 | `null` at submission only if the claim was malformed (rejected before writing — see below); otherwise set at submission time, by `submitKillPhoto` from the player's own claim. The moderator's approval in `PhotosDisplay.js` no longer resolves or rewrites it — `dbCalls.approvePhotoForRoom` still writes the same value back explicitly as part of recording the approval, sourced from the photo doc's own already-set field. Stays whatever it was at submission for a denied photo — denying never touches it. |
| `mission`             | `number \| null`                                                                 | `null` at submission unless the player claimed a mission — set at submission time now, by `submitKillPhoto`, not by the moderator's approval (`docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md`). `dbCalls.approvePhotoAsMissionForRoom` still writes the same value back explicitly as part of recording the approval.                                                                                                                                                                      |
| `missionUndoSnapshot` | `object \| null`                                                                 | `null` for a kill-approved or denied photo. Set once, to the `reversalSnapshot` `completeMission` returned, by `dbCalls.approvePhotoAsMissionForRoom`, when a moderator approves the photo as a mission completion — mirrors `originalPlayerData`'s role for kills, consumed by `undoMissionPhotoApproval` to reverse the completion.                                                                                                                                                                                  |
| `timestamp`           | `Timestamp`                                                                      | `serverTimestamp()`. The queue orders ascending by this field, so the GM judges oldest-first.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `status`              | `'pending' \| 'approved' \| 'denied'`                                            | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `originalPlayerData`  | `{ [trimmedNameLowerCase]: { score, targets, assassins, isAlive, openSeason } }` | Written by `killPlayer`'s `preKillSnapshot` return value, persisted via `dbCalls.approvePhotoForRoom` only when `status` becomes `'approved'`. A map keyed by normalized player name, one entry per player `killPlayer`'s transaction touched — not just the target, but also the killer and anyone the post-kill remap reassigned. `undoKillPlayer` (the atomic Cloud Function backing the Undo button) replays every entry verbatim to fully reverse the kill in one transaction.                                    |
| `targetHorcruxActive` | `boolean`                                                                        | Written by `submitKillPhoto`: whether the claimed target's Horcrux was active when the photo came in. `PhotosDisplay.js` shows it as a note — a photo taken during the Horcrux's grace period doesn't count, and the GM decides.                                                                                                                                                                                                                                                                                       |

`PhotosDisplay` reads every photo document in the room on every snapshot and
splits them client-side by `status` (`src/game/photoJudgments.js`,
`splitPhotosByStatus`) — `pending` into the judgment queue, `approved`/`denied`
into undo history. Neither split is part of the query. Because both are
derived fresh from Firestore on every snapshot rather than accumulated
locally, `originalPlayerData` is what makes undo survive a page reload
(docs/improvements.md item 6) — before it existed, the snapshot needed to
revert a kill lived only in React state and was lost on reload even though
the photo document itself was already durably `approved`. Originally this
snapshot covered only the target and was replayed by several separate
client-side writes; the 2026-08-16 full-kill-undo redesign
(`docs/superpowers/specs/2026-08-16-full-kill-undo-design.md`) widened it to
every touched player and moved the replay itself server-side, into
`undoKillPlayer`, so an undo is atomic the same way a kill already was.

---

## `rooms/{roomID}/playerMessages/{autoId}`

Player-facing messages from `/whisper`, `/broadcast`, `/leaderboard`, and
confirmed boundary exposure alerts
(docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).
**Designed to be read by a player-facing mobile app**, not by this
codebase — unlike `photos` above, which now has a real in-app writer
(`MessageComposer.js`), nothing in this codebase reads `playerMessages`
except `MessageFeed.js`/`GMChatPanel.js`, both entirely separate from
whatever a future mobile app might eventually read this collection for.
`MessageFeed.js` now reads
`playerMessages` via `fetchPlayerMessagesQueryForRoom`, filtering to broadcasts/leaderboard sends
and whispers addressed to the subscribing player. `'broadcast'` writes also
now come from game-event handlers in `GameMasterView.js` and
`ChatInput.js` (kills, revives, open season, missions), not just the
explicit `/broadcast` command.

`'chat'` is the exception to "read by a mobile app, not this codebase" above,
on both ends
(docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md):
`MessageComposer.js` sends it from a player's browser session, and
`GMChatPanel.js` reads it back for the GM console, filtering client-side to
`type: 'chat'` the same way `MessageFeed.js` filters to
whisper/broadcast/leaderboard/mission. That same change bounded
`fetchPlayerMessagesQueryForRoom` to the newest 50 messages
(`limitToLast(50)`), so a long-running game's chat traffic doesn't grow the
read on every feed/panel subscription without bound.

`'chat'` messages are written by the `submitChatMessage` Cloud Function
(`functions/callableFunctions/submitChatMessage.js`), which
`MessageComposer.js` calls through the thin `httpsCallable` wrapper
`src/components/submitChatMessage.js`
(docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
The client no longer writes here: `dbCalls.addChatMessageForRoom` and
`firestore.rules`' player-facing `'chat'`-scoped `allow create` grant are
both deleted, and the function runs under the Admin SDK, which bypasses
rules entirely. It enforces that the caller is a player of this room
(matched by their own `uid`) and that `text` is a string of 500
characters or fewer (the same cap
`MessageComposer.js`'s `maxLength={500}` applies in the UI —
docs/improvements.md item 57), and a per-player rate limit (see
`rateLimits` in the `players` table above). It sets `type`, `recipient`,
`standings`, `mission`, and `sender` itself; only `text` comes from the
client. A caller whose `uid` matches more than one player doc in the room
is rejected outright rather than attributed to whichever doc sorts first
(docs/improvements.md item 66).

**GM-originated messages are entirely unaffected by that.**
`'broadcast'`/`'whisper'`/`'leaderboard'`/`'mission'` writes still go
through `dbCalls.addPlayerMessageForRoom` from the GM console, authorized
by `firestore.rules`' host-only `allow write: if isHostOfExistingRoom` —
that path was never moved server-side and never wrote `type: 'chat'`.

`'killPhoto'` and `'killResult'` announce a kill attempt and its outcome
in the same room-wide feed, so every player sees the attempt as it
happens rather than only the assassin. `'killPhoto'` is written by
`submitKillPhoto.js` (Admin SDK, same transaction as the `photos` doc
itself) the moment a player submits — this doubles as the assassin's own
confirmation that the submission went through, so no separate private
notice exists; it renders as a plain chat-style post (sender name, photo,
timestamp — `MessageBubble.js`), naming no target, since one hasn't been
resolved yet. `'killResult'` is written by `PhotosDisplay.js`'s
`handlePass`/`handleDeny`, via the same `dbCalls.addPlayerMessageForRoom`
path GM broadcasts already use, right after a moderator approves or
denies — both outcomes are announced, including a denial (deliberately:
the target can see in chat that someone specifically tried and failed) —
though a denial's announcement never names a target either, for the same
reason `'killPhoto'` doesn't: denying never requires resolving one.
`handleUndo` posts a `'killResult'` message the same way when a moderator
reverses either judgment (`outcome: 'undoneApproval'`/`'undoneDenial'`),
reusing the exact text already written to the GM's own log for that undo.

`'gameEnded'` and `'gameEndedLeaderboard'` are both written once,
together, by `Endgamebutton.js`'s `onYesEnd`, right after the `endGame`
Cloud Function (via `src/components/endGame.js`) succeeds — the game genuinely has ended by the time either is posted, so a
failure posting them surfaces as a GM-facing alert but never blocks
navigation. `'gameEnded'` carries the fixed "Please head back to the
starting area." announcement; `MessageFeed.js` pulls it out of the normal
scrolling list and renders it pinned above the feed, so it stays visible
regardless of how much chat happens afterward — the one message type this
collection has that behaves this way. `'gameEndedLeaderboard'` carries the
full final standings (`buildLeaderboardStandings` over every player,
alive and dead) and renders inline in the normal scrolling feed, via
`GameEndedLeaderboardBubble.js`, showing just the top 3 plus a "View Full
Leaderboard" button that opens the same `LeaderboardModal.js` the deleted
`GameOverScreen.js` used to own. Chat itself stays open after the game
ends (`submitChatMessage.js` is deliberately not gated on `isGameActive`)
— only kill-photo submission stays blocked, both server-side
(`submitKillPhoto.js`'s own `isGameActive` check, unchanged) and in the
UI (`MessageComposer.js`'s camera button, gated on a new `isGameActive`
prop `PlayerGame.js` passes through).

| Field          | Type                                                                                                                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`         | `'whisper' \| 'broadcast' \| 'leaderboard' \| 'mission' \| 'chat' \| 'killPhoto' \| 'killResult' \| 'gameEnded' \| 'gameEndedLeaderboard' \| 'powerUpPing' \| 'powerUpNotice' \| 'horcruxSaved'` | Discriminates which of the other fields is populated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `recipient`    | `string \| null`                                                                                                                                                                                 | The player's real (display) name, e.g. `"Alice Smith"` — populated only for `'whisper'`; `null` means "everyone" (including every `'chat'` message — there is no whispering in group chat). This is display-cased, **not** the `trimmedNameLowerCase` key player documents are keyed by (e.g. `"alicesmith"`). A reader matching `recipient` against a specific player must apply this repo's `normalizePlayerName` (`src/game/playerNames.js`, see docs/improvements.md item 35) to both sides before comparing — it strips _all_ whitespace, not just leading/trailing, so a plain `.toLowerCase()` will fail to match names with internal spaces.                                                                                                                                                                                                                                                        |
| `text`         | `string \| null`                                                                                                                                                                                 | Free-text body. Populated for `'whisper'`/`'broadcast'`/`'chat'`/`'killResult'` (a pre-formatted "X was killed by Y" / "Y's photo submission was denied" / "Undo: ..." line) and `'gameEnded'` (always the fixed "Please head back to the starting area."); `null` for `'leaderboard'`/`'mission'`/`'killPhoto'`/`'gameEndedLeaderboard'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `standings`    | `Array<{name, score, isAlive}> \| null`                                                                                                                                                          | Populated for `'leaderboard'` and `'gameEndedLeaderboard'` — structured, not pre-rendered text, so a real client can render its own UI. `'gameEndedLeaderboard'` always carries the full roster (`buildLeaderboardStandings`); `GameEndedLeaderboardBubble.js` decides to show only the top 3 inline, not this field. `'leaderboard'` (from `/leaderboard send`) is the opposite — the array itself is already truncated to the top 3 (`buildLeaderboardStandings(players).slice(0, 3)`, `ChatInput.js`) before the write, so a routine send doesn't spam the chat feed with the full roster. The full, untruncated roster is available on demand instead, via `/leaderboard view` (moderator) or the "View Leaderboard" button (player) — both open the same `LeaderboardModal.js` reused from the game-end flow, computing fresh standings client-side rather than reading anything from this collection. |
| `mission`      | `{title, description, taskType, pointValue, maxCompletions} \| null`                                                                                                                             | Populated only for `type: 'mission'` — a new mission's full detail card, sent when the GM creates one. Absent (or `null`) for every other `type`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sender`       | `string \| null`                                                                                                                                                                                 | The display name of the player who sent a `'chat'` message. `null`/absent for every other `type`. Derived server-side by `submitChatMessage` from the caller's own `uid` (the `name` on their player doc), never client-supplied — the callable takes no sender argument at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pingedPlayer` | `string`                                                                                                                                                                                         | `'powerUpPing'` only: the display name of the player a global ping named. Written by `purchasePowerUp`, which picks it server-side for the random ping. The buyer is deliberately not recorded on the message (the GM log has it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pings`        | `Array<{name, lat, lng, accuracyMeters, capturedAtMs, isStale}>`                                                                                                                                 | `'powerUpPing'` only: one location snapshot per pinged player, copied from their `boundaryStatuses` doc at purchase time and never updated. `lat`/`lng`/`capturedAtMs` are `null` when they had no position on record; `isStale` is true for that and for a position older than 30s (the GM is alerted for both).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `photoUrl`     | `string \| null`                                                                                                                                                                                 | The submitted kill photo's Storage URL. Populated only for `'killPhoto'`, copied straight from the same `url` the `photos` doc for this submission stores.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `assassin`     | `string \| null`                                                                                                                                                                                 | The submitting/attempting player's display name. Populated for `'killPhoto'` and `'killResult'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `target`       | `string \| null`                                                                                                                                                                                 | Always `null` for `'killPhoto'` — a player no longer names who they killed at submission time. For `'killResult'`, populated when the outcome is `'approved'` or `'undoneApproval'` (the moderator has resolved a target by then); `null` for `'denied'`/`'undoneDenial'`, since denying never requires resolving one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `outcome`      | `'approved' \| 'denied' \| 'undoneApproval' \| 'undoneDenial' \| null`                                                                                                                           | Populated only for `'killResult'` — which of the four a moderator's action produced. Not currently used to drive different bubble styling (`MessageBubble.js` renders all four the same way `'broadcast'` renders), only to make the field self-describing for any future reader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `timestamp`    | `Timestamp`                                                                                                                                                                                      | `serverTimestamp()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## `rooms/{roomID}/reconnectRequests/{autoId}`

Pending requests from a player whose device is signed in under a
different uid than the one that originally joined, asking to reclaim an
existing name once the game has started — written by the
`requestReconnect` Cloud Function
(`functions/callableFunctions/reconnectRequest.js`), judged by the host
via `approveReconnectRequest`/`denyReconnectRequest`
(docs/superpowers/specs/2026-08-30-player-reconnect-design.md). All three
run under the Admin SDK, which bypasses `firestore.rules` entirely —
`firestore.rules`' `reconnectRequests` match block has no player-facing
`allow create` at all, unlike `photos`/`playerMessages`, which at least
had one once (see those sections above).

| Field                  | Type                                  | Notes                                                                                                                                                  |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `playerName`           | `string`                              | The existing player's real stored-casing `name`, copied from their player document at request time.                                                    |
| `trimmedNameLowerCase` | `string`                              | The lookup key — same scheme every player document ID already uses. `approveReconnectRequest` re-reads the player document by this field, not by name. |
| `requestingUid`        | `string`                              | The new device's `context.auth.uid`. Written to the player document's own `uid` field, and added to the room's `joinedUids`, only once approved.       |
| `status`               | `'pending' \| 'approved' \| 'denied'` | Set once, never reverted — a resolved request cannot be re-judged; a fresh reconnect attempt creates a new request document instead.                   |
| `timestamp`            | `Timestamp`                           | `serverTimestamp()`, set once at creation.                                                                                                             |

`firestore.rules`' `reconnectRequests` `allow read` grant lets the
requester read their own request (`resource.data.requestingUid ==
request.auth.uid`) and lets the host read/list every request for their
room — nobody else can read this collection at all, and no client write
is ever permitted (`allow write: if false`).

Approving a reconnect adds the new uid to `joinedUids` but never removes
the superseded old one — the old device keeps read access to the room (it
can no longer write anything, since every write path resolves the player
by a `where('uid', '==', ...)` query that will no longer match it, the old
uid having been overwritten on the player doc). This matches the same
accepted behavior `removePlayer.js`'s `removeAndRemap` already has (it
deletes the player doc without touching `joinedUids` either). Blind
pruning isn't safe here — the old uid could legitimately still be a
different, unrelated player in some future scenario — so this is a
deliberate trade-off, not an oversight.

---

## `rooms/{roomID}/boundaryStatuses/{playerId}`

Each player's current status against the room's game boundary
(docs/superpowers/specs/2026-09-30-game-boundaries-design.md). The document ID
is the same normalized `trimmedNameLowerCase` key as the player's document in
`players/`. Written only by the `reportPlayerLocation` Cloud Function
(`functions/callableFunctions/reportPlayerLocation.js`) under the Admin SDK,
and deleted by the shared removal step behind `leaveGame` and `removePlayer`,
and by `approveReconnectRequest` (`functions/callableFunctions/reconnectRequest.js`)
when a player's identity transfers to a new uid — a stale status evaluated
under the old device must not carry over to the new one. No client write is
ever permitted.

**Coordinates are stored on this document and read access is role- and
status-gated:** the host can always read every player's position; a player
can always read their own; any other player can read a given player's
position only while that player's status reads `'outside'`.
`boundaryEvents` (below) still stores no coordinates — this gate is specific
to `boundaryStatuses`.

Reads: the host can read and list every status in their room. A player can
read their own status document at any time, and only while the `uid` on
their current player document matches their auth `uid`, so a reconnect
under a new uid revokes the old device's access immediately. A player may
also read another player's status document once its `status` field reads
`'outside'` (`fetchOutsideBoundaryStatusesQueryForRoom`, the one query shape
Firestore can prove safe under this rule, since the rule's own condition
matches that exact filter) — there is still no grant broad enough to list
every status in the room unfiltered.

| Field                  | Type                                               | Notes                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `boundaryRevision`     | `number`                                           | The `gameBoundary.revision` the report was evaluated against. A report whose revision does not match the room's current one is rejected with `revision_conflict`.                                                                                                                                                                    |
| `uid`                  | `string`                                           | The reporting device's `auth.uid`.                                                                                                                                                                                                                                                                                                   |
| `status`               | `'inside' \| 'outside' \| 'near' \| 'unavailable'` | The evaluated status. `near` means within the edge tolerance and not yet confirmed outside.                                                                                                                                                                                                                                          |
| `reason`               | `string \| null`                                   | Why the status is `unavailable` (e.g. `no_fix`, `poor_accuracy`, `clock_skew`), or the error code a device reported. `null` otherwise. `stale` is never stored — it's derived at read time by `deriveFreshStatus` from how old `lastUsableReceivedAt` is.                                                                            |
| `lat`                  | `number \| null`                                   | The reporting device's last-written latitude. Written on every fix report. On an error report (no fresh coordinates available), the previous value is carried forward rather than cleared, so a dot does not simply vanish — staleness is signaled by `lastUsableReceivedAt`, already on this document, not by nulling the position. |
| `lng`                  | `number \| null`                                   | Same as `lat`.                                                                                                                                                                                                                                                                                                                       |
| `accuracyMeters`       | `number \| null`                                   | Reported horizontal accuracy of the fix.                                                                                                                                                                                                                                                                                             |
| `lastSampleAt`         | `Timestamp`                                        | The device's own sample time. Used to reject stale or reordered reports; the device clock is not trusted for confirmation.                                                                                                                                                                                                           |
| `receivedAt`           | `Timestamp`                                        | `serverTimestamp()` of the most recent accepted report.                                                                                                                                                                                                                                                                              |
| `lastUsableReceivedAt` | `Timestamp \| null`                                | Server time the last usable (accurate, valid) fix was received.                                                                                                                                                                                                                                                                      |
| `outsideSince`         | `Timestamp \| null`                                | Server receipt time of the first outside fix in the current outside run.                                                                                                                                                                                                                                                             |
| `lastOutsideSampleAt`  | `Timestamp \| null`                                | Server receipt time of the most recent outside fix.                                                                                                                                                                                                                                                                                  |
| `outsideSampleCount`   | `number`                                           | Count of outside fixes in the current run. Written by the function but not listed in the spec's field list.                                                                                                                                                                                                                          |
| `outsideConfirmedAt`   | `Timestamp \| null`                                | Server time the outside status was confirmed. Set once per outside episode; an error report or a later outside fix does not reset it. `null` until confirmed.                                                                                                                                                                        |
| `statusChangedAt`      | `Timestamp`                                        | Server time `status` last changed.                                                                                                                                                                                                                                                                                                   |

---

## `rooms/{roomID}/powerUpRateLimits/{uid}`

Per-caller rate limit for the power-ups shop: `purchasePowerUp` and
`claimMysteryReward` share a 20-calls-per-60-seconds burst allowance
(`src/game/rateLimit.js`'s `nextRateLimitWindow`). Keyed by the caller's
`auth.uid`, not their player name. Written only by those functions, in a
transaction of its own that runs before the purchase — a rejected purchase
rolls back its own transaction, and the count must survive that. Kept off
the player doc (unlike `rateLimits`) so counting a call doesn't push an
update to every client listening to the roster. `firestore.rules` has no
match for this path, so clients can neither read nor write it. Deleted
with the room by `cleanupEndedRooms`.

| Field         | Type        | Notes                                          |
| ------------- | ----------- | ---------------------------------------------- |
| `windowStart` | `Timestamp` | Start of the current 60-second window.         |
| `count`       | `number`    | Calls counted in that window, rejected or not. |

---

## `rooms/{roomID}/boundaryEvents/{autoId}`

A moderator-only log of confirmed boundary crossings. Written only by
`reportPlayerLocation`, in the same transaction as the status change it
records, so an event exists if and only if its transition was committed.
Written on the confirmation edge: one `outside` event per outside episode, and
one `returnedInside` event when a confirmed-outside player comes back inside.
An `outside` event is committed alongside a room-wide `powerUpPing` message
with the current location snapshot, so players are notified and can open the
ping on their map. The moderator-only event itself remains coordinate-free;
the snapshot is in `playerMessages`, under its existing role-based read grant.

Reads: the host only. Clients can never write here.

| Field              | Type                            | Notes                                                                                                                             |
| ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `type`             | `'outside' \| 'returnedInside'` | Which crossing this records.                                                                                                      |
| `playerId`         | `string`                        | The player document's ID (the normalized `trimmedNameLowerCase` key), same as the `boundaryStatuses` document ID for this player. |
| `playerName`       | `string`                        | The player's display name, copied from their player document.                                                                     |
| `boundaryRevision` | `number`                        | The `gameBoundary.revision` in effect when the crossing was confirmed.                                                            |
| `timestamp`        | `Timestamp`                     | `serverTimestamp()`.                                                                                                              |

Events are removed with their room by `cleanupEndedRooms`. There is no
separate retention for location data.

---

## Room cleanup

`functions/scheduledFunctions/cleanupEndedRooms.js` runs once every 24
hours and deletes any room whose `endedAt` is older than a retention
window. The window is a module-level `let RETENTION_DAYS`, currently `1`
day — enough time to review standings, kill photos, and flag any
last-minute mistake before a room's data disappears
(docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
For each expired room, it first deletes that room's Firebase Storage
photos (`rooms/{roomId}/photos/**`, see the Firebase Storage section
below) and only then deletes everything under the room in Firestore —
players, logs, tasks, photos, playerMessages — via the Admin SDK's
`recursiveDelete()`. The Storage delete is wrapped in its own
`try`/`catch`: if it fails, that room is skipped for this run (its
Firestore data stays in place, so the next scheduled run retries both
operations) without blocking cleanup of any other expired room in the
same invocation (docs/improvements.md item 61).
A room that's abandoned mid-lobby and never explicitly ended (`endedAt`
never set) is not covered by this and is never automatically deleted.

---

## Firebase Storage

`storage.rules` is path-scoped to `rooms/{roomId}/photos/**` (kill-photo
submission) — a signed-in user may read/write within that path, and
`allow write` also requires `resource == null`, i.e. only a fresh object
path, not overwriting/deleting one that already exists. Nothing outside
that path is reachable. Not scoped per-room/per-host beyond the path
match, since there's no per-player auth identity yet to scope a write to;
see the rules file's own header comment.

`storageCalls.js` (`uploadKillPhoto`) is the module that uses it — it
uploads a kill-photo `Blob` to `rooms/{roomID}/photos/{crypto.randomUUID()}.jpg`
and returns its download URL, which `addPhotoForRoom` then writes onto the
`photos` document (see above). This is a re-add of the file: an earlier,
unrelated `storageCalls.js` (a broken `fetchPhotoURLFromStorageForRoom`
with no callers) was deleted as dead code (`improvements.md` item 14);
this is a new module, added for kill-photo submission.

On the deletion side, `cleanupEndedRooms.js` now deletes a room's
`rooms/{roomId}/photos/**` objects via `bucket.deleteFiles({ prefix })` as
part of its scheduled cleanup pass — see the Room cleanup section above.

---

## Room ID generation

Jackbox-style: 4 random uppercase letters (e.g. `WXKR`), via
`src/game/roomId.js`'s `generateRoomCode` — a pure function, `Math.random`
injectable as `rng` for deterministic tests, matching
`remapPlan.js`/`targetGraph.js`'s own convention. Replaced the old
`unique-names-generator` word+number scheme (`Fluffy42317`), whose
mixed-case shape silently failed to match if a player typed it back in any
other case; the new scheme sidesteps that entirely by staying uppercase
everywhere it's generated, stored, displayed, and typed (`JoinGame.js`
uppercases the input live, as the player types).

`DashBoard.js`'s room-creation effect retries on two conditions before
writing: `isBlockedRoomCode` (a short, hand-curated list of offensive
4-letter words, checked case-insensitively, also in `roomId.js`) and
`checkForRoomIDDupes` (existence check against Firestore) — up to 300
attempts before giving up with a toast. The check-then-write is not atomic,
so two simultaneous hosts can in principle claim the same ID.

No letters are excluded from the alphabet — the code is letters only, never
mixed with digits, so `O`/`0` confusion never arises, and capital `I` reads
unambiguously on its own since the code is always shown in all caps —
there's no lowercase `l` for it to be confused with.

---

## Unused data-layer surface ✅ Resolved (improvements item 14)

`createRoomWithDefaults`, `addPhotoForRoom`, `updateCompletedByForTask`,
`fetchTaskForRoom`, `fetchReferenceForTask`, `updateIsCompleteToTrueForTask`,
and `fetchAlivePlayersQueryByDescendPointsForRoom` — the seven `dbCalls.js`
exports with no live callers this section used to list — have been deleted.
See [improvements.md item 14](./improvements.md) for what each was
superseded by, including the `createRoomWithDefaults` vs. `DashBoard`'s
inline `setDoc` disagreement over `taskIndex`'s starting value.
