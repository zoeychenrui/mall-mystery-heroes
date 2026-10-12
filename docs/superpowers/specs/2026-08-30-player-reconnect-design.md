# Player Reconnect Design

**Date:** 2026-08-30
**Status:** Approved

## Problem

A player's browser can lose its Firebase Auth session mid-game with no
explicit action from them — Safari Private Browsing is guaranteed to do
this (it deliberately limits how long login data survives there), and
regular Safari on iPhone has a long, separate history of evicting a
backgrounded tab's stored data under memory pressure, which live,
walk-around gameplay (locking the phone, switching to the camera, checking
a map) triggers constantly. When it happens, `PlayerGame.js`'s existing
`handleSubscriptionError` — built for legitimate cases like being kicked or
the room ending — fires the same way: it clears the local session and
sends the player back to the home screen, because every Firestore read
they depend on starts failing `isPlayerOfRoom`'s uid check once their
login has silently changed. Their player document is untouched (the
moderator still sees them on the roster), but there is currently no way
back in: `joinRoom.js` rejects every join attempt once `gameStarted` is
true, with no distinction between a genuine new latecomer and a returning
player reclaiming their own identity.

## Decisions

- **GM-approved reconnect, not fully self-service.** A returning player's
  device, now signed in under a different uid than before, has no way to
  cryptographically prove it's the same person — the only proof available
  is social: the moderator is physically present and can confirm it. This
  matches how every other sensitive action in this app already works
  (kills, revives, mission completions, kicks are all ultimately at the
  host's discretion) rather than inventing a new trust mechanism (a
  recovery code, a password) this app has never needed before.
- **Mirrors the existing photo-approval pattern exactly** — a small queue
  of pending items the GM judges, not a new UI paradigm. A reconnect
  request is conceptually "a photo, but for identity" and reuses that
  shape: `rooms/{roomId}/reconnectRequests/{autoId}` with a `status` field
  (`pending`/`approved`/`denied`), a GM-facing list with Approve/Deny, and
  a requester-facing "waiting" screen watching that one document.
- **`joinRoom.js` stays completely untouched.** Reconnect is a fully
  separate Cloud Function and code path, triggered client-side
  (`JoinGame.js`) only when a join attempt fails with `joinRoom`'s
  existing, unchanged `'This game has already started.'` error. This
  keeps the already-battle-tested join path at zero risk and keeps
  reconnect's own validation (does a player with this name actually
  exist?) fully independent.
- **No new rate limiting.** `submitKillPhoto.js`/`submitChatMessage.js`
  rate-limit by storing a rolling window on the _submitting_ player's own
  document — but a reconnect requester has no player document under their
  new uid (that's the entire premise; they're requesting one). Keying a
  limit to the _target_ name instead would risk a legitimate second
  attempt by the real returning player being blocked by an unrelated
  prior request against the same name. Given every request still requires
  explicit GM approval regardless of volume — capping the actual
  damage — this is a deliberate scope decision, not an oversight.
- **A denied or still-pending request never touches player data.** Only
  approval writes anything to the player document or the room's
  `joinedUids` — mirrors how a denied photo never touches player data
  either.

## Components

### `functions/callableFunctions/reconnectRequest.js` (new)

Three `onCall` exports, all throwing `HttpsError`s on every failure path
matching this codebase's convention:

- **`requestReconnect({roomId, playerName})`** — no host check; callable
  by anyone signed in. Plain read-then-write, not a transaction (creating
  a pending request has no atomicity requirement beyond itself, unlike
  approval below). Validates the room exists, `gameStarted` is true
  (defensive — `JoinGame.js` only calls this after `joinRoom` already
  confirmed as much, but this function doesn't trust that), and the room
  is still active (`isGameActive !== false && !endedAt`, mirroring
  `joinRoom.js`'s own identical check and its exact `'This room is no
longer active.'` wording) — a reconnect request against an already-
  ended room has nothing to rejoin. Then looks up
  a player document by `normalizePlayerName(playerName)` the same way
  `joinRoom.js` keys its own lookup (`trimmedNameLowerCase` as the doc
  ID). `not-found` if no such player exists — this is what correctly
  rejects a genuine new latecomer with an unused name, distinct from a
  real reconnect. On success, creates
  `rooms/{roomId}/reconnectRequests/{autoId}` with
  `{playerName, trimmedNameLowerCase, requestingUid: context.auth.uid, status: 'pending', timestamp: FieldValue.serverTimestamp()}`
  and returns `{requestId}`.
- **`approveReconnectRequest({roomId, requestId})`** — host-only, mirrors
  `killPlayer.js`'s host check exactly. One transaction: reads the
  request (`not-found` if missing, `failed-precondition` if not
  `pending`), reads the target player document by the request's
  `trimmedNameLowerCase` (`not-found` if that player no longer exists —
  defensive, e.g. they were kicked or left in the meantime), then writes
  three things atomically: the player document's `uid` field becomes
  `requestingUid`; the room's `joinedUids` gains `requestingUid` via
  `FieldValue.arrayUnion` (mirrors `joinRoom.js`'s own write); the
  request's `status` becomes `approved`.
- **`denyReconnectRequest({roomId, requestId})`** — host-only, same host
  check. One transaction: reads the request (same two guards as above),
  writes only `status: 'denied'`. Touches no player data, matching a
  denied photo's own behavior.

### `src/components/requestReconnect.js`, `approveReconnectRequest.js`, `denyReconnectRequest.js` (new)

Thin `httpsCallable` wrappers, mirroring `executeKill.js`'s three-line
shape. `requestReconnect(roomID, playerName)` resolves to `{requestId}`;
the other two resolve to nothing meaningful (mirrors `undoKill.js`).

### `src/components/firebase_calls/dbCalls.js` (modified)

Two new read functions, mirroring existing ones' exact style:

- `fetchReconnectRequestReferenceForRoom(requestId, roomID)` — a single
  doc reference for `onSnapshot`, mirrors `fetchPlayerReferenceForRoom`.
  Powers the requester's own "waiting for approval" screen.
- `fetchPendingReconnectRequestsQueryForRoom(roomID)` — a query filtered
  to `where('status', '==', 'pending')`, mirrors
  `fetchPhotosQueryByAscendingTimestampForRoom`. Powers the GM's pending-
  requests list.

### `src/pages/JoinGame.js` (modified)

`handleSubmit`'s existing `catch` block gains one new branch: if
`joinRoom` rejected with exactly the message `'This game has already
started.'`, call `requestReconnect(trimmedGameId, playerName)` instead of
surfacing that error. On success, navigate to a new route
(`/rooms/${roomID}/reconnecting/${requestId}`) rather than
`/rooms/${roomID}/waiting` — the requester isn't in `joinedUids` yet, so
`PlayerGame.js`'s own reads would fail `isPlayerOfRoom` until approved.
If `requestReconnect` itself also rejects (the genuine-new-latecomer
case, or the room genuinely doesn't accept reconnects for some other
reason), surface that error the normal way — the player sees a clear
"you're not an existing player in this room" message instead of a silent
retry loop.

### `src/pages/ReconnectPending.js` (new)

A small page, structurally similar to `PlayerGame.js`'s pre-game waiting
state but far simpler — no chat, no target display, just a status line.
Subscribes to `fetchReconnectRequestReferenceForRoom(requestId, roomID)`
via `onSnapshot`:

- `status === 'pending'` → "Waiting for the host to approve your
  reconnect…"
- `status === 'approved'` → calls `writePlayerSession(roomID,
playerName)` (the name came back in the request document itself, real
  stored casing) and navigates to `/rooms/${roomID}/waiting` — the normal
  `PlayerGame.js` flow, which now succeeds since this device's uid just
  landed in `joinedUids`.
- `status === 'denied'` → shows a plain "Your reconnect request was
  denied" message with a button back to `/`.
- The request document disappearing entirely (defensive — shouldn't
  normally happen) is treated the same as `denied`.

New route in `App.js`: `/rooms/:roomID/reconnecting/:requestId`, wrapped
in `RequireAuth` the same way `/rooms/:roomID/waiting` already is — the
requester is signed in (that's how they got a uid to attach the request
to at all), just not yet a confirmed room player.

### `src/components/ReconnectRequests.js` (new)

A small GM-facing component, mounted in `GameMasterView.js` near
`HeaderExecution` (visible whenever the console is open, not buried in a
modal — a pending reconnect is worth surfacing immediately). Takes no
props — reads `roomID` from `gameContext` the same way `PhotosDisplay.js`
already does (`const { roomID } = useContext(gameContext);`), and reads
`addLog`/`addPlayerMessageForRoom` the same way every other GM-facing
component in this tree does (`addLog` via `executionContext`,
`addPlayerMessageForRoom` imported directly from `dbCalls`, mirroring
`PhotosDisplay.js`'s own import shape exactly). Subscribes
to `fetchPendingReconnectRequestsQueryForRoom(roomID)`; renders nothing
when the list is empty. Each pending request renders as a single row —
player name, Approve/Deny buttons calling
`approveReconnectRequest`/`denyReconnectRequest(roomID, requestId)` —
no confirmation dialog on either action, matching `/kick`'s own
no-confirmation precedent (a moderator clicking the wrong one here is a
quick, low-stakes mistake to notice and correct, unlike a permanent
delete). Logs and broadcasts the outcome the same way every other
GM-facing action does: `addLog`/`addPlayerMessageForRoom` on approval
("`{name}` reconnected") — deny is not announced to players, mirroring
how a denied kill photo isn't announced either.

### `firestore.rules` (modified)

New `match /reconnectRequests/{requestId}` block under `rooms/{roomId}`:

```
match /reconnectRequests/{requestId} {
  allow read: if isHostOfExistingRoom(roomId) ||
    (isSignedIn() && resource.data.requestingUid == request.auth.uid);
  allow write: if false;
}
```

`allow write: if false` — every write goes through the three Cloud
Functions above (Admin SDK, bypasses rules), matching the `photos`/
`playerMessages` "Interim scope" precedent for anything identity-
sensitive. The `read` grant covers both `get` and `list` uniformly
(unlike the top-level `rooms` collection's split grant — this
subcollection's path is already bound to a known `{roomId}`, so it
doesn't need the query-shape workaround `allow list` on `rooms` itself
required).

## Data model changes

- New subcollection **`rooms/{roomID}/reconnectRequests/{autoId}`**:
  `playerName` (string, real stored casing), `trimmedNameLowerCase`
  (string, the lookup key), `requestingUid` (string), `status`
  (`'pending' | 'approved' | 'denied'`), `timestamp` (server timestamp).
- No changes to any existing collection's schema. Approval writes to the
  existing `players/{playerId}.uid` field and the existing
  `rooms/{roomID}.joinedUids` array — both already-established fields,
  just written by a new code path.

## Error handling

All three Cloud Functions throw `HttpsError`s on every failure path
(unauthenticated, missing arguments, room/request/player not found, not
the host for the two judgment functions, request already
resolved), matching this codebase's throw-don't-swallow convention.
`JoinGame.js` surfaces a `requestReconnect` rejection through its
existing `catch` → `setErrorMessage(err.message)` path, unchanged in
shape. `ReconnectRequests.js` wraps both Approve/Deny calls in
`try`/`catch` → `createAlert`, matching every other GM action in
`PhotosDisplay.js`/`ChatInput.js`.

## Testing

- `functions/callableFunctions/reconnectRequestCallable.integration.test.js`
  (new, emulator, named after this codebase's actual convention — see
  `removePlayerCallable.integration.test.js` from the immediately
  preceding feature): `requestReconnect` creates a pending request for an
  existing player name; rejects a name with no matching player, writing
  nothing; rejects a room where `gameStarted` is false; rejects a room
  that has already ended.
  `approveReconnectRequest` re-links the player document's `uid` and adds
  the requester to `joinedUids`, both inside the same transaction;
  requires the caller to be host; rejects a request that's already been
  resolved; rejects a request naming a player who no longer exists,
  mutating nothing. `denyReconnectRequest` marks the request `denied` and
  writes nothing else; requires host; rejects a request that's already
  been resolved.
- `src/pages/JoinGame.test.jsx` (extended, or created if it doesn't
  exist — check first): a `'This game has already started.'` rejection
  from `joinRoom` triggers `requestReconnect` and navigates to the
  reconnecting route; any other `joinRoom` rejection surfaces normally,
  unchanged; a `requestReconnect` rejection (no matching player) surfaces
  as the visible error.
- `src/pages/ReconnectPending.test.jsx` (new): renders the pending
  message initially; on `status: 'approved'`, writes the session and
  navigates to the waiting route; on `status: 'denied'`, shows the denied
  message; the document disappearing is treated the same as denied.
- `src/components/ReconnectRequests.test.jsx` (new): renders nothing with
  no pending requests; renders a row per pending request; Approve calls
  `approveReconnectRequest` and logs/broadcasts; Deny calls
  `denyReconnectRequest` and does not broadcast; a rejected call from
  either shows an error toast.

## Future improvements

- A reconnect request has no expiry — a stale pending request from a
  player who gave up and went home stays visible in the GM's list
  indefinitely until explicitly denied. Not addressed here; low-stakes
  (an ignorable list entry, not a data-correctness issue), and this
  codebase has no existing precedent for time-based cleanup outside the
  unrelated `cleanupEndedRooms` scheduled function.
- No rate limiting on `requestReconnect` (see Decisions above) — worth
  revisiting if this ever becomes a real abuse vector in practice, which
  is unlikely for a small, in-person, GM-supervised event.

## Out of scope

- Any fully self-service (no-GM) reconnect mechanism.
- Any change to `joinRoom.js` itself.
- Any change to `Homepage.js`'s existing same-uid session recovery — that
  solves a different failure mode (local storage lost, login intact) and
  needs no changes here.
