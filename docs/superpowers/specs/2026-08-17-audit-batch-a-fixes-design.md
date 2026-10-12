# Audit Batch A: Small Fixes Design

**Date:** 2026-08-17
**Status:** Approved

## Problem

A multi-agent audit of the live game flow found 19 outstanding issues,
ranging from one-line doc fixes to genuine security-architecture decisions
(session recovery, kill-photo identity spoofing, rate limiting, multi-GM
support). Bundling all 19 into one plan would mean giving the same weight
to a manifest-file swap as to a security redesign. This spec covers only
"Batch A": seven small, independent, low-risk items with an
established-or-obvious fix — the same shape of bundle this repo already
used for `docs/improvements.md` items 47-50
(`docs/superpowers/specs/2026-08-16-backlog-cleanup-design.md`). The
remaining 12 items are out of scope here, tracked for later batches.

## Decisions

- **#17 (length caps) is scoped down to client-side only.** A `maxLength`
  on free-typed inputs (join-name, chat message) stops accidental abuse;
  it does not stop a modified client. Rules-level enforcement is
  deliberately deferred to the later security-cluster batch (kill-photo
  identity binding, rate limiting), where it belongs alongside the other
  "can a client lie to the server" concerns — bundling it here would blur
  this batch's low-risk character.
- **#16 (Dashboard double-room race) gets the deterministic-ordering fix,
  not the transactional-pointer-doc fix**, per explicit user choice: it
  doesn't prevent the rare race from creating two rooms, only makes
  repeated reloads land in the same (newest) one instead of bouncing
  unpredictably. Needs a new `createdAt` field on the room doc, written at
  creation, to order by.
- **#19 (docs/game-flows.md)** gets a full pass, not just the two sections
  originally flagged — while fixing the "Where each flow updates the
  screen" table, also check whether the `/revive` "silently does nothing"
  note is stale now that item 21 fixed silent no-ops generally, since it's
  directly adjacent and cheap to verify while already in that file.

## Components

### `src/components/lobby_components/PlayerRemove.js` (modified) — #10

Wrap the existing "Remove" button in a Chakra `AlertDialog`, mirroring
`src/components/header_components/ResetTargetsButton.js`'s exact pattern:
`useDisclosure`, a `cancelRef`, `AlertDialogContent bg="#202030"`, a
"WARNING"-style header, "Go Back"/"Confirm" footer buttons. The button's
`onClick` becomes "open the dialog" (guarded by the existing "must select
player" check, unchanged); only the dialog's Confirm button calls the
existing `handleRemovePlayer`. The dialog body names the selected player
so it's clear what's about to be deleted.

### `src/components/photos_display_component/PhotosDisplay.js` (modified) — #11

The "Photos" `Heading` becomes conditional text: `Photos (N pending)` when
`unjudgedPhotos.length > 0`, plain `Photos` otherwise. `unjudgedPhotos` is
already computed state — no new subscription, no new read.

### `public/manifest.json`, `public/logo192.png`, `public/logo512.png` (modified) — #13

- `manifest.json`: `short_name`/`name` → `"Mall Mystery Heroes"`,
  `theme_color`/`background_color` → `"#202030"` (this app's actual
  background, from `src/theme.js`'s `brand.300`).
- `logo192.png`/`logo512.png`: regenerated from
  `src/assets/mall-logo-white-2.png` (1536×1536, already square) via
  `sips -z 192 192` / `sips -z 512 512`, replacing the stock React atom
  icon.
- `public/index.html`'s `<meta name="theme-color" content="#000000" />`
  also updates to `#202030` to match — same color, two places, both
  currently wrong.

### `src/components/logs_components/ChatInput.js` (modified) — #15

In the `/openseason` case, before calling
`setOpenSznOfPlayerToValueForRoom`: look up the target's current
`openSeason` value from the already-in-scope `players` array (matched via
`normalizePlayerName`, same lookup style already used elsewhere in this
switch). If the requested state (`start`/`end`) already matches the
player's current `openSeason`, skip the write and
`createAlert('error', 'Error', '<name>'s open season is already <state>',
1500)` instead. Removes the stale `// TO DO: double check szn alrdy
on/off` comment.

### `src/pages/DashBoard.js` (modified) + `src/components/firebase_calls/dbCalls.js` (modified) — #16

- Room creation (`DashBoard.js`'s `resolveDestination`) adds
  `createdAt: serverTimestamp()` to the `setDoc` call that creates a new
  room.
- `dbCalls.js`'s `fetchActiveRoomForHost` changes its query to order by
  `createdAt` descending and take the first result, instead of an
  unordered `.find()`. Existing rooms created before this change have no
  `createdAt` field; Firestore's `orderBy` excludes documents missing the
  ordered field entirely, so a returning host with only a pre-existing
  room would find nothing via this path — acceptable, since
  `fetchActiveRoomForHost` already falls back to creating a fresh room
  when it finds none, and this is a one-time transition, not an ongoing
  gap.

### `src/pages/JoinGame.js`, `src/components/player_messages_components/MessageComposer.js` (modified) — #17

- `JoinGame.js`'s name `Input` gains `maxLength={40}`.
- `MessageComposer.js`'s chat-message `Input` gains `maxLength={500}`.

(Exact limits are generous, not tightly load-bearing — chosen to be far
above any real player name or chat message while still bounding the
worst case. No `firestore.rules` change, per the Decisions section above.)

### `docs/game-flows.md` (modified) — #19

- Rewrite "The target assignment algorithm" section to describe the
  current `buildTargetGraph`/`shuffle` implementation
  (`src/game/targetGraph.js`) instead of the replaced
  `TargetGenerator.InitializeTargets` ring-walk and the broken
  `randomizeArray` shuffle (both gone, per improvements items 11/12).
- Rewrite "Where each flow updates the screen" — the log panel (item 22),
  `Players (n)` header (item 13), alive/dead arrays (chat-send-and-efficiency
  work), and photo-undo history (item 6) are all live/persisted now, not
  stale-after-reload as the table currently claims.
- Check the `/revive` "silently does nothing... produces no feedback at
  all" note against item 21's silent-no-op fix; correct it if stale.
- Add a short paragraph documenting `functions/scripts/sync-shared-game-logic.js`
  and the `functions/vendor/game/` copies it produces — undocumented
  anywhere currently, and `killPlayer.js`'s own comment on this import
  points here as the explanation.

## Testing

- **#10**: new test in `PlayerRemove.test.jsx` (create if it doesn't
  exist, or extend it) — clicking Remove opens the dialog without calling
  `removePlayerForRoom`; clicking Confirm calls it; clicking Go Back
  closes the dialog with no call made.
- **#11**: new test in `PhotosDisplay.test.jsx` — heading shows the count
  when `unjudgedPhotos` is non-empty, shows plain "Photos" when empty.
- **#13**: no automated test — a manifest/icon swap isn't meaningfully
  unit-testable; verify manually (`npm run build`, inspect
  `build/manifest.json` and icon files).
- **#15**: new test in `ChatInput.test.jsx` — `/openseason bob start` when
  bob's season is already open shows the new error alert and does not
  call `setOpenSznOfPlayerToValueForRoom`; the normal start/end paths are
  unchanged (existing tests should still pass unmodified).
- **#16**: `dbCalls.integration.test.js` gains a case for
  `fetchActiveRoomForHost` returning the most-recently-created room when
  a host has (hypothetically, via direct seeding) more than one active
  room; `DashBoard.test.jsx` confirms `createdAt` is written on room
  creation.
- **#17**: extend `JoinGame.test.jsx`/`MessageComposer.test.jsx` with a
  case asserting the `maxLength` attribute is present (jsdom doesn't
  enforce `maxLength` against programmatic `userEvent.type`, so this
  tests the attribute is wired, not truncation behavior).
- **#19**: no test — docs-only.

## Error handling

None of these introduce new failure modes beyond what each file already
handles: #10/#15 reuse existing `createAlert` error-toast patterns already
established in their files; #16's `fetchActiveRoomForHost` change doesn't
change its error handling, only its query; #17 is a pure HTML attribute
addition with no new failure path.

## Out of scope

- The other 12 audit items (#2-9, #12, #14, #18) — tracked, not addressed
  here.
- `firestore.rules`-level length enforcement for #17 — deferred to the
  security-cluster batch.
- The transactional-pointer-doc fix for #16 — deferred/rejected per the
  Decisions section; the deterministic-ordering fix does not prevent the
  underlying race, only its confusing effects.
