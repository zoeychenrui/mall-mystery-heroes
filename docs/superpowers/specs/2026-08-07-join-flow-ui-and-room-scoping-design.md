# Join-flow UI and room-scoped security

## Problem

Two gaps remain before a player can actually reach a game from their phone.
First, there's no UI for it: the "Host Room" / "Join Game" homepage split
was decided, and `joinRoom`'s backend contract already exists
(`functions/callableFunctions/joinRoom.js`), but nothing calls it — no
join form, no post-join screen. Second, and more importantly, the security
rules underneath that backend contract only check "is this person signed
in to Firebase at all" (`isSignedIn()`), not "is this person actually part
of _this_ room." That directly undermines the reason guest auth exists in
the first place: keeping a game's kill photos private to its own
participants. Both are addressed together here, since the second is what
actually makes the first meaningful.

## Decisions made

- **Homepage: exactly two buttons.** "Host Game" and "Join Game" — not
  "Log In"/"Sign Up"/"Join Game." Clicking "Host Game" leads to an
  intermediate screen offering Log In or Sign Up (today's homepage content,
  moved one level in); clicking "Join Game" leads to the new join form.
- **Join form: one page, no visible auth choice.** Game ID + player name,
  one submit button. `signInAnonymously()` fires invisibly on submit —
  no separate "Continue as Guest" tap, no Google option for players.
- **Post-join landing: a minimal waiting screen.** Room ID, player name, a
  live status line. No gameplay UI (chat, targets, photo upload) — that's
  a future design pass, not this one.
- **Session persistence.** `localStorage` remembers the joined room and
  name, so reopening the tab skips straight back to the waiting screen
  instead of re-prompting for a game ID.
- **The room-scoping security fix ships in this pass, not as a follow-up.**
  It's what actually delivers "outsiders can't see the photos" — guest
  auth alone gives every visitor _an_ identity, but without this, any
  signed-in user (from any room) can still read any other room's data.
- **Retention: 24 hours.** `RETENTION_DAYS` (the mechanism already built,
  currently `null`) becomes `1`.

## Architecture

Every page a player reaches — `Homepage.js`, `/join`, and the waiting
screen — must be mobile-first responsive, carrying forward the earlier
decision that player-facing pages get phone layouts while the existing GM
console stays laptop-oriented and unchanged. `/host` inherits today's
`Homepage.js` layout as-is (also reachable from a phone, since a player
lands on `/` before ever clicking "Join Game," but its _content_ is
unchanged from what already exists — no new responsive work needed there
beyond what the current homepage already has).

### Routing

- **`/` (`Homepage.js`, modified)** — "Host Game" → `/host`; "Join Game" →
  `/join`. On mount, checks `localStorage` for an existing player session;
  if present, redirects straight to that room's waiting screen instead of
  rendering the two buttons.
- **`/host` (new page)** — "Log In" → `/login`; "Sign Up" → `/signup`.
  Visually, this is today's `Homepage.js` content (logo, two buttons),
  relocated one level in.
- **`/login`, `/signup`, `/dashboard`** — unchanged.
- **`/join` (new page)** — the join form (below).
- **`/rooms/:roomID/waiting` (new page, wrapped in `RequireAuth`)** — the
  post-join landing screen (below). `RequireAuth` already accepts any
  signed-in user, anonymous included — no change needed there.

### The join form

Two inputs (game ID, player name), one submit handler:

1. `await signInAnonymously(auth)`.
2. `await joinRoom(gameId.trim(), playerName)` — the existing client
   wrapper (`src/components/joinRoom.js`), unchanged.
3. On success: write `{ roomID: gameId.trim(), playerName }` to
   `localStorage` under the key `mmh:player-session`, then
   `navigate(`/rooms/${gameId.trim()}/waiting`)`.
4. On failure: surface the thrown error's `.message` — exactly
   `joinRoom`'s `HttpsError` message ("Room not found: X", "This game has
   already started.", "This room is no longer active.", "X is already
   taken in this room.") — via the existing `CreateAlert` pattern used
   elsewhere in this app. Do not navigate.

Game-ID matching stays exact-case, trimmed of surrounding whitespace only —
matching the existing room-ID generation scheme (adjective + digits, e.g.
`Fluffy42317`). Case-insensitive or fuzzy matching is explicitly not
addressed here (see Out of scope).

### Post-join waiting screen

Subscribes to the room document via the existing
`fetchRoomReferenceForRoom(roomID)` + `onSnapshot` — the same pattern
`GameMasterView` already uses to watch `isGameActive` live. Displays the
room ID, the player's name, and a status line driven by `gameStarted`
("Waiting for the host to start..." / "The game has started!"). If the
snapshot reports the room no longer exists (e.g. swept up by the 24-hour
cleanup), the screen clears `localStorage` and redirects to `/`. A small
"Leave" button calls `signOut(auth)`, clears `localStorage`, and navigates
home — mirroring `Lobby.js`'s existing logout pattern. "Leave" only ends
_this device's_ local session: it does not remove the player from the
room's roster, touch `joinedUids`, or affect their targets/assassins.
Actually leaving a game (freeing up whatever depends on that player) is a
separate, larger feature not addressed here.

### Session persistence

`localStorage` key `mmh:player-session`, value `{ roomID, playerName }`,
written once on successful join. `Homepage.js` checks this key on mount;
if present, it skips rendering the two buttons and navigates straight to
`/rooms/${roomID}/waiting`. `/join` does not check it — the join form
always renders, so a player can join a second game if they want to
(overwriting the stored session on their next successful join).

### Room-scoping security fix

`joinRoom` (`functions/callableFunctions/joinRoom.js`) gains two more
writes inside its existing transaction, alongside the player-doc `set`:

- `uid: context.auth.uid` on the new player document itself — groundwork
  for any future per-player write scoping; not required by this fix alone,
  but the natural place to record which browser session a player doc
  belongs to.
- `transaction.update(roomRef, { joinedUids: admin.firestore.FieldValue.arrayUnion(context.auth.uid) })`
  on the room document — this is what the security rules below actually
  check. Firestore rules can't query "does any player doc in this
  collection have field X == Y," only fetch a specific known path, and
  player docs are keyed by `trimmedNameLowerCase`, not by uid — so a
  room-level list is the only way to make "is this uid a player of this
  room" checkable from a rule.

`DashBoard.handleHostRoom`'s room-creation write gains `joinedUids: []`,
matching the existing convention of initializing every room-level field at
creation (`gameStarted: false`, `taskIndex: 1`, `storageReference: []`).

`firestore.rules` gains two functions:

```
function isPlayerOfRoom(roomId) {
  return isSignedIn() &&
    request.auth.uid in get(/databases/$(database)/documents/rooms/$(roomId)).data.joinedUids;
}

function isHostOrPlayerOfRoom(roomId) {
  return isHostOfExistingRoom(roomId) || isPlayerOfRoom(roomId);
}
```

and every `allow read` in `rooms/{roomId}` and its five subcollections
(`players`, `tasks`, `logs`, `photos`, `playerMessages`) changes from
`if isSignedIn()` to `if isHostOrPlayerOfRoom(roomId)`. `allow write` /
`allow update, delete` stay host-only, unchanged — this is a read-scoping
fix only. `get()` inside a rule condition already reads the target
document regardless of that document's own rules (the same mechanic
`isHostOfExistingRoom` already relies on today, evaluating
`get(.../rooms/roomId).data.hostId` while deciding on writes to that very
document) — so nesting `isPlayerOfRoom`'s `get()` inside the room
document's own `allow read` is not a new kind of circularity, just the
same established pattern reused.

A room whose `joinedUids` field is absent (e.g. one created before this
change deploys) simply evaluates `isPlayerOfRoom` to `false` for everyone
— missing-field access inside a rule fails the condition rather than
throwing, so this fails closed, not open. Since no Cloud Functions have
ever been deployed to production and no join flow has been live before
this, no room can currently exist with players who'd be newly locked out.

`storage.rules` is untouched. Nothing in this codebase uploads to or reads
from Firebase Storage yet (confirmed: no `firebase/storage` call exists
outside its own initialization in `src/utils/firebase.js`), so there's no
path convention yet to scope a rule against.

### Retention

`functions/scheduledFunctions/cleanupEndedRooms.js`'s `RETENTION_DAYS`
constant changes from `null` to `1`. Nothing else changes — the mechanism
(query-scoped read, `recursiveDelete()`, the pure `selectExpiredRooms`
selection logic) is already built and tested from the prior plan.

## Data model changes summary

- `rooms/{roomID}`: one new field, `joinedUids: string[]` — initialized
  `[]` at creation (`DashBoard.handleHostRoom`), appended to by `joinRoom`
  via `arrayUnion`.
- `rooms/{roomID}/players/{trimmedNameLowerCase}`: one new field,
  `uid: string` — written only by `joinRoom`'s self-registration path;
  absent on GM-added players, who have no associated browser session.
- `firestore.rules`: read access on `rooms/{roomId}` and its five
  subcollections tightens from "any signed-in user" to "host or player of
  this room." Write access is unchanged.
- `RETENTION_DAYS` constant: `null` → `1`.

## Testing

- `Homepage.js`'s new buttons and the localStorage redirect-on-mount:
  component test, mocking `localStorage` and `useNavigate`, following this
  app's existing `RequireAuth.test.jsx`-style mock conventions.
- The new `/host` page: a small component test — two buttons navigate to
  `/login` and `/signup` respectively.
- The join form: component test mocking `signInAnonymously` and the
  `joinRoom` client wrapper — the success path (localStorage written,
  navigation fires) and each error path (room not found, already started,
  room inactive, name taken) surfacing the right message.
- The waiting screen: component test mocking
  `fetchRoomReferenceForRoom`/`onSnapshot` — renders room ID and name,
  updates its status line on a simulated `gameStarted` change, redirects
  home on a simulated "room no longer exists" snapshot.
- `joinRoom`'s new `uid`/`joinedUids` writes: extends the existing
  `joinRoom.integration.test.js` (already running against the real
  emulator) — assert the new player doc has `uid` set and the room
  document's `joinedUids` contains it after a successful join.
- `firestore.rules`'s tightened read rules: this changes existing
  assertions in `test/firestore.rules.test.js`, not just adds new ones —
  today's suite very likely has a passing case asserting that "any
  signed-in user can read a room" (matching the current `isSignedIn()`-only
  rule), which must flip to a denial once `isHostOrPlayerOfRoom` lands,
  since that's precisely the behavior this fix removes. New cases: a
  signed-in stranger (no player doc, not the host) is denied read on a
  room and its subcollections; a player present in `joinedUids` is
  allowed; the host is allowed regardless.
- `RETENTION_DAYS = 1`: no new test needed — `selectExpiredRooms`'s
  existing unit tests already cover arbitrary retention values via
  injected `now`, and `cleanupEndedRooms.integration.test.js` already
  tests the boundary/off/never-ended cases generically, independent of
  the constant's actual value.

## Out of scope

- Actual gameplay UI for players (chat, viewing your own targets and
  assassins, submitting kill photos). The waiting screen is the full
  extent of the player experience built in this pass.
- Rate-limiting or abuse protection on `joinRoom` — nothing stops a
  signed-in-anonymously caller from joining repeatedly with junk names.
  Flagged by the prior whole-branch review as a follow-up for exactly this
  pass; still deliberately deferred, since addressing it would pull in
  Firebase App Check or similar and hasn't been requested.
- Case-insensitive or fuzzy game-ID matching. Exact-case only, as
  generated.
- `storage.rules` scoping. No photo-upload code exists yet to scope a rule
  against; revisit once that feature is actually built.
- Letting a player rejoin from a _different_ device under the same
  identity (e.g. "I'm Alice, let me also see the game on my tablet").
  Session persistence here is single-device, `localStorage`-only — no
  cross-device account linking.
