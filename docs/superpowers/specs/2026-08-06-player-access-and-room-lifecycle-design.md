# Player access, auth, and room lifecycle

## Problem

The GM console is currently a single-audience app: one Firebase Auth
account (the host), driving the whole game from a laptop. The plan is for
players to join the same live-action game from their own phones, using the
**same website** — not a separate app or repo. That reframes several things
already brainstormed once under a "separate mobile app" assumption
(`docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md`
is unaffected by this correction — `playerMessages`/`photos` are still
collections written/read by _some_ player-facing client; that client just
turns out to be this same web app, not a distinct one).

This spec covers three things brainstormed together, since they turned out
to be tightly coupled: how a player reaches and joins a game from their
phone, how both roles authenticate, and how a room's data is eventually
cleaned up after a game ends.

## Decisions made

- **Same website, not a separate app.** The existing homepage
  (`src/pages/Homepage.js`, currently just "Log In" / "Sign Up" buttons
  leading to the GM's email/password auth) gains a third option, "Join a
  Game," for the new player flow. The existing GM path (Log In/Sign Up →
  `/dashboard` → "Host Room") is unchanged. One URL either way. New
  player-facing pages must be mobile-first responsive; existing GM console
  pages are unchanged (GM explicitly uses a laptop).
- **Auth: Google or Guest, for both roles.** `signInWithPopup` +
  `GoogleAuthProvider` (already imported in `utils/firebase.js`, never
  called anywhere — greenfield) is added as an option alongside the GM's
  existing email/password flow, _and_ as one of two choices on the new
  player-join flow. The other choice, Guest, is Firebase Anonymous Auth
  (`signInAnonymously()`) — invisible to the player, no login screen. Both
  are purely login methods for now; no persistent profile/history feature
  is attached to either.
- **Player self-registration, Lobby-only.** A player enters a room code,
  picks Google or Guest, types their own name, and is added to that room's
  roster — no GM pre-typing required. Only allowed before the GM clicks
  "Begin Game"; once targets are generated there's no path (yet) to insert
  a late joiner into a live target graph, so self-registration simply stops
  being available once the game starts.
- **Session persistence.** Once joined, the browser remembers "I'm Alice in
  room X" (e.g. `localStorage`) so reopening the tab/app mid-game doesn't
  require re-entering the room code and name.
- **Room deletion counts from when the game ends, not from creation.** A
  room being actively played is never at risk of cleanup no matter how long
  the game runs. A room that's abandoned mid-lobby and never gets "End
  Game" clicked is explicitly **not** covered by this — see Out of scope.
- **Retention duration is deferred, but the mechanism isn't.** Build the
  full deletion pipeline now; the actual number of days is a single
  constant, unset (no-op) until a value is chosen.

## Architecture

### Shared homepage routing

`Homepage.js` gains a third button next to the existing "Log In"/"Sign Up":
"Join a Game." This leads to a new join flow (new page(s), not yet
named/routed here in detail — left for the implementation plan, since the
exact screens are the first genuinely new player-facing UI in this app and
deserve their own pass once this spec is approved). The GM's existing
Log In/Sign Up → `/dashboard` → "Host Room" →
`/rooms/:roomID/lobby` → `/rooms/:roomID/GameMasterView` routes are
untouched.

### Auth

`src/components/auth.js` (today: email/password only, used by both
`/login` and `/signup`) gains a "Sign in with Google" button calling
`signInWithPopup(auth, googleProvider)`. This is additive — existing
email/password behavior, tests, and routes are unchanged.

The new player-join flow presents its own two options — Google (same
`signInWithPopup` call) or Guest (`signInAnonymously(auth)`) — since a
player arriving at a live in-person game is a different context from a GM
setting up an account ahead of time, and forcing a player through the GM's
existing full-page login form would be the wrong UX for a "someone hands
you their phone at the door" moment.

### Player self-registration: new Cloud Function `joinRoom`

Mirrors the existing `killPlayer.js` pattern (Admin SDK, atomic, all
validation server-side, bypasses client rules entirely) rather than a
client-side Firestore write, for the same reason `addPlayerForRoom`'s
duplicate-name check already needs to be atomic
(`docs/improvements.md` item 34) — Firestore security rules alone can't
enforce "no duplicate exists" across a collection without a transaction.

```
joinRoom({ roomId, playerName }) — callable, requires auth (Google or
anonymous, either satisfies context.auth)
  1. Look up the room; not-found → error.
  2. Check room.gameStarted !== true; if already started → error
     ("This game has already started").
  3. Transaction: check for an existing player with the same
     trimmedNameLowerCase in this room; if found → error ("That name is
     already taken"); otherwise create the player doc (same shape
     addPlayerForRoom already writes: name, trimmedNameLowerCase, score: 0,
     isAlive: true, targets: [], assassins: [], openSeason: false).
```

Reuses the exact duplicate-check-plus-write transaction shape
`addPlayerForRoom` already has in `dbCalls.js` — this function is the
player-facing entry point to the same guarantee, not a new one.

### New field: `rooms/{roomID}.gameStarted`

Currently nothing distinguishes "Lobby, still setting up" from "game
actually running" — `isGameActive` is set `true` at room _creation_
(`DashBoard.handleHostRoom`) and only goes `false` on explicit "End Game."
It answers "does this room still exist / hasn't been torn down," not
"has gameplay started." `joinRoom` needs the latter.

- `DashBoard.handleHostRoom`'s room-creation write gains `gameStarted: false`.
- `TargetGenerator.js`'s `onYesClose` (the "Confirm and Begin Game" handler
  that already writes targets/assassins per player and logs "Game has
  begun!") gains one more field on the room doc: `gameStarted: true`.

### New field: `rooms/{roomID}.endedAt`

`dbCalls.endGame` currently writes only `{ isGameActive: false }`. It gains
`endedAt: serverTimestamp()` alongside it — the timestamp the cleanup
mechanism below hangs off of. Nothing currently records when a room ended;
this is the first thing that does.

### Room cleanup: scheduled Cloud Function

A new scheduled function (`functions.pubsub.schedule('every 24 hours')`,
matching the existing `functions/callableFunctions/` structure with a new
`functions/scheduledFunctions/` directory) queries
`rooms` where `endedAt` is set and older than a retention constant, and for
each match, deletes the room and every subcollection under it
(`players`, `logs`, `tasks`, `photos`, `playerMessages`) via the Admin
SDK's `db.recursiveDelete()` — necessary because Firestore never
cascade-deletes subcollections when a parent document is deleted; a plain
`delete()` on the room doc alone would leave every subcollection orphaned
forever.

```js
// functions/scheduledFunctions/cleanupEndedRooms.js
const ROOM_RETENTION_DAYS = null; // unset = function is a deliberate no-op

exports.cleanupEndedRooms = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async () => {
        if (ROOM_RETENTION_DAYS === null) return null;
        const cutoff = /* now - ROOM_RETENTION_DAYS */;
        const expiredRooms = await db.collection('rooms')
            .where('endedAt', '<=', cutoff)
            .get();
        for (const room of expiredRooms.docs) {
            await db.recursiveDelete(room.ref);
        }
    });
```

Turning this on later is a one-line change (`ROOM_RETENTION_DAYS = 3`, or
whatever value is chosen) — no logic changes needed.

## Data model changes summary

- `rooms/{roomID}`: two new fields, `gameStarted: boolean` (set at
  creation, flipped at "Begin Game") and `endedAt: Timestamp | null` (set
  at "End Game").
- New Cloud Function `joinRoom` (callable, in
  `functions/callableFunctions/`, alongside `killPlayer.js`).
- New Cloud Function `cleanupEndedRooms` (scheduled, new
  `functions/scheduledFunctions/` directory).
- No Firestore rules changes required — `joinRoom`'s writes go through the
  Admin SDK, same as `killPlayer.js`, bypassing rules entirely. The
  scheduled cleanup function does too.

## Testing

- `functions/callableFunctions/joinRoom.js`: same testing shape as
  `killPlayer.js` — the duplicate-check/room-lookup logic should be
  exercised the way this repo already tests transaction-shaped Cloud
  Function logic (see `docs/testing.md` for the current pattern; the exact
  layer is left to the implementation plan since `killPlayer.js` itself
  doesn't have direct unit coverage in this repo today — extracting
  validation into a pure, testable helper the way `planRemap.js` was
  extracted from `killPlayer.js`'s own logic is the established precedent
  to follow here too).
- `cleanupEndedRooms`'s "which rooms qualify" decision (given a retention
  duration, a list of rooms, and "now") should be extracted into a pure
  function and unit tested directly — same reasoning as `leaderboard.js`:
  a scheduled function's _selection logic_ shouldn't require the emulator
  to test, only its actual Firestore reads/deletes should.
- `DashBoard.js`/`TargetGenerator.js`'s new field writes: covered by
  existing test patterns for those files (`TargetGenerator.test.jsx`
  already exists from the player-messaging work; `DashBoard.js` remains
  CLAUDE.md's one untested Firebase-SDK-direct exception).

## Out of scope

- The actual join-flow UI screens (room code entry, name entry, Google/Guest
  choice buttons) — this spec covers the backend contract and auth
  mechanism; the screens themselves are the next design pass once this is
  approved.
- Mid-game late joins. `gameStarted` exists specifically to block this, not
  to enable it later — a genuinely different, harder problem (inserting a
  new player into a live target graph) if ever wanted.
- Cleanup for rooms that are abandoned mid-lobby and never explicitly
  ended. `endedAt` is only set by `endGame`; a room nobody ever ends
  lingers forever under this design. A separate policy (different trigger,
  possibly a different duration) would be needed to cover that case — not
  bundled in since only one duration was asked for.
- Choosing the actual retention duration. The constant ships unset/no-op.
- Any persistent profile/history feature tied to a Google-authenticated
  player. Confirmed explicitly out of scope this pass.
- Changes to the GM's existing email/password flow beyond additively
  bolting on a Google option next to it.
