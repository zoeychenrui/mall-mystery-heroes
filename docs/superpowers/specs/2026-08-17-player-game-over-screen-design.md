# Player Game-Over Screen Design

**Date:** 2026-08-17
**Status:** Approved

## Problem

A multi-agent audit of the live game flow this session found that when the
GM manually ends a game (`Endgamebutton.js` → `dbCalls.endGame`, which
writes `isGameActive: false` and `endedAt: serverTimestamp()` on the room
doc), nothing tells players it happened. `src/pages/PlayerGame.js` has
exactly three UI states today — waiting for the host, has a target,
eliminated — and no fourth state for game-end. `isGameActive` is written
by `endGame` but never read anywhere in `PlayerGame.js`; the only place it
is read client-side at all is `ChatInput.js`, for the GM's own command bar.
A player whose game has ended just keeps staring at whatever they last saw,
indefinitely.

Win/end-game detection stays entirely moderator-driven (explicit decision
this session, out of scope here) — this design covers only what a player's
screen shows once the GM has manually ended the game.

## Decisions

- **No navigation.** "Return to the starting area" is a physical, in-person
  instruction for this live-action game, not a UI concept — the screen
  stays on the same route (`/rooms/:roomID/waiting`) and just tells players
  to go meet up there. No re-routing to Homepage, no re-signing-in, works
  even if a player's device auto-locked and they're just now looking at it.
- **Ranking is by score**, reusing the existing, already-tested
  `buildLeaderboardStandings` (`src/game/leaderboard.js`) — sorts everyone
  descending by score, includes eliminated players (a player can have
  scored points before eventually dying).
- **GM console is untouched.** No banner, no gating of photo
  moderation/reset-targets after end-game — the GM already knows the game
  ended, they clicked the button. That's a separate, not-yet-decided
  finding from the same audit.
- **"View Leaderboard" is a modal**, matching this codebase's existing
  modal convention (`KillPhotoModal.js`, `TaskCreationModal.js`,
  `TaskListModal.js`).
- **Chat and the kill-photo composer are hidden once the game has ended** —
  nothing left to report or submit. `MessageFeed`/`MessageComposer` stop
  rendering entirely on this screen.

## Components

### `src/pages/PlayerGame.js` (modified)

Two additions to the existing room-doc subscription's snapshot handler:
read `isGameActive` (default `true`, matching how every room is created)
into a new `isGameActive` state, alongside the existing `gameStarted` read.

A second new subscription, gated on the game having ended (so it costs
nothing during normal gameplay):

```jsx
useEffect(() => {
    if (!roomID || isGameActive) return undefined;
    const playersQuery = fetchAllPlayersQueryForRoom(roomID);
    const unsubscribe = onSnapshot(
        playersQuery,
        (snapshot) => {
            setPlayers(snapshot.docs.map((doc) => doc.data()));
        },
        handleSubscriptionError
    );
    return () => unsubscribe();
}, [roomID, isGameActive, handleSubscriptionError]);
```

(`fetchAllPlayersQueryForRoom` already exists in `dbCalls.js`, used the
same way by `GameMasterView.js` for its own live roster. `firestore.rules`
already grants any `isHostOrPlayerOfRoom` caller `read` on the `players`
subcollection — confirmed by reading the rules file directly — so no rules
change is needed; a player has always been able to list the full roster,
this is simply the first client code to do it.)

`standings` is derived each render: `buildLeaderboardStandings(players)`.
Render precedence: once `!isGameActive`, render `<GameOverScreen
standings={standings} />` in place of the existing three states AND in
place of `MessageFeed`/`MessageComposer` — nothing else in the current
render body changes.

### `src/components/game_end_components/GameOverScreen.js` (new)

Presentational, one prop: `standings` (the array `buildLeaderboardStandings`
returns — `{name, score, isAlive}[]`, already sorted). Renders:

- A heading ("Game Over") and the physical instruction text ("Please head
  back to the starting area").
- The top 3 (`standings.slice(0, 3)`), name + score each.
- A "View Leaderboard" button, opening `LeaderboardModal` with the full
  `standings` array — owns its own `isOpen` state locally (same pattern
  `MessageComposer.js` uses for `KillPhotoModal`'s open state), so
  `PlayerGame.js` doesn't need to know the modal exists.

### `src/components/game_end_components/LeaderboardModal.js` (new)

Presentational, props: `{isOpen, onClose, standings}`. A Chakra `Modal`
listing every entry in `standings`, in order, name + score + an
alive/eliminated indicator (mirroring how `PlayersList.js` already
visually distinguishes alive/dead, for consistency — read that component
before implementing to match its convention rather than inventing a new
one).

## Data flow

`endGame` (unchanged) → room doc's `isGameActive` flips to `false` →
`PlayerGame.js`'s existing `onSnapshot` fires → `isGameActive` state
updates → the gated roster subscription activates for the first time →
`players` populates → `standings` derives → `GameOverScreen` renders with
real data. Until the roster snapshot arrives (one round-trip), `standings`
is `[]` and `GameOverScreen` renders its top-3/leaderboard areas empty —
acceptable, matching how `playerData?.targets` already renders empty
before its own snapshot arrives elsewhere in this same file.

## Error handling

The new roster subscription reuses `PlayerGame.js`'s existing
`handleSubscriptionError` — a permission error or the room disappearing is
already handled uniformly by every other subscription in this file (clears
the session, bounces to `/`); no new error path needed.

## Testing

- `src/game/leaderboard.js` needs no new tests — unchanged, already
  covered.
- `src/pages/PlayerGame.test.jsx`: a new case seeding `isGameActive: false`
  on the room doc and asserting `GameOverScreen` renders instead of the
  three existing states, and that `MessageFeed`/`MessageComposer` are
  absent.
- `GameOverScreen.test.jsx` (new): renders top 3 from a `standings` prop,
  opens `LeaderboardModal` on button click.
- `LeaderboardModal.test.jsx` (new): renders every entry in `standings`,
  in order, with alive/eliminated distinguished; closes via its close
  control.
- One new `test/firestore.rules.test.js` case: a signed-in player (not the
  host) can `getDocs` the full `players` collection for a room they belong
  to — this permission already exists in `firestore.rules` today but has
  no test pinning it, and this plan's new client code is the first thing
  to actually depend on it.

## Out of scope

- Any GM-facing change (banner, gating post-end-game actions) — a separate,
  not-yet-decided audit finding.
- Automatic win/last-player-standing detection — explicitly staying
  moderator-driven per this session's earlier decision.
- Freezing/locking game data once ended (photo moderation, reset-targets
  continuing to work after end-game) — same separate finding, untouched
  here.
