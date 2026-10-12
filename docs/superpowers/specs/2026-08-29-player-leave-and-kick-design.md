# Player Leave and Kick Design

**Date:** 2026-08-29
**Status:** Approved

## Problem

`PlayerGame.js`'s "Leave" button has never done anything to the room's own
data — it only signs the local browser out and clears local storage
(`docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md`
called this out explicitly as a deferred, separate feature at the time).
A player who leaves stays on the moderator's roster exactly as they were:
still shown, still holding targets, still someone else's target — with
their name never disappearing from the console. There is also no way for a
moderator to remove a player mid-game at all; `PlayerRemove.js`'s "Remove"
button only exists on the pre-game Lobby screen.

## Decisions

- **Leaving is final, not a pause.** A player who leaves (or is kicked) is
  disqualified: no more hunting, no more being hunted, and their document
  is deleted outright — not marked dead, not kept around with a "left"
  label. Kept traces would be more confusing than useful here and would
  complicate every place that reasons about the target graph (a dead
  player still occupies a graph slot with `isAlive: false`; a left/kicked
  player should not exist in it at all).
- **One shared server-side operation, two entry points.** Leaving and
  kicking do exactly the same thing to the data — unmap the player from
  the target graph, remap whoever that leaves short, delete their
  document — so both go through one atomic Cloud Function transaction,
  mirroring `killPlayer.js`'s structure. Two thin `onCall` wrappers front
  it, the same shape `undoMissionCompletion.js` already uses for its two
  entry points:
    - `leaveGame({roomId})` — self-service. No `playerName` argument; the
      caller's own `context.auth.uid` resolves which player doc to remove,
      so a player can only ever remove themselves.
    - `removePlayer({roomId, playerName})` — host-only, mirrors
      `killPlayer.js`'s own host check exactly.
- **No score redistribution.** Unlike a kill, nobody gains the leaving
  player's points — they simply leave with whatever they had. Only the
  target-graph unmap/remap happens; there is no assassin-side score write
  at all.
- **Works identically whether the game has started or not.** A player in
  the pre-game waiting room has empty `targets`/`assassins` arrays (set at
  join), so the remap step is a no-op there — no phase-based branching is
  needed in the Cloud Function. (The existing pre-game-only
  `PlayerRemove.js`/`removePlayerForRoom` stays as-is; it is not touched
  or consolidated by this feature — a separate, already-working path.)
- **`/kick <player>` joins the command bar**, not a console button —
  matches every other mid-game moderator action (`/kill`, `/revive`,
  `/openseason`). No confirmation step, matching every other command-bar
  action (`/kill` included) — typing the exact player name is already the
  deliberate act.
- **The player's own "Leave" button does get a confirmation dialog** —
  the one asymmetry in this design. A fat-fingered `/kick` is a moderator
  correcting a typo by re-running a different command; an accidental tap
  on "Leave" ends that player's entire game with no recovery. Chakra
  `AlertDialog`, same visual pattern as `PlayerRemove.js`/
  `ResetTargetsButton.js`.
- **No undo.** There is no natural UI surface for it (this isn't judged
  from a photo, and there's no per-command undo stack the way
  `/mission done` now has), and it would contradict the "final" framing
  this whole design is built around.
- **`leaveGame` announces itself server-side; `removePlayer` does not.**
  `firestore.rules` restricts both `logs` and `playerMessages` writes to
  `isHostOfExistingRoom` (`firestore.rules:97-103,119-121`) — a player's
  own browser has no write permission to either collection, the same
  reason `submitChatMessage.js`/`submitKillPhoto.js` had to move
  player-initiated writes behind the Admin SDK. So `leaveGame` must write
  its own "`{player}` left the game" log entry and broadcast inside its
  own transaction, using generated document refs the same way a
  transaction creates any other new document (`collectionRef.doc()` then
  `transaction.set()`, since `.add()` isn't a transaction method) — the
  first Cloud Function in this codebase that announces on behalf of its
  own caller, a deliberate, novel exception to every other callable here
  returning data for the client to announce afterward. `removePlayer`
  stays symmetric with `killPlayer.js` instead: the function itself
  doesn't announce anything, and `ChatInput.js` (the host's own,
  already-privileged browser) logs and broadcasts after the call
  succeeds, exactly like `/kill` already does.

## Components

### `functions/callableFunctions/removePlayer.js` (new)

One shared internal transaction step, mirroring `killPlayer.js`'s
unmap-then-remap section (lines ~127–243 of that file) with the
score-transfer and `isAlive`/`openSeason` reset pieces removed, since
those are kill-specific:

- Read phase: locate the player's document (by `uid` for `leaveGame`, by
  `trimmedNameLowerCase` for `removePlayer`, both mirroring existing
  lookup patterns in `killPlayer.js`/`joinRoom.js`). Gather their
  `targets`/`assassins` (the neighbors needing unmapping), then the alive
  roster excluding this player, with this player's name scrubbed from
  every roster member's own `targets`/`assassins` arrays before it's
  handed to `planRemap` — identical reasoning to `killPlayer.js`'s own
  roster read (the removed player's deletion write hasn't landed yet
  within the transaction, so the read has to pre-account for it).
- Decide: `planRemap(roster, { needTargets: playerData.assassins || [], needAssassins: playerData.targets || [] })`
  — same call shape `killPlayer.js` uses for its own unmap case.
- Write phase: queue each neighbor's updated `targets`/`assassins` (name
  scrubbed out), queue every `plan.writes` entry the same way
  `killPlayer.js` does, then `transaction.delete()` the removed player's
  own document instead of updating it.

Returns:

```js
{
    removedPlayerName, // the doc's original-cased `name`, for announcement text
    addedTargets, // for the client's RemapPlayerModal, same shape killPlayer/completeMission return
    addedAssassins,
    remapLogs,
}
```

Two `onCall` exports, both throwing `HttpsError`s on every failure path
(unauthenticated, room/player not found, not the host for `removePlayer`)
matching this codebase's convention:

- **`leaveGame`** — `{roomId}`. Looks up the caller's own player doc via
  `where('uid', '==', context.auth.uid)` (mirrors `joinRoom.js`'s existing
  uid-lookup pattern); `not-found` if this uid never joined this room.
  After queuing the shared removal writes, additionally generates refs via
  `roomRef.collection('logs').doc()` and
  `roomRef.collection('playerMessages').doc()` and `transaction.set()`s
  both — the log entry matching `addLogForRoom`'s shape
  (`{time, log, color, timestamp}`, `color: 'gray.400'`), the message
  matching a `broadcast`'s shape (`{type: 'broadcast', recipient: null, text: '${removedPlayerName} left the game', standings: null}`),
  both using `FieldValue.serverTimestamp()` for `timestamp` (imported the
  same way `undoMissionCompletion.js`/`joinRoom.js` already do, for the
  same emulator-proxy reason documented there). `time` is computed as
  `new Date().toLocaleTimeString()` inside the function, same expression
  `addLogForRoom` uses client-side, but this now runs on the Cloud
  Function's own clock/locale rather than the GM's browser — the log's
  displayed time for this one entry type may not exactly match the GM's
  local time the way every other entry does. Noted under Future
  improvements below rather than solved now.
- **`removePlayer`** — `{roomId, playerName}`. Host check mirrors
  `killPlayer.js`'s exactly (`roomSnapshot.data().hostId !== context.auth.uid`
  → `permission-denied`); `not-found` if no player matches
  `normalizePlayerName(playerName)`. Writes only the shared removal
  fields — no log/message writes of its own, matching `killPlayer.js`.

### `src/components/leaveGame.js`, `src/components/removePlayer.js` (new)

Thin `httpsCallable` wrappers, mirroring `executeKill.js`'s three-line
shape: `leaveGame(roomID)` and `removePlayer(playerName, roomID)`.

### `src/pages/PlayerGame.js` (modified)

`handleLeave` no longer signs out immediately on click. The "Leave" button
opens a confirmation `AlertDialog` ("Leave the game? You'll be removed and
cannot rejoin." / Go Back / Confirm — a distinct label from the trigger's
"Leave", matching `PlayerRemove.js`'s own trigger/confirm naming so the
two never collide as same-named buttons once the dialog is open).
Confirming calls the new `leaveGame`
wrapper (which announces the departure itself — see above, this page
writes nothing to `logs`/`playerMessages` directly, and could not even if
it wanted to), then runs the existing `signOut(auth)` + `clearPlayerSession()`

- `navigate('/')` sequence unchanged. A rejected `leaveGame` call surfaces
  via `createAlert` instead of proceeding to sign out. The existing
  player-doc `onSnapshot` listener (already present — see the "Leave" scope
  comment currently at the top of this file) independently notices the
  deletion and would fire its own `clearPlayerSession()` + `navigate('/',
{replace: true})` regardless; both paths converging on the same outcome is
  harmless; `handleLeave`'s explicit call is what makes the redirect happen
  promptly rather than waiting on the listener's round trip.

### `src/components/logs_components/ChatInput.js` (modified)

New `case '/kick':`, structured like `/kill`'s existing case: resolve
`args[0]` via `normalizePlayerName`, verify it's in `arrayOfPlayerNames`
(`Player {name} is invalid` otherwise, matching every other command's
wording for this check), call the new `removePlayer` wrapper, then log +
broadcast `` `${displayName} was removed from the game` `` and route
`addedTargets`/`addedAssassins`/`remapLogs` to the same handlers `/kill`
already uses.

`/kick` is added to `KNOWN_COMMANDS` in `src/game/commands.js` — the
actual whitelist `parseCommand` checks (`docs/commands.md` calls this
"`sanityCheckCommandInputs`," which is stale; the real gate is
`KNOWN_COMMANDS.includes(command)` in `parseCommand`).

### `src/game/commandCompletion.js` (modified)

`ARG_LABELS` gains `'/kick': ['[player_name]']`, and the `switch` gains a
`case '/kick':` branch that completes against the live roster — mirrors
`/kill`'s existing `case '/kill':` branch (`commandCompletion.js` line
~142) for its first argument slot exactly, since both need the same
"complete to a live player name" behavior.

## Data model changes

None. This feature only deletes documents (the removed player's own) and
writes to fields (`targets`/`assassins` on other players) that already
exist — no new fields anywhere.

## Error handling

Both new Cloud Functions throw `HttpsError`s on every failure path
(unauthenticated, room not found, not the host, uid never joined this
room, player name not found), matching this codebase's throw-don't-swallow
convention. `ChatInput.js`'s `/kick` surfaces a thrown error through the
same outer `` `${commandLine} failed: ${error.message}` `` catch every
other command already uses. `PlayerGame.js`'s `handleLeave` surfaces a
thrown error via `createAlert` rather than proceeding to sign out — a
failed `leaveGame` call must not locally sign the player out of a game
their document is still actually in.

## Testing

- `functions/callableFunctions/removePlayer.test.js` (new, emulator):
  mirrors `killPlayer.integration.test.js`'s structure. `leaveGame`
  removes the caller's own document and nobody else's; `removePlayer`
  requires the caller to be host and rejects a non-host caller; both
  reassign whoever the removed player was hunting or being hunted by
  (seed a room where this provably touches more than one other player,
  matching `killPlayer.integration.test.js`'s own multi-player remap
  coverage) and the response names every player the regen touched;
  calling either against a player who has empty `targets`/`assassins`
  (the pre-game case) succeeds and does nothing but delete the document;
  a `playerName`/uid that doesn't resolve to a player throws `not-found`
  and writes nothing; `leaveGame` writes a matching `logs` entry and a
  `broadcast`-typed `playerMessages` entry naming the departed player,
  `removePlayer` writes neither.
- `src/pages/PlayerGame.test.jsx` (extended): clicking "Leave" opens the
  confirmation dialog and does not yet call `leaveGame`; confirming calls
  it, then signs out and navigates home; "Go Back" calls neither `leaveGame`
  nor `signOut`; a rejected `leaveGame` call shows an error and does not
  sign out.
- `ChatInput.test.jsx` (extended): `/kick <player>` calls the new
  `removePlayer` wrapper with the normalized name; rejects an unknown
  player the same way `/kill` does; logs and broadcasts the removal
  announcement on success; routes `remapLogs`/`addedTargets`/
  `addedAssassins` to the same handlers `/kill`'s own tests already assert
  against; surfaces a thrown error through the existing outer-catch
  wording.
- `src/game/commandCompletion.test.js` (extended): `/kick` completes
  against the live roster the same way `/kill`'s first argument does.

## Future improvements

- A moderator currently has no way to remove a player from the pre-game
  Lobby screen and have them able to rejoin afterward — `PlayerRemove.js`
  deletes the document but never clears the room's `joinedUids`, so the
  same uid trying to rejoin hits `joinRoom`'s existing "you have already
  joined this room" check. This is a pre-existing gap, not introduced or
  worsened by this feature, and out of scope here.
- The Moderator Playbook artifact should get a `/kick` entry once this
  ships — a manual follow-up, not a plan task.
- `leaveGame`'s log entry uses the Cloud Function's own server clock/locale
  for its displayed `time` string, not the GM's browser — every other log
  entry is timed by whichever GM browser wrote it. Unlikely to be
  noticeable (a few hours off at worst, depending on deployment region),
  and not worth a dedicated fix for one entry type unless it's actually
  reported as confusing.

## Out of scope

- Any change to `PlayerRemove.js`/`removePlayerForRoom` (the existing
  pre-game-only lobby removal).
- Undo for either leaving or kicking.
- Any UI beyond the command bar for kicking (no dedicated console button).
