# Player target/status view

## Problem

Once a GM starts a game, a player's phone has nothing to show them. The
join flow and waiting screen already exist
(`docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md`),
but `PlayerWaiting.js` only ever renders "waiting for host" /
"game has started" — never the one thing the game is actually about: who
they're hunting. Player docs already carry `targets`, `assassins`,
`isAlive`, and `score` (`docs/data-model.md`); nothing player-facing reads
them.

This is the first of four independent pieces of the broader "in-game
player experience" (the others — player chat/messaging, kill-photo
submission, and a real leave-game flow — are separate, not-yet-designed
sub-projects; see Scope below).

## Decisions made

- **Target only, not assassin.** A player sees who they're hunting, not
  who's hunting them — classic assassin-game paranoia, and consistent
  with what the GM console itself already withholds from players today.
- **Elimination doesn't end participation.** An eliminated player
  (`isAlive: false`) sees a short "you've been eliminated" state, but
  keeps watching — they can be revived. Revival is entirely GM-driven in
  this design: the GM assigns/marks a `'Revival Mission'`-type task via
  the existing `/mission` command exactly as today; this piece adds no
  player-facing mission-completion or submission UI. A player-side
  mission-completion flow is out of scope here — it likely shares
  machinery with kill-photo submission, itself a separate, not-yet-designed
  sub-project.
- **No new route.** `PlayerWaiting.js` is renamed to `PlayerGame.js` and
  extended in place, at the same `/rooms/:roomID/waiting` path. It already
  owns the one live subscription (`gameStarted`) that gates everything;
  adding a redirect to a second route for the in-game view would be an
  extra hop for no benefit.
- **Read-only.** This screen makes no writes. No `firestore.rules` or
  `storage.rules` changes are needed for this piece.

## Architecture

### Component: `src/pages/PlayerGame.js` (renamed from `PlayerWaiting.js`)

- The existing `gameStarted` subscription (`onSnapshot` on the room doc,
  `PlayerWaiting.js:22-49` today) is unchanged, including its error
  handling (permission error or room deleted → clear session, redirect to
  `/`).
- New: once `gameStarted` is `true`, a second `useEffect` subscribes via
  `onSnapshot` to `fetchPlayerReferenceForRoom(playerName, roomID)` (new
  `dbCalls.js` function, below), storing `{ isAlive, targets }` in state.
  Does not subscribe while `gameStarted` is `false` — no need to read the
  player doc before the game has started, and it keeps the "waiting"
  screen's read footprint unchanged from today.
    - Same error-handling shape as the room subscription: a permission
      error or the player doc vanishing (e.g. GM removed the player) clears
      the local session and redirects to `/`.
- Render logic:
    - `!gameStarted` → unchanged: "Waiting for the host to start..." + Leave
      button.
    - `gameStarted && isAlive` → "Your target: {targets.joined}" if
      `targets` is non-empty, else "Waiting for your target..." (covers the
      brief window before target assignment runs). Renders the full
      `targets` array, not just its first element — the schema allows more
      than one.
    - `gameStarted && !isAlive` → "You've been eliminated" + a line noting
      they may be revived if the GM assigns them a revival mission.
- Leave button: unchanged from today (clears local session only; does not
  touch room membership). Already explicitly deferred as its own future
  feature in the prior spec.

### Data: `src/components/firebase_calls/dbCalls.js`

New function, mirroring the existing `fetchRoomReferenceForRoom`:

```js
export const fetchPlayerReferenceForRoom = (playerName, roomID) =>
    doc(db, 'rooms', roomID, 'players', normalizePlayerName(playerName));
```

Returns a doc ref (not an async fetch) — same shape as
`fetchRoomReferenceForRoom`, so the component subscribes to it directly
via `onSnapshot`, matching the live-subscription pattern used everywhere
else in this app (players list, logs, room doc). Identity comes from the
existing local session (`playerName`, via `readPlayerSession()`) — no new
uid-based lookup is introduced; every other player lookup in `dbCalls.js`
already goes by name via `normalizePlayerName`, and this follows the same
convention.

## Testing

`src/pages/PlayerGame.test.jsx` (renamed from `PlayerWaiting.test.jsx`,
jsdom project):

- Existing coverage carries over unchanged: shows "waiting" text before
  `gameStarted`; Leave button behavior.
- New: player-doc subscription is not started while `gameStarted` is
  `false`.
- New: once `gameStarted` is `true` and the player is alive, renders their
  target(s) from the subscribed snapshot.
- New: renders "waiting for your target" when `targets` is empty.
- New: once `gameStarted` is `true` and `isAlive` is `false`, renders the
  eliminated state instead of a target.
- New: a player-doc subscription error (or the doc vanishing) clears the
  session and redirects to `/`, mirroring the existing room-subscription
  error test.

`fetchPlayerReferenceForRoom` gets one new case wherever
`fetchRoomReferenceForRoom` is currently tested (asserting the doc-ref
path shape), if that sibling function has direct test coverage today.

## Scope

**In scope:** the target/status view described above, for both alive and
eliminated players.

**Explicitly out of scope** (separate future sub-projects, per the
in-game-player-experience decomposition):

- Player chat/messaging (the write-only `playerMessages` collection has
  no reader anywhere yet).
- Kill-photo submission (the `photos` collection and its upload UI don't
  exist yet; `storage.rules` scoping is deferred until that UI exists to
  scope against).
- A real leave-game flow (today's Leave button only clears local session,
  not room membership — called out as a separate feature in the prior
  join-flow spec).
- Player-side mission/revival-mission completion or submission UI.
