# Live Location Visibility Design

## Problem

Phases 1-3 of Game Boundaries gave the moderator a derived status per player
(inside/near/outside/unavailable) and gave each player their own read-only
map — but deliberately, by design, never a live location of anyone. The
spec that shipped states this twice: "The moderator sees status, not a live
location trail," and "No latitude/longitude or movement history is stored."

The GM now wants two things that reverse those decisions:

1. **The GM should see every player's actual live location**, not just a
   status badge, at all times — inside or outside the boundary.
2. **When a player is confirmed outside the boundary, their location should
   become visible to every other player too** — a "manhunt reveal," live and
   continuously updating, lasting exactly as long as they stay outside. The
   player being exposed gets a personal countdown warning first, giving them
   a chance to get back inside before anyone (including the GM, who already
   sees everyone — this part only changes what _other players_ see) can see
   where they are.

## Decisions

These were settled during brainstorming, in order, and are binding for the
implementation plan:

- **Exposure is a live, continuously-updating dot**, not a one-time alert or
  a snapshot. It lasts exactly as long as the player's status reads
  confirmed-outside.
- **The countdown warning is reused from an existing mechanic, not a new
  one.** `GAME_BOUNDARY_CONFIG.confirmMinSpanMs` (20 seconds) is the window
  the server already waits before confirming "outside" at all — built
  originally so GPS noise near the edge doesn't flicker the GM's status
  display. The exposure countdown _is_ that same window, visualized. No new
  timer, no new constant.
- **Only the player who is about to be exposed sees the countdown.** Nobody
  else gets advance notice; other players (and the GM) simply see the dot
  appear once the window completes and the status flips to confirmed
  `outside`.
- **Exposure ends immediately on return.** The instant status moves off
  confirmed-outside, the dot disappears from every other player's map. No
  "last seen" lingering marker.
- **The GM's always-on view and the outside-exposure view share one
  mechanism** — see Architecture. There is no separate feed for the GM.
- **GM map markers show the player's name on hover.** This is GM-only for
  now; the "who's near me" markers an ordinary player sees for exposed
  players do not get a hover label in this pass (nothing in the brainstorm
  asked for it, and YAGNI argues against adding it speculatively).

## The core trade-off — read this before approving

Today, `reportPlayerLocation` evaluates a player's coordinates and
deliberately never stores them: `lat`/`lng` arrive in the callable's
payload, get evaluated against the boundary polygon, and are discarded.
Nothing in Firestore has ever held a raw coordinate for this feature.

For the GM to see _every_ player's location at _all times_ — not just while
they're outside — that can no longer hold. The server must now write
`lat`/`lng` to Firestore on every report, for every player, continuously,
for the entire time they're in the game. **Visibility is controlled by who
can _read_ that field, not by whether it exists.** The GM could already read
every player's status document in full (see Architecture); this change adds
coordinates to what's in it. A player's document also becomes readable by
_other_ players, but only for the span of time their own status reads
confirmed-outside.

This is the one real, structural reversal of the original design's privacy
stance. It is not reducible to a smaller change — the "GM always sees
everyone" requirement is what forces continuous storage; the exposure
feature then reuses that same storage rather than inventing a second one.

## Architecture

One schema change serves both features, because of something already true
of this app's Firestore rules: the host's read grant on
`boundaryStatuses/{playerId}` has no restriction at all (`allow read: if
isHostOfExistingRoom(roomId) || ...`), while a player's own grant is
restricted to their own document ID. Firestore evaluates security rules
**per document**, including for `list`/query operations — a query only
returns the documents that individually satisfy the rule. That means:

- Adding `lat`/`lng` to the existing `boundaryStatuses` document, with no
  rule change at all, already gives the GM a live location for every player
  — the GM's existing blanket read grant now simply includes coordinates.
- Adding one more rule clause — a player may also read another player's
  status document when `resource.data.status == 'outside'` — makes a plain
  query like `where('status', '==', 'outside')` return exactly the
  currently-exposed players, to any signed-in player in the room. No
  separate collection, no duplicated writes, no cross-document `get()` calls
  in the rule.

No other schema shape was seriously considered:

- A separate "live locations" collection, written only while a player is
  outside, would still need the _same_ always-on write for the GM's benefit
  — it would just duplicate data instead of reusing one document.
- Storing position on the existing `players/{playerId}` document was
  rejected outright: that document's read rule already grants _any_ player
  in the room read access to _any other_ player's document, with no
  status-gating possible without weakening a rule used for several other
  unrelated features. It would expose everyone's location to everyone,
  always — the opposite of what was asked for.

## Data model changes

`rooms/{roomID}/boundaryStatuses/{playerId}` (docs/data-model.md) gains two
fields and one widened read rule. Everything else about this document is
unchanged.

| Field | Type             | Notes                                                                                                                                                                                                                                                                                                                                |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lat` | `number \| null` | The reporting device's last-written latitude. Written on every fix report. On an error report (no fresh coordinates available), the previous value is carried forward rather than cleared, so a dot does not simply vanish — staleness is signaled by `lastUsableReceivedAt`, already on this document, not by nulling the position. |
| `lng` | `number \| null` | Same as `lat`.                                                                                                                                                                                                                                                                                                                       |

`accuracyMeters` (already present on this document) continues to be written
the same way and is reused as-is for the GM/other-player map markers'
accuracy circle, exactly like `GameMap.js`'s existing own-position circle.

**Updated privacy statement for this document** (replaces "No coordinates
are stored..."): _Coordinates are stored on this document and read access
is role- and status-gated: the host can always read every player's
position; a player can always read their own; any other player can read a
given player's position only while that player's status reads
`'outside'`._

`firestore.rules`, `boundaryStatuses` match block — current:

```
allow read: if isHostOfExistingRoom(roomId) ||
  (isSignedIn() && isOwnBoundaryStatus(roomId, playerId));
```

New:

```
allow read: if isHostOfExistingRoom(roomId) ||
  (isSignedIn() && isOwnBoundaryStatus(roomId, playerId)) ||
  (isSignedIn() && isPlayerOfRoom(roomId) && resource.data.status == 'outside');
```

`isPlayerOfRoom` already exists in `firestore.rules` and is used elsewhere
(`isHostOrPlayerOfRoom`); this reuses it rather than introducing a new
helper.

## Components

- **`functions/callableFunctions/reportPlayerLocation.js`** — the
  `transaction.set(statusRef, {...})` write in the fix-report path gains
  `lat`, `lng`. The error-report path (which has no fresh coordinates)
  carries forward `prev.lat`/`prev.lng` unchanged rather than writing
  `null`, consistent with "the last known position stays visible, marked
  stale by freshness rather than erased." The doc comment's claim that
  coordinates are "never stored" is removed and replaced with a pointer to
  this spec.
- **`firestore.rules`** — the one widened clause above. New rules tests in
  the existing `test:rules` suite: a non-host, non-self player can read
  another player's status once it reads `outside`, and is denied while it
  reads anything else; a host can always read, regardless of status.
- **`src/components/map_components/GameMap.js`** — generalizes the existing
  single `ownPosition` marker into a list of markers, each with an optional
  label shown on hover (Mapbox GL JS markers support this natively via a
  wrapping element's `title` or a small popup-on-hover; no new map library
  dependency). The existing own-position marker becomes a one-item case of
  the same rendering path, not a separate code path.
- **New GM-facing live map.** A new button in `GameMasterView.js` (or
  wherever `GameBoundaryButton.js` is rendered — read that file fresh at
  plan time) opens a map showing every player's current position as a
  labeled-on-hover marker. Subscribes to the full `boundaryStatuses`
  subcollection for the room (a plain `onSnapshot` over the collection, no
  query filter — the host's rule already grants this). A freshness check
  per player (reusing `deriveFreshStatus`'s staleness logic, same constant)
  decides whether to render a marker as live or grey out/hide it.
- **`src/pages/PlayerGame.js`** — a new live subscription,
  `where('status', '==', 'outside')` over the room's `boundaryStatuses`,
  excluding the player's own document, feeding `PlayerMapModal` a list of
  other currently-exposed players' positions (same freshness gating as the
  GM view, shared helper). The existing countdown mechanics: while the
  player's own derived status is `'near'` and `outsideSince` is set (both
  already present on their own status document today), render a popup
  showing `confirmMinSpanMs - (nowMs - outsideSince)`, ticking down on the
  same local 1-second ticker `PlayerGame.js` already runs. Once status flips
  to confirmed `outside`, the popup's copy changes to reflect that exposure
  is now live, rather than disappearing.
- **Player-facing copy.** The pre-permission explanation ("Other players
  cannot see your location") and any other copy stating this unconditionally
  needs updating to reflect the exception — exact wording is an
  implementation-time detail, not a spec-level decision, but the plan must
  not ship the old, now-false sentence unchanged.
- **`docs/data-model.md`, `docs/architecture.md`, `docs/game-flows.md`** —
  updated to match, following each file's existing section style (the same
  files Phases 1-3 already extended for this feature).

## Data flow

1. A player's device reports a fix (or error) at the existing 5-15s cadence
   — unchanged.
2. The server evaluates it, same state machine as today, and now also
   writes `lat`/`lng` (or carries them forward on an error report) onto
   that player's `boundaryStatuses` document, every time, regardless of
   status.
3. The GM's live map, subscribed to the whole subcollection, re-renders
   that player's marker on every snapshot — always, by virtue of the
   existing host-read grant.
4. For every _other_ player: nothing changes while status is `inside` or
   `near` — the widened rule denies them read access, so their `outside`-
   filtered query simply never returns this player's document.
5. The moment status is confirmed `outside` (the existing 20s/30s
   confirmation logic, unchanged), the widened rule starts matching. Every
   other player's live `where('status','==','outside')` query now includes
   this player's document, coordinates included, and their map shows the
   new marker on its next snapshot.
6. The instant status moves off confirmed-outside (back to `inside`, or to
   `unavailable`), the rule stops matching and Firestore's own query
   semantics remove that document from every other player's live query
   result set automatically — no explicit "clear" step is needed anywhere.

## Error handling

- A boundary revision change (GM republishes) resets everyone's
  confirmation state the same way it does today — the exposure mechanic
  rides entirely on the existing status/confirmation state machine, so a
  revision change correctly un-exposes everyone exactly as it already
  un-confirms "outside" today. No separate handling needed.
- A dropped connection for a currently-exposed player leaves their last
  written position in place; their marker on other players' maps follows
  the existing staleness convention (`lastUsableReceivedAt`-based freshness
  check) rather than vanishing or looking falsely live.
- The GM's always-on view has no "permission" failure mode to handle beyond
  what already exists for the room subscription itself — the host's read
  grant is unconditional.

## Testing

- `src/game/gameBoundary.test.js` — no new pure logic is introduced
  (the countdown is `confirmMinSpanMs` minus an elapsed time, already
  exercised indirectly by existing `nextBoundaryState` tests); confirm no
  existing test assumed coordinates are never present on a status object
  passed through this module.
- `firestore.test.js`-equivalent rules tests (this repo's `npm run
test:rules` suite) — new cases: a non-host, non-self player denied while
  another player's status is `inside`/`near`/`unavailable`, allowed once
  it's `outside`; a host allowed regardless; a player always allowed to
  read their own regardless of status (unchanged, but worth a regression
  test given the rule is being edited).
- `functions/callableFunctions/reportPlayerLocation.integration.test.js`
  (or wherever this function's existing emulator tests live — read fresh at
  plan time) — a fix report writes `lat`/`lng`; a subsequent error report
  carries them forward unchanged rather than nulling them.
- `GameMap.test.jsx` — the generalized multi-marker rendering, with and
  without hover labels, mocked the same way the existing single
  `ownPosition` tests are.
- New component tests for the GM live map view and for
  `PlayerMapModal`/`PlayerGame`'s "other exposed players" rendering and the
  countdown popup — same mocked-`GameMap` pattern already used throughout
  `map_components/` and `PlayerGame.test.jsx`.

## Explicitly out of scope

- A separate countdown duration distinct from the existing 20s confirmation
  window — rejected during brainstorming in favor of reusing the existing
  mechanic exactly.
- A lingering "last seen outside" marker after a player returns inside —
  rejected; exposure ends immediately.
- Hover-to-reveal names on markers a _player_ (not the GM) sees for other
  exposed players — not requested; only the GM's view gets this.
- Any moderator roster-badge work (`PlayersList.js`) remains the
  still-separate, still-deferred plan noted by both prior phases.
