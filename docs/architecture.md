# Architecture

## What this system is

Mall Mystery Heroes is a **Game Master (GM) console** for running a live-action
"assassin" game. Players are assigned targets, hunt each other in the real world,
submit photo proof of kills, and earn points. The GM sits at a laptop and drives
the whole game from a single screen.

The web app in this repository is _only_ the GM console. It is a Create React App
single-page application that talks **directly to Firebase**. There is effectively
no backend of our own — see [Cloud Functions](#cloud-functions) below.

## System context

```
┌─────────────────────┐         ┌──────────────────────────────┐
│  GM console         │────────▶│  Firebase                    │
│  (this repo)        │         │                              │
│  React SPA          │◀────────│  · Auth (email/password)     │
└─────────────────────┘         │  · Firestore  (game state)   │
                                │  · Storage    (kill photos)  │
┌─────────────────────┐         │  · Functions  (stub only)    │
│  Player mobile app  │────────▶│                              │
│  (aspirational —    │         └──────────────────────────────┘
│   does not exist)   │
└─────────────────────┘
```

Two collaborators are referenced by this codebase's shape but neither is
versioned here, so neither is documented beyond what follows — treat both as
unknowns when changing the `photos` schema or the room document shape:

- **A player-facing mobile app — does not currently exist, anywhere**
  ([improvements.md](./improvements.md) item 33). It is never referenced in
  code, but its existence is implied by two collections prepped for it, in
  opposite directions: `photos` is designed to be _read_ by such an app but
  is never _written_ by anything in this repository — nothing in
  `dbCalls.js` writes a photo document (the test helper that once did was
  dead code, deleted per item 14). `playerMessages`
  (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)
  is the mirror case: written by `/whisper`, `/broadcast`, and
  `/leaderboard`, and now read by `MessageFeed` (`src/components/player_messages_components/MessageFeed.js`)
  via `fetchPlayerMessagesQueryForRoom`, filtered client-side to broadcasts/leaderboard sends and
  whispers addressed to the subscribing player.
  `firestore.rules` scopes both collections to the host rather than to a
  distinct mobile-app identity, for the same reason (item 2). Until this
  app exists, kill-proof photos have no way to enter Firestore except
  manual/emulator seeding.
- **Something Discord-related — no longer present.** `.env` used to carry a
  `DISCORD_TOKEN` that no code in this repository ever read. It was
  previously guessed to be the real integration point for `/broadcast`,
  `/leaderboard`, and `/whisper`, on no more evidence than the stray env
  var — that guess is now moot on two counts: those three commands are
  implemented and target the `playerMessages` collection / a future mobile
  app instead
  (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md),
  and the token itself is gone from `.env` as of this writing. Whatever it
  was for, if anything, is no longer this codebase's concern.

## Layers

```
src/index.js
  └─ App.js ......................... ChakraProvider(theme) + BrowserRouter, 10 routes
       ├─ pages/ ................... one component per route
       ├─ components/ .............. feature-grouped UI, some non-UI "hook-alikes"
       │    └─ firebase_calls/
       │         └─ dbCalls.js ..... THE data-access layer (~38 exported functions)
       ├─ utils/firebase.js ........ SDK init, emulator wiring
       ├─ theme.js ................. Chakra theme extension
       └─ Contexts.js .............. three bare createContext() objects
```

### Routes

Defined in `src/App.js`. Three are wrapped in `RequireAuth` — see
[Authentication](#authentication-and-authorization).

| Path                            | Page             | Purpose                                                                                                                                                                                                                 | Guarded |
| ------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `/`                             | `Homepage`       | "Host Game" / "Join Game" landing                                                                                                                                                                                       |         |
| `/login`                        | `Login`          | Email + password sign-in ("Host Game" lands here)                                                                                                                                                                       |         |
| `/login/password-reset`         | `PasswordReset`  | Sends Firebase reset email                                                                                                                                                                                              |         |
| `/signup`                       | `SignUp`         | Account creation                                                                                                                                                                                                        |         |
| `/join`                         | `JoinGame`       | Player self-registration: game ID + name                                                                                                                                                                                |         |
| `/dashboard`                    | `DashBoard`      | No UI — resolves the GM's existing room or hosts a new one, then redirects                                                                                                                                              | ✅      |
| `/rooms/:roomID/lobby`          | `Lobby`          | Roster management, target generation                                                                                                                                                                                    | ✅      |
| `/rooms/:roomID/GameMasterView` | `GameMasterView` | The live game console                                                                                                                                                                                                   | ✅      |
| `/rooms/:roomID/waiting`        | `PlayerGame`     | Continuous post-join screen: status line (waiting/target/eliminated) plus a live chat feed, until the GM ends the game — then a game-over screen (top-3 standings, full leaderboard via a modal) replaces both entirely | ✅      |

`NotFound` is the catch-all `*` route (`improvements.md` item 30).

### The `dbCalls.js` seam

`src/components/firebase_calls/dbCalls.js` is the single most important file in
the codebase. Every Firestore read and write goes through it (with two
exceptions noted below), which means it doubles as the **de facto schema
definition** — there is no other place where the shape of a player, task, or
room document is written down. See [data-model.md](./data-model.md).

Its naming convention is consistent and worth preserving:

- `fetch…ForRoom` / `fetch…ForPlayer` — reads that `await` and return data
- `fetch…QueryFor…` — returns an unexecuted Firestore `Query`, for the caller to
  hand to `onSnapshot`
- `update…For…` — writes

One file bypasses the seam and uses the Firestore SDK directly: `DashBoard.js`
(room creation). `src/utils/UnmapPlayers.js` used to be a second exception;
it was deleted when its unmapping logic moved server-side into `killPlayer`'s
transaction (item 4), which touches the Admin SDK directly — a different,
intentional exception, since it's server-side code in a separate package,
not a component reaching around `dbCalls.js`.

Most functions in `dbCalls.js` still wrap their body in `try/catch` and report
failures via `console.error`, then return `undefined`, and callers do not
check for this — a failed read commonly surfaces later as a `TypeError` on
`.docs[0]` or `.data()`. A representative subset (12 functions, and every one
of their call sites) now throws instead and is handled with `CreateAlert` at
the call site. This is a systemic pattern still mostly present, not an
oversight fully fixed in one place — see
[improvements.md item 10](./improvements.md).

### Components that are not components

Some files under `src/components/` export a factory that returns a function
rather than JSX. They are used like hooks but are not named like them:

| File              | Returns                                                         |
| ----------------- | --------------------------------------------------------------- |
| `CreateAlert.js`  | `showToast(status, title, description, duration)`               |
| `RemapPlayers.js` | `handleRegeneration(needTargets, needAssassins, alive, roomID)` |

They are invoked as `const createAlert = CreateAlert();` at the top of a
component body. `CreateAlert` genuinely depends on a hook (`useToast()`);
`RemapPlayers` does not, and could be a plain module function.

`UnmapPlayers` used to be in this table too — a data-layer function
(`dbCalls.killPlayerForRoom`) called `UnmapPlayers()` at module-function
scope, a data-layer function reaching back into the component layer for a
factory pattern it never needed (it used no hooks; the doc's older claim
that it "genuinely depended on hooks or module state" was simply wrong).
Resolved by moving it to `src/utils/UnmapPlayers.js` as a plain exported
`handleUnmapping` function
([improvements.md item 16](./improvements.md)). That file was later deleted
outright when item 4 moved unmapping server-side into `killPlayer`'s
transaction, which re-implements it from scratch rather than calling the
old function.

### The game-boundary editor

`src/components/map_components/` holds the moderator-facing UI for Phase
2's game-area boundary (`docs/superpowers/plans/2026-10-09-game-boundaries-phase-2.md`):
`GameMap.js` is the shared Mapbox renderer (wraps `react-map-gl`, draws
the boundary overlay, handles its own load/error states); `BoundaryEditorModal.js`
is the drawing surface built on top of it (four tools sharing one drag
gesture, undo history, Publish/Disable calling the `publishGameBoundary`/
`disableGameBoundary` wrappers above); `GameBoundaryButton.js` is the
entry point, self-contained in the same shape as `AbandonRoomButton.js`
— it owns its own open/closed state and takes just `roomID` and the
room's current `gameBoundary`. `Lobby.js` and `GameMasterView.js` each
render the button off their own live `onSnapshot` subscription to the
room doc's `gameBoundary` field, the same subscription shape
`GameMasterView` already used for `isGameActive`.

Phase 3 adds the player-facing half. `src/hooks/useBoundaryLocation.js`
owns the one browser geolocation watch a mounted player session gets:
permission on demand, fixes reported through `reportPlayerLocation` at
`locationReportCadence.js`'s cadence, a backstop timer and a
visibility-change handler that both reacquire a fresh fix (gated on
`permissionState` so a denial never re-prompts on its own), and its own
`ownPosition`/`permissionState` surfaced for the UI to render — it does
not derive the player's displayed status itself.
`src/components/map_components/PlayerMapModal.js` is the read-only
counterpart to `BoundaryEditorModal.js`: a Mapbox view of the published
boundary plus the player's own position, built on the same `GameMap.js`.
`PlayerGame.js` mounts `useBoundaryLocation` at its own level, not inside
the modal, so closing the map never stops tracking — the modal is purely
presentational.

Live location visibility (`docs/superpowers/specs/2026-10-12-live-location-visibility-design.md`)
generalizes `GameMap.js`'s single `ownPosition` marker into a list,
`otherPositions`, each with an optional hover label — the own-position
marker shares its position-dot visual (`PositionDot`) with the new
other-players markers, though the own-position marker remains its own
rendering block. `src/components/map_components/LivePlayerMapButton.js` is the new
GM-facing entry point (rendered alongside `GameBoundaryButton.js`): it
owns its own open/closed state and, while open, subscribes to the whole
`boundaryStatuses` subcollection unfiltered — the host's existing read
grant covers this — rendering every fresh player's position as a labeled
marker on the same `GameMap.js`. `PlayerMapModal.js` gained the same
`otherPositions` prop, passed straight through from `PlayerGame.js`'s own
`fetchOutsideBoundaryStatusesQueryForRoom` subscription (the one query
shape the widened `boundaryStatuses` read rule can prove safe for a
non-host player), so a player sees any other currently-exposed player on
their own map too.

## State management ✅ Resolved (improvements item 13)

There is no state library. Until item 13, state lived in three separate
places that did not agree with each other: `PlayersList`/`PhotosDisplay`
subscribed live via `onSnapshot`, `GameMasterView` fetched its own player/log
arrays once on mount and mutated them by hand, and the header's roster count
came from React Router location state (`useLocation().state.arrayOfPlayers`,
lost on reload — `Players (0)`).

`GameMasterView` now owns a single live `onSnapshot` subscription to the
same player query `PlayersList` used to subscribe to independently
(`fetchPlayersQueryByDescendPointsThenIsAliveForRoom`) and a second one for
the `logs` subcollection (`fetchLogsQueryByAscendingTimestampForRoom` — see
[data-model.md](./data-model.md), item 22). The header count
(`players.length`) and `ResetTargetsButton`'s alive-only roster
(`players.filter(p => p.isAlive).map(p => p.name)`) are both derived inline
from that one subscription — no separate state, no manual mutation.
`PlayersList` is presentational now, taking `players` as a prop instead of
subscribing itself (two live listeners on the same query would have doubled
the reads for no benefit). `completedTasks` remains write-only local state —
`TaskList` (item 15) owns its own independent live subscription to the
tasks collection rather than reading this. `arrayOfTasks`, the other
write-only piece this note used to describe, was deleted outright once item
15 restored the mission panel and made its uselessness obvious (its own
`fetchAllTasksForRoom` fetch, read by nothing).

### Contexts

`src/components/Contexts.js` declares three contexts with no default value and no
provider components. `gameContext` and `executionContext` providers are inlined
in `GameMasterView`'s JSX; `taskContext`'s provider lives inside
`TaskCreationModal.js` instead, wrapping `TaskCreation` only while the modal is
open.

| Context            | Provided value           | Consumers                                                                                                                         |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `gameContext`      | `{ roomID }`             | `PlayersList`, `ChatInput`, `PhotosDisplay`, `HeaderExecution`, `Endgamebutton`, `ResetTargetsButton`, `TaskList`, `TaskCreation` |
| `executionContext` | 12 handler functions     | `ChatInput`, `PhotosDisplay`                                                                                                      |
| `taskContext`      | `{ handleNewTaskAdded }` | `TaskCreation`, reachable via `/mission start` opening `TaskCreationModal`                                                        |

`executionContext` is provided **twice** in `GameMasterView`'s tree with the same
object — once wrapping `ChatInput`, once wrapping the right-hand stack — because
the two consumers sit in different branches of the layout.

## Authentication and authorization

Three ways to sign in now: email/password (`src/components/auth.js`, shared
by `Login` and `SignUp` via an `isLoginPage` prop; password reset goes
through `sendPasswordResetEmail`), Google (`signInWithPopup` +
`googleProvider`, additive on the same `auth.js` form for the GM), and
anonymous/guest (`signInAnonymously`, used only by `JoinGame` — a player
never sees a login screen at all).

**Authorization is enforced at both the database and the route.**
`firestore.rules` (registered in `firebase.json`) scopes every read under
`rooms/{roomId}` — including all five subcollections — to whichever caller
is either the room's host (`resource.data.hostId == request.auth.uid`) or a
player who has joined it (`request.auth.uid` present in the room's
`joinedUids`, appended to by `joinRoom`) — not simply "any signed-in user"
(docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
Writes stay host-only, unchanged. `rooms/{roomID}.hostId`, written once at
room creation, and `joinedUids`, appended to on every self-registration, are
both read by the rules engine via `get()`. A separate `allow list` grant
lets a host query `rooms` filtered to their own `hostId` — this is what
`DashBoard.js` uses to find a room they're already running instead of
creating a new one on every login
(docs/superpowers/specs/2026-08-08-dashboard-removal-design.md); it's a
distinct grant because Firestore only allows a `list`/query operation when
the rule is provably true for every possible result of that exact query
shape, which a `get()`-based check like `isHostOfExistingRoom` can't
satisfy. On top of that,
`src/components/RequireAuth.js` wraps `/dashboard` and every `/rooms/:roomID/*`
route (including the new `/waiting`), redirecting a signed-out visitor to
`/` before the page renders at all — defense-in-depth, not a substitute for
the rules. `RequireAuth` accepts any signed-in user, anonymous included.

Gaps that remain, per [improvements.md](./improvements.md):

- `storage.rules` is path-scoped to `rooms/{roomId}/photos/**` and
  create-only (`resource == null`) since kill-photo submission, but not
  scoped per-room or per-player the way `firestore.rules` now is — any
  signed-in user can read/write within that path.
- All game logic remains client-side, so a signed-in host can still write any
  field on their own room's documents, including `score` directly — the rules
  stop other people from editing a room, not a host from writing anything to
  their own (item 4, item 10 in [testing.md](./testing.md#layer-2--security-rules-)).
- `photos` and `playerMessages` (Firestore) are host-only for writes in
  `firestore.rules`. Their former player-facing `allow create` grants —
  which let any player of a room claim any name as a photo's `assassin`
  or a chat message's `sender`, since rules had no per-uploader identity
  to check against — were deleted with the identity-verified
  player-writes feature. Player submissions now go through
  `submitKillPhoto`/`submitChatMessage` (see Cloud Functions below), which
  derive the writer's identity from their own `uid` under the Admin SDK.

## Cloud Functions

`functions/` contains sixteen callables and one scheduled function:

- `killPlayer` (`functions/callableFunctions/killPlayer.js`) — the atomic
  replacement for the client-side kill flow (`improvements.md` item 4).
  Validates the kill, transfers points, marks the victim dead, unmaps them
  from every neighbor, and reassigns targets/assassins to whoever that
  leaves short, all inside one Firestore transaction via the Admin SDK.
  `src/components/executeKill.js` is now a thin `httpsCallable` wrapper
  around it. This is the one place in the app where game logic runs
  server-side rather than in the browser.
- `undoKillPlayer` (`functions/callableFunctions/undoKillPlayer.js`) — the
  atomic reversal of an approved kill (the 2026-08-16 full-kill-undo
  redesign, `docs/superpowers/specs/2026-08-16-full-kill-undo-design.md`).
  `killPlayer` snapshots every player its transaction touches (target,
  killer, and anyone the remap reassigned) into `preKillSnapshot`, a map
  keyed by normalized player name; `approvePhotoForRoom` persists that
  snapshot onto the photo document as `originalPlayerData`.
  `undoKillPlayer` reads it back and replays every entry verbatim —
  score, targets, assassins, isAlive, openSeason — restoring every touched
  player and resetting the photo to `'pending'`, all inside one Firestore
  transaction via the Admin SDK. Replaced a client-side Undo that only ever
  reverted the target's own side of the kill. `src/components/undoKill.js`
  is its thin `httpsCallable` wrapper, same shape as `executeKill.js`.
- `completeMission` (`functions/callableFunctions/completeMission.js`) —
  the atomic replacement for the client-side mission-completion
  orchestration (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
  Records a Task completion (award points) or a Revival Mission completion
  (revive the player and regenerate targets/assassins for whoever that
  leaves short, via the same vendored `planRemap` `killPlayer` uses),
  auto-ends the mission once `maxCompletions` is reached, and returns a
  `reversalSnapshot` of every player it touched for later undo, all inside
  one Firestore transaction. `src/components/completeMission.js` is its
  thin `httpsCallable` wrapper, called by both `ChatInput.js`'s
  `/mission done` and `PhotosDisplay.js`'s photo-approval flow.
- `leaveGame` (`functions/callableFunctions/removePlayer.js`) — lets a
  player permanently remove themselves from a room
  (docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
  Unmaps them from the target graph and reassigns whoever that leaves
  short, the same remap step `killPlayer` uses, then deletes their
  document. Resolves which player to remove from the caller's own uid, so
  a player can only remove themselves. Also writes its own GM-log and
  player-broadcast announcement inside the same transaction —
  `firestore.rules` restricts both collections to the room's host, so a
  player's own browser cannot write either directly.
  `src/components/leaveGame.js` is its thin `httpsCallable` wrapper.
- `removePlayer` (`functions/callableFunctions/removePlayer.js`) — the
  moderator-initiated counterpart, powering the console's `/kick <player>`
  command. Shares the same unmap/remap/delete step `leaveGame` uses (both
  live in the same file), host-only, and writes no announcement of its
  own — `ChatInput.js` logs and broadcasts after the call succeeds,
  exactly like `/kill` already does. `src/components/removePlayer.js` is
  its thin `httpsCallable` wrapper. `removeAndRemap`, the shared internal
  step both callables call, also auto-denies any `pending` reconnect
  request for the player being removed (in the same transaction) and
  prunes their `uid` from the room's `joinedUids`, so a removed player's
  old device loses room access and cannot be approved back in against a
  now-deleted player doc.
- `requestReconnect` (`functions/callableFunctions/reconnectRequest.js`) —
  lets a signed-in caller ask to reclaim an existing player's identity in a
  room whose game has already started, when their own device's `uid` isn't
  the one already linked to that player doc. Creates a `pending` document
  in the player's room under `reconnectRequests`, keyed by nothing more
  than the requester's own `uid` and the target player's normalized name —
  no host check, since this is exactly the case where the caller cannot
  yet prove anything about themselves. `JoinGame.js` falls back to this
  when `joinRoom` rejects a join attempt as "already started."
  `src/components/requestReconnect.js` is its thin `httpsCallable`
  wrapper.
- `approveReconnectRequest` / `denyReconnectRequest`
  (`functions/callableFunctions/reconnectRequest.js`) — host-only judgment
  on a pending reconnect request, powering `ReconnectRequests.js` in the
  GM console. Denying just marks the request `denied`. Approving re-links
  the target player document's `uid` to the requester's and adds that uid
  to the room's `joinedUids`, atomically with marking the request
  `approved`, all inside one Firestore transaction — so the uid change and
  the room-access grant land together or not at all.
  `src/components/approveReconnectRequest.js` and
  `src/components/denyReconnectRequest.js` are their thin `httpsCallable`
  wrappers.
- `undoMissionPhotoApproval` / `undoMissionCommand`
  (`functions/callableFunctions/undoMissionCompletion.js`) — the atomic
  reversal of a mission completion, mirroring `undoKillPlayer`'s replay
  pattern exactly, plus removing the player from the mission's
  `completedBy` (and un-setting `isComplete` if the completion had
  auto-ended it). Two thin `onCall` wrappers around one shared internal
  reversal function, since the two undo stacks look up their
  `reversalSnapshot` differently: `undoMissionPhotoApproval` reads it from
  the photo document's `missionUndoSnapshot`; `undoMissionCommand` reads it
  from the room document's `lastMissionCommandCompletion`. Two independent
  "last completion" stacks, not one shared history — approving a photo as
  a mission and typing `/mission done` each track their own most-recent
  completion. `src/components/undoMissionPhotoApproval.js` and
  `src/components/undoMissionCommand.js` are their thin `httpsCallable`
  wrappers.
- `joinRoom` (`functions/callableFunctions/joinRoom.js`) — lets a player
  self-register into a room from their own device, atomically checking for
  a duplicate name and that the room is still in its Lobby phase, all
  inside one Firestore transaction via the Admin SDK
  (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
  Also records the joining `uid` on the new player doc and appends it to
  the room's `joinedUids`, which is what `firestore.rules`' room-scoping
  checks against
  (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
  `src/components/joinRoom.js` is its thin `httpsCallable` wrapper, same
  shape as `executeKill.js`. Unlike `killPlayer`, there is no host-only
  check — any signed-in caller (Google or anonymous/guest) may call it.
- `submitKillPhoto` (`functions/callableFunctions/submitKillPhoto.js`) —
  writes a kill-photo claim on the caller's own behalf, deriving the
  `assassin` field from `context.auth.uid` rather than trusting a
  client-supplied name (the 2026-08-22 identity-verified-player-writes
  feature,
  `docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md`).
  Replaces `dbCalls.addPhotoForRoom` and the player-facing `photos`
  `allow create` grant in `firestore.rules`, both deleted — since the
  Admin SDK bypasses rules, this function is now the sole enforcement of
  everything that clause used to check, including the url-origin
  validation, which moved to `src/game/killPhotoUrl.js`'s
  `isValidKillPhotoUrl` (`improvements.md` item 60). It also hardcodes
  `status`/`originalPlayerData`, requires the room to still be active, and
  applies a rolling per-player rate limit (10 per 60s) recorded in the
  player doc's `rateLimits` field. `src/components/submitKillPhoto.js` is
  its thin `httpsCallable` wrapper, called from `MessageComposer.js` after
  the Storage upload.
- `submitChatMessage` (`functions/callableFunctions/submitChatMessage.js`)
  — the same treatment for player group chat: derives `sender` from
  `context.auth.uid`, replacing `dbCalls.addChatMessageForRoom` and the
  player-facing `playerMessages` `allow create` grant, both deleted. Also
  validates `text` is a string of at most 500 characters
  (`improvements.md` item 57), requires the room to still be active, and
  rate-limits to 20 messages per 60s. `src/components/submitChatMessage.js`
  is its thin `httpsCallable` wrapper, called from `MessageComposer.js`.
  GM-originated `playerMessages` writes (broadcast, whisper, leaderboard,
  mission) are untouched — they still go through
  `dbCalls.addPlayerMessageForRoom` under the host-only rule.
- `publishGameBoundary` / `disableGameBoundary`
  (`functions/callableFunctions/gameBoundary.js`) — host-only writes of the
  room's game-area boundary (the `gameBoundary` field on the room document;
  docs/superpowers/specs/2026-09-30-game-boundaries-design.md). Publish
  validates the submitted shape server-side (finite coordinates, valid
  ranges, nonzero area, no self-intersections, at most 500 vertices including
  closure, no antimeridian crossing, spanning no more than 10 km) and writes
  it with an incremented `revision`. Disable sets `enabled` to `false` and
  increments `revision`. Both take an `expectedRevision` and fail with
  `revision_conflict` if the room has moved on, so a stale editor cannot
  overwrite a newer boundary. The client has no direct write path to
  `gameBoundary`: `firestore.rules` denies it. `src/components/publishGameBoundary.js`
  and `src/components/disableGameBoundary.js` are thin `httpsCallable` wrappers,
  same shape as `executeKill.js`; see "The game-boundary editor" below for the
  UI that calls them.
- `reportPlayerLocation` (`functions/callableFunctions/reportPlayerLocation.js`)
  — lets a signed-in player of an active game report one location fix, or an
  error in place of a fix. The function looks up the caller's player document
  by `uid`, rejects a report whose `boundaryRevision` is not the room's
  current one, rejects stale or reordered sample times, and rate-limits
  reports through `rateLimits.boundaryReport` on the player document. It
  evaluates the fix against the boundary on the server, so the device's
  coordinates never reach a stored document: only the resulting status is
  written, to `boundaryStatuses/{playerId}`, along with a `boundaryEvents`
  entry on a confirmed outside or return-inside transition. No client wrapper
  exists yet, so the feature is unreachable from the UI in this phase.
- `cleanupEndedRooms` (`functions/scheduledFunctions/cleanupEndedRooms.js`)
  — runs once every 24 hours, deleting any room (and everything under it)
  whose `endedAt` is older than a retention window. The window is a
  module-level constant, currently `1` (24 hours) — enough time to review
  standings and photos, or flag a mistake, before a room disappears
  (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
  The first scheduled (as opposed to callable) function in this repo, and
  the first tested via `firebase-functions-test`'s `wrap()` rather than a
  client wrapper, since a cron job has no client caller to go through.

`functions/index.js` additionally constructs an Express app with CORS and then
never exports or uses it — pre-existing dead scaffolding, unrelated to
either callable.

**Kills and kill-undo are the exception; everything else is still
client-side.** Target _generation_ (the initial ring assignment), open-season
toggling, task-completion scoring, and reviving a player all still execute in
the browser and write directly to Firestore, same as before. `firestore.rules`
(item 2) scopes those writes to the room's host, but does not distinguish
_which_ field a host writes — a signed-in host can still write a player's
score directly, for anything that isn't a kill or a kill-undo. See
`firestore.rules`'s own header comment, `improvements.md` item 4's resolution
for the original kill boundary, and the 2026-08-16 full-kill-undo design spec
for how undo was brought inside that same boundary.

`functions/` is a separate npm package sharing the root's dependency tree
via npm workspaces (`package.json`'s `"workspaces": ["functions"]`) — a
single `npm install` at the repo root installs both. `killPlayer.js` reuses
`src/game/remapPlan.js` (and its own dependencies, `targetGraph.js` and
`playerNames.js`) directly via a relative `require()` — those three files
use CommonJS `module.exports` rather than this codebase's usual ES
`export`/`import` specifically so a plain Node `require()` from `functions/`
works with no build step; the client's existing `import` of them is
unaffected (webpack's CommonJS interop). `joinRoom.js` reuses
`playerNames.js` the same way, for the same reason.

## Configuration and environments

`src/utils/firebase.js` reads six `REACT_APP_*` variables from `.env` and, when
`process.env.NODE_ENV === 'development'`, connects all four SDKs to local
emulators:

| Emulator  | Port (`firebase.json`) | Client (`utils/firebase.js`) |
| --------- | ---------------------- | ---------------------------- |
| Auth      | 9099                   | 9099                         |
| Functions | 5001                   | 5001                         |
| Firestore | 8081                   | 8081                         |
| Storage   | 9199                   | 9199                         |

`NODE_ENV` is set to `development` by `react-scripts start`, so **`npm start`
always targets emulators** and `npm run build` always targets production. There
is no way to run the dev server against the real project without editing code.

`.firebaserc` maps `default`, `dev`, and `prod` aliases all to the same project
ID, `mall-mystery-heroes`. There is no environment separation.

`firebase.json` configures functions, emulators, storage rules, and hosting.
`npm run build` produces `build/`, which `firebase.json`'s `hosting.public`
points at; `firebase deploy --only hosting` ships it.

`hosting.headers` explicitly overrides Firebase Hosting's default
`Cache-Control: max-age=3600` on `index.html` (the SPA shell every route
rewrites to) down to `no-cache, no-store, must-revalidate` — without this, a
browser or Firebase's own CDN edge can keep serving the _previous_ deploy's
`index.html` (referencing the previous build's hashed JS/CSS filenames) for
up to an hour after a new deploy, making a shipped fix look like it never
went out. The hashed `/static/**` assets get the opposite treatment
(`max-age=31536000, immutable`) — safe, since a changed file always gets a
new content-hashed filename.

**`firestore.rules`, `functions`, and `hosting` must be deployed together.**
`/join` calls the `joinRoom` Cloud Function, and the room-scoping rules'
`isHostOfExistingRoom`/`isPlayerOfRoom` checks depend on `joinedUids`, which
only `joinRoom` writes — deploying one without the other leaves the Join
flow broken (the callable doesn't exist, or a joined player still can't read
their own room). As of this writing, Hosting has been deployed several
times but Functions never has, so this ordering is not yet a solved
problem, only a documented one.

The identity-verified player-writes feature adds a second, sharper
instance of the same hazard, and this one has a wrong order rather than
just a coupled one. `firestore.rules` no longer carries an `allow create`
grant for `photos` or `playerMessages`, because those writes moved into
`submitKillPhoto`/`submitChatMessage`. Deploying `firestore.rules` before
`functions` therefore opens a window in which no player can submit a kill
photo or send a chat message at all — the rule that used to permit the
client write is gone, and the callable that replaces it does not exist
yet. Deploy `functions` first, or both together; the reverse order is
never right here. `hosting` has the same dependency for the same reason —
the new bundle calls callables that must already exist — so `functions`
goes first in both pairings.

## Build and test tooling

Create React App 5 (`react-scripts`), Chakra UI 2 for all styling (no CSS
modules; `App.css`/`index.css` are near-empty), React Router 6.

`jest.config.js` and `babel.config.js` configure a full Jest + Testing
Library + jsdom stack. `npm test` runs `jest --selectProjects unit dom`
directly (not `react-scripts test`), so it does read `jest.config.js`. See
[testing.md](./testing.md) for the current suite — this note used to say
"there are no test files," which stopped being true a long time ago and was
never updated.

## Related documents

- [data-model.md](./data-model.md) — Firestore collections, field by field
- [game-flows.md](./game-flows.md) — sequence diagrams for the core flows
- [commands.md](./commands.md) — the GM command bar reference
- [improvements.md](./improvements.md) — prioritized backlog of known issues
