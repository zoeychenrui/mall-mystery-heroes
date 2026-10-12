# Simplified GM Lobby Design

**Date:** 2026-08-14
**Status:** Approved

## Problem

`src/pages/Lobby.js` (the GM's pre-game lobby, routed at `/rooms/:roomID/lobby`)
still has a manual "Add Player" form (`PlayerAddition.js`). That made sense
before players could join themselves, but this repo now has a fully-built,
live, self-service join flow (`src/pages/JoinGame.js` at `/join`, backed by
the `joinRoom` Cloud Function) that writes the player doc server-side with
proper `uid`/`joinedUids` tracking — something the GM's manual-add path
(`dbCalls.addPlayerForRoom`) never did. Manual add is now redundant, and its
presence invites a GM to use the weaker path by habit.

The user also wants the page visually simplified: a green banner with the
mall-bag logo at the top, the game ID centered, and the list of joined
players below — replacing the current 40/70 split-screen layout.

## Decisions

- **Remove "Add Player" entirely.** `PlayerAddition.js` becomes fully dead
  code (its only call site was `Lobby.js`) and is deleted from the
  codebase, matching this repo's established dead-code-cleanup convention
  (see `docs/improvements.md` item 14).
- **Keep "Remove Player."** The user confirmed the GM should still be able
  to remove a joined player (e.g. a typo'd name, someone who shouldn't be
  there). `PlayerRemove.js` is unchanged and stays on the page.
- **Single-column layout, not split-screen.** The green banner
  (`bg="#66bf78"`, `mall-logo-black-green.png`) becomes a full-width strip
  across the top instead of a 40%-width side panel. Below it, one centered
  column: game ID, player count, player list, Start Game button.
- **Player list becomes a single column**, not the current two-column
  split (`PlayerList.js` was built for the old wide black side panel; a
  simpler centered page reads better as one list).
- **Everything structurally required stays, unchanged in behavior:** the
  Start Game trigger (`TargetGenerator`'s `handleLobbyRoom`, still gated on
  2+ players, still navigates to `GameMasterView`), the live `onSnapshot`
  player subscription, and Log Out (moves to a small top-right corner
  button, consistent with its current placement).

## Layout

Top to bottom, single centered column, full page height:

1. **Green banner strip** (`bg="#66bf78"`, full width, fixed height):
   mall-bag logo (`mall-logo-black-green.png`) centered. Log Out button
   pinned to the top-right corner of this strip (was already top-right in
   the old black panel — same corner, new background).
2. **Game ID**, centered, large heading: `Game ID: {roomID}` (renamed from
   "Lobby ID" — "Game ID" matches the label players see on `JoinGame.js`'s
   input, so the same term is used on both sides of the join flow).
3. **Player count + list**, centered: "Players ({arrayOfPlayers.length})"
   heading, then the names in a single centered column (via
   `PlayerList.js`, simplified to one `OrderedList` instead of two).
4. **Remove Player** (`PlayerRemove.js`, unchanged), shown only when
   `arrayOfPlayers.length > 0`, same as today.
5. **Start Game** (`TargetGenerator`, unchanged), same gating and
   navigation as today.

## Components

### `src/pages/Lobby.js` (rewritten)

Keeps its existing `onSnapshot(fetchAllPlayersQueryForRoom(roomID), ...)`
subscription, `handleLobbyRoom`, and `logout` logic unchanged. The render
output changes from the two-`Flex` split to one `Flex direction="column"`
page with the five sections above. Drops the `PlayerAddition` import and
its "Add Player" heading.

### `src/components/lobby_components/PlayerList.js` (simplified)

Drops the `firstHalf`/`secondHalf` split. Renders `arrayOfPlayers` as one
`OrderedList` in a single centered column.

### `src/components/lobby_components/PlayerAddition.js` (deleted)

No remaining call sites after `Lobby.js` stops rendering it. Deleted
outright, along with its test file
`src/components/lobby_components/PlayerAddition.test.jsx` (if one exists —
confirmed at plan-writing time).

### `src/components/firebase_calls/dbCalls.js` — `addPlayerForRoom`

**Not removed.** Out of scope: `dbCalls.js` functions aren't tied
one-to-one to UI call sites the way component files are, and removing a
data-layer function is a separate, larger decision (it may still be
useful, e.g. for a future admin tool or test fixture) than removing the
one UI form that called it. This spec only removes the UI.

## Testing

- `Lobby.test.jsx` (existing, reworked): remove assertions/mocks tied to
  `PlayerAddition` (no more "Add Player" input/heading expected); keep
  coverage for the live player subscription, Start Game gating, Log Out,
  and Remove Player being present once players exist. Add coverage for the
  new single-column player list rendering and the "Game ID:" label text.
- `PlayerList.test.jsx` (existing, reworked): update expectations for a
  single `OrderedList` instead of two.
- `PlayerAddition.js`/`PlayerAddition.test.jsx`: deleted, not migrated.

## Error handling

No change — the existing `createAlert` error paths (subscription failure,
not-enough-players on Start Game, remove-player failure) are untouched.

## Out of scope

- `dbCalls.addPlayerForRoom` itself (data layer, not this page's UI).
- Any visual styling beyond what's described above — the user is sending
  UI feedback separately after this ships, so this spec intentionally
  keeps styling close to the existing look (same green, same logo, same
  Chakra components) rather than introducing new visual design.
- `JoinGame.js` / the self-service join flow — already built, unchanged.
- `PlayerRemove.js` — unchanged, kept as-is.
