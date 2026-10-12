# Game Boundaries Design

**Date:** 2026-09-30
**Status:** Approved

## Problem

The moderator currently has no way to define the physical play area in
the app. Players need a shared map showing where they can play, and the
moderator needs to know when someone leaves that area.

The moderator should be able to open a satellite map of the nearby area,
draw a boundary freehand or with a rectangle, circle, or oval, and publish
it to everyone in the room. Players must enable location to verify that
they are within the boundary. Leaving the area produces a visible flag
for the moderator and a warning for the player.

## Decisions

- **One published play area per room for the first version.** A moderator
  can replace or disable it. Multiple disconnected areas and exclusion
  zones are deferred. Existing rooms without a boundary work as today.
- **All requested drawing tools are included.** Freehand, rectangle,
  circle, and oval are supported on desktop and touch devices. Oval is
  not conditional on whether the map provider supplies an ellipse tool.
- **Publishing is explicit.** Drawing and editing happen in local draft
  state. Players continue seeing the published version until the moderator
  selects Publish Boundary or Publish Changes. Cancel discards edits.
- **Everyone receives the same boundary.** The room's live subscription
  distributes the published shape to current players, late joiners, and
  reconnecting players. No separate send-to-each-player operation.
- **Location is required for verified participation.** Without permission
  and a usable fix, the player sees a persistent Enable Location prompt
  and the moderator sees an unverified status. The map and chat remain
  accessible. This feature flags exceptions; it does not automatically
  kick players, deduct points, block photo submissions, or eliminate them.
- **Monitoring covers all current players**, including eliminated players
  who remain in the room. Collection starts after consent when a boundary
  is published, including in the lobby, and stops when the boundary is
  disabled, the game ends, or the player leaves or is removed.
- **The moderator sees status, not a live location trail.** Players see
  their own marker and the play area, never another player's marker.
  Coordinates are submitted for server evaluation but are not persisted.
- **This is a browser feature with explicit freshness limits.** It must
  not promise continuous monitoring while the phone is locked or the app
  is backgrounded. Missing updates become Location unavailable. Reliable
  background monitoring would require a separate mobile implementation.
- **The server decides the shared status.** A callable derives the player
  identity from Firebase Auth and evaluates the submitted location against
  the current boundary. It does not accept a client-supplied inside/outside
  result. Device coordinates themselves remain unverified; this is not
  protection against GPS spoofing.

These are proposed implementation defaults for this draft, not previously
approved product decisions.

## Moderator experience

Add a Game Boundary button to `Lobby.js` and `GameMasterView.js`. It opens
a large map modal, full-screen on small displays, in satellite mode.

For an existing boundary, fit the map to that shape. Otherwise offer Use
My Location and an address/place search. The moderator can also pan and
zoom manually; denying their own location permission does not prevent
drawing. Provide a standard-map toggle and preserve provider attribution.

The toolbar offers Move Map, Freehand, Rectangle, Circle, and Oval.
Drawing mode captures the drawing gesture instead of panning the map;
Move Map restores normal navigation. Freehand closes on release and
simplifies the stroke into an editable polygon. Rectangle uses opposite
corners; circle uses a center and radius; oval uses a center and separate
horizontal/vertical radii. All shapes can be moved, resized, or redrawn;
freehand vertices can also be adjusted. Include Undo and Clear Draft.

Show the boundary with a strong outline and translucent fill so streets
and landmarks remain readable. Publish is disabled for empty, degenerate,
or self-intersecting geometry. On success, close the editor and show
Boundary published. A failed save retains the draft for retry.

Editing an existing shape does not affect players until publication.
Disable Boundary removes active enforcement and the player warning; it
does not silently publish a cleared draft. Editing controls are unavailable
after the game ends.

The moderator roster gains a boundary-status badge and last-update time
for each player. Outside players are visually prominent; Near boundary
and Location unavailable have distinct text and styling. Show counts of
outside and unverified players near the Game Boundary button. A new
confirmed outside episode produces one moderator toast; subsequent fixes
in that episode do not produce repeated toasts. Loading the dashboard
shows existing flags without replaying old toasts.

## Player experience

When a boundary is first published, show a Game area is ready notice and
a View Game Map button in the player page. The map opens in satellite
mode, fitted to the boundary, with a Recenter on Me control once a fix is
available. Closing the map does not stop location updates.

Before requesting permission, explain:

> Turn on location so we can check that you are inside the game area.
> The moderator sees your boundary status. Other players cannot see your
> location. Keep the game open for location updates.

Enable Location initiates the browser permission request. If denied,
explain how to enable it in browser/device settings and provide Retry.
Do not continually reopen the permission prompt. A missing geolocation
API, timeout, or disabled device service gets an actionable unavailable
message rather than an outside warning.

Display the boundary status on the player page as well as inside the map:

| Status               | Player-facing behavior                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Inside               | In game area.                                                                                                     |
| Near boundary        | You are near the edge of the game area; check the map.                                                            |
| Outside              | Persistent warning: You are outside the game area. Please return inside.                                          |
| Location unavailable | Explain the reason, offer Enable Location/Retry where applicable, and show the last successful check time if any. |
| Boundary disabled    | Hide enforcement status and stop collection.                                                                      |

The marker includes an accuracy circle. If the current reading expires,
hide the current-position marker or clearly label it as a last known
position; never depict a stale fix as live. Boundary changes trigger a
Game area updated notice and replace the overlay immediately, with a new
location check. Receiving a notice does not require acknowledging it to
activate the new version.

## Boundary detection

Use one canonical, closed polygon for both rendering and evaluation.
Rectangles and sampled circles/ovals are converted to that same shape.
Preserve the original drawing parameters separately for editing. Measure
distance in meters using geographic calculations, not screen pixels or
unscaled latitude/longitude differences.

Proposed defaults, kept as shared constants for the first release:

- Edge tolerance: 15 meters, expanded to the reported location accuracy
  when that is greater.
- Maximum usable accuracy: 50 meters. Worse readings are unavailable
  with reason Poor accuracy, rather than given an arbitrarily large buffer.
- Outside confirmation: at least two usable, outside readings spanning
  20 seconds, with no interval between accepted readings over 30 seconds.
- Reporting cadence: send a newly acquired fix at most once every five
  seconds, aiming for a fresh check at least every 15 seconds while the
  page is active. Never resend an old fix as a fresh heartbeat.
- Freshness: after 30 seconds without a usable fix, display Location
  unavailable even if the stored status was Inside or Outside.

A point farther inside than its effective tolerance is Inside. A point
within that tolerance on either side of the edge is Near boundary. A
point farther outside starts or continues the outside-confirmation period;
until confirmed, display Near boundary with Return toward the game area.
Only a confirming fresh reading can change that state to Outside; a timer
alone cannot establish that the player stayed outside.

Any inside, near-edge, unusable, or interrupted sequence resets pending
outside confirmation. Once Outside is confirmed, keep that flag through
near-edge readings until a usable reading is clearly Inside. Unavailable
status overrides the current badge if updates fail; any previous confirmed
outside event remains visible as history, not as a current location claim.
After an unavailable interval, require a fresh confirmation sequence.

Every publication or disable increments the boundary revision. Status from
another revision is unavailable until rechecked; no player is flagged
outside solely because a moderator moved the boundary. Reset the pending
confirmation period and use fresh readings for the new revision.

The exact defaults need field testing on phones at a real play site,
especially indoors. Small play areas may not be distinguishable at the
available GPS accuracy; expose that uncertainty instead of claiming
precise enforcement.

## Data model changes

### `rooms/{roomID}`

Add `gameBoundary`, absent on existing rooms. When set, it contains:

| Field             | Type                                              | Purpose                                                                               |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `enabled`         | `boolean`                                         | Whether this boundary currently applies.                                              |
| `revision`        | `integer`                                         | Increases on every publish or disable.                                                |
| `shapeType`       | `'freehand' \| 'rectangle' \| 'circle' \| 'oval'` | Editor tool that produced the shape.                                                  |
| `vertices`        | `Array<{lat, lng}>`                               | Canonical closed polygon; object entries avoid nested coordinate arrays in Firestore. |
| `shapeParameters` | `object \| null`                                  | Center/radii or corners needed to reopen the matching editor.                         |
| `updatedAt`       | `Timestamp`                                       | Server publication time.                                                              |

No separate persisted draft or archived geometry collection in this version.
Validate finite coordinates, valid geographic ranges, nonzero area, no
self-intersections, and a maximum of 500 vertices including closure.
Reject shapes crossing the antimeridian or spanning over 10 km; this
feature is for a nearby game area. Surface validation errors before save
and enforce the same restrictions server-side.

### `rooms/{roomID}/boundaryStatuses/{playerId}`

Use the existing normalized player document ID. Keep this separate from
the broadly readable player roster. Store `boundaryRevision`, `uid`,
`status`, `reason`, `accuracyMeters`, `lastSampleAt`, `receivedAt`,
`lastUsableReceivedAt`, `outsideSince`, `lastOutsideSampleAt`,
`outsideConfirmedAt`, and `statusChangedAt`. Times used for confirmation
come from the server; sample time is used to reject stale or reordered
device reports. No latitude/longitude or movement history is stored.

Host may read/list all statuses in their room. A player may get only their
own status, with authorization checked against their current player
document's uid. Players cannot list the collection or write it directly.
Reconnecting under a new uid must immediately revoke the old uid's access;
do not authorize solely from a copied uid in a stale status document.

On a confirmed outside transition, write one moderator-only event to
`rooms/{roomID}/boundaryEvents/{autoId}` with player ID/name, boundary
revision, server timestamp, and type `outside` or `returnedInside`.
The event and status transition are committed together. These events have
no coordinates and are not broadcast to the public chat feed.

Statuses are removed with their players. Statuses and events are covered
by the existing ended-room recursive cleanup; do not add a separate
location-retention system. No location payloads go into application logs.

## Components

- `src/pages/Lobby.js`, `src/pages/GameMasterView.js` — boundary editor
  entry point and published-boundary state; moderator status subscription
  and transition notifications in the game view.
- `src/components/map_components/GameMap.js` (new) — shared map renderer,
  satellite/standard layers, boundary overlay, own-position marker, and
  provider attribution. Map provider code stays behind this component.
- `src/components/map_components/BoundaryEditorModal.js` (new) — local
  draft, drawing tools, geometry editing, publish/disable actions.
- `src/components/map_components/PlayerMapModal.js` (new) — read-only
  boundary map with own-position and status display.
- `src/pages/PlayerGame.js` — consume `gameBoundary` through its existing
  room subscription, mount tracking independently of the map modal,
  render permission/status UI, and clean up on session or room changes.
- `src/components/player_listing/PlayersList.js` and the lobby roster —
  receive moderator-only statuses separately from player documents and
  display the badges, timestamps, and missing-update state.
- `src/hooks/useBoundaryLocation.js` (new) — permission request,
  `watchPosition`, fresh-fix acquisition, throttling, error reporting,
  reconnect handling, and `clearWatch`/timer cleanup. Only one watch per
  mounted player session. Ignore results belonging to a previous room,
  identity, or revision.
- `src/game/gameBoundary.js` (new) — pure geometry validation,
  classification, confirmation-state transitions, and freshness
  derivation with an injected time value. Share with Cloud Functions
  through `functions/scripts/sync-shared-game-logic.js`, following the
  existing vendored-game-logic pattern.
- `src/components/firebase_calls/dbCalls.js` — references/queries for
  boundary statuses and events. Callable wrappers follow the existing
  `src/components/submitChatMessage.js` pattern.
- `functions/callableFunctions/gameBoundary.js` (new) — host-authorized
  `publishGameBoundary` and `disableGameBoundary`, using an expected
  revision to reject conflicting moderator edits. Register in
  `functions/index.js`.
- `functions/callableFunctions/reportPlayerLocation.js` (new) — resolves
  exactly one current player from `context.auth.uid`; checks room,
  boundary, revision, location shape, and rate limit; evaluates and writes
  status/events atomically. Accepts a location-error report without
  coordinates to mark known permission/availability failures promptly.
- `firestore.rules` and player-removal/reconnect paths — enforce private
  status/event access, remove deleted players' statuses, reset status on
  identity transfer, and prevent ordinary room writes from changing
  `gameBoundary` outside the revision-checked callable path.

## Data flow

Moderator draws locally → Publish calls the host-authorized function →
validated geometry and a new revision are saved to the room → every
player's room listener receives the map → player enables location →
fresh fixes go to the identity-checked callable → the server evaluates
the current boundary and commits status plus any transition event →
player and moderator listeners update their respective displays.

The location callable rejects ended games, disabled boundaries, obsolete
revisions, invalid coordinates, and stale/out-of-order sample timestamps.
Proposed timestamp allowance: no more than 30 seconds old or 5 seconds in
the future. Device clock errors produce unavailable status and guidance
to check the device clock. Rate-limit each player to 20 reports per minute;
all accepted reports include server receipt time. Transaction retries or
duplicate samples must not duplicate transition events.

Freshness is derived on both displays from the server timestamps using
a local timer, even when Firestore emits no new snapshot. Missing data,
wrong revision, or wrong current uid means unavailable. Keep independent
location errors from invoking `PlayerGame.js`'s session-expiry handler.

## Error handling

- Map service or satellite imagery fails: show Retry and a standard-map
  fallback where available. An existing boundary still evaluates without
  map tiles; block new publication if the moderator cannot review it.
- Publishing fails or another moderator tab publishes first: retain the
  draft, show the conflict, and require reloading/reviewing the current
  boundary before retrying. Never overwrite it silently.
- Connection drops: keep the last published boundary with an offline
  indicator, expire verified status, and acquire a fresh fix on reconnect.
  Do not queue a backlog of old locations for later upload.
- Browser is hidden or phone locks: updates may be delayed or suspended.
  Do not treat permission granted as proof that tracking is working.
  Reacquire a fresh fix when the page becomes visible.
- Permission is revoked, a player leaves, the game ends, or the room is
  deleted: stop the watch and timers; server checks reject subsequent
  in-flight reports. Disable also invalidates all previous status displays.

Geolocation requires a secure context and explicit user permission; see
[MDN's watchPosition reference](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).
Browsers throttle work in hidden tabs; see
[MDN's Page Visibility documentation](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
These constraints are why the design exposes freshness rather than
promising uninterrupted background tracking.

## Testing

- Pure unit tests: each drawing shape's normalized geometry; invalid and
  self-intersecting shapes; point on an edge/vertex; meter-based tolerance;
  poor accuracy; outside confirmation and interruption; return inside;
  stale readings; revision changes; deterministic time handling.
- UI tests with map/geolocation adapters mocked: all drawing tools,
  publish/cancel/disable, preserving drafts on failure, permission denial
  and retry, late-joining players receiving the map, status warnings,
  freshness expiry without a snapshot, and watch cleanup. Closing the
  player map must leave tracking active.
- Emulator tests: host-only publication; revision conflicts; caller
  identity resolution; rejected spoofed player identity; invalid/stale
  reports; rate limiting; concurrent publication/report transactions;
  duplicate reports producing one event; end/disable/removal/reconnect
  races; one player's report cannot affect another player's status.
- Rules tests: player can read their own status only; host can list room
  statuses/events; another room cannot read them; old uid loses access
  after reconnect; direct status/event writes and boundary-field edits
  are rejected while existing authorized room operations still work.
- Device checks on iOS Safari and Android Chrome: satellite drawing by
  touch, walking across the boundary, indoor/poor accuracy, permission
  revocation, switching apps, locking the screen, and reconnecting.
  Confirm these unavailable cases never silently retain Inside status.

Acceptance requires all four drawing options to publish the same visible
shape to every player; an accurately measured exit to produce one player
warning and moderator flag after confirmation; a return to clear the
flag; and missing location to appear distinctly as unavailable. Existing
games without boundaries must retain their current behavior.

## Documentation

On implementation, update `docs/data-model.md` with the room field and
private collections, `docs/game-flows.md` with publication and tracking,
`docs/architecture.md` with the map/location components and callables,
and `docs/testing.md` with device testing and emulator coverage. Document
map configuration and required HTTPS setup in `README.md`.

## Open implementation choice

**Decision: Mapbox.** One provider supplies the satellite and standard map
layers, the map renderer, and place search (Geocoding). Implementation
uses Mapbox GL JS via `react-map-gl` (React 18 compatible), freehand and
polygon editing via `@mapbox/mapbox-gl-draw`, and a circle plugin or custom
sampling for circles and ovals. Ovals are not native in Mapbox and are
implemented as sampled polygons (the same canonical-polygon path as the
other shapes). Before implementation, verify current pricing, token
scopes, attribution text, and touch behavior on iOS Safari and Android
Chrome. A public access token, restricted to the app's origins, is
required and must be configured outside the repository.

## Out of scope

- Multiple permitted zones, holes, and moving boundaries.
- Automatic penalties, disqualification, or restrictions on scoring.
- Showing other players' coordinates or storing movement trails.
- Native background geofencing, push notifications, or GPS spoof detection.
- Saved boundary templates, historical geometry playback, and geofence
  configuration commands in the moderator chat console.
