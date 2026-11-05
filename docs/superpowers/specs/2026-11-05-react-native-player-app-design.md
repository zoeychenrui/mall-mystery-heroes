# React Native Player App Design

**Date:** 2026-11-05
**Status:** Draft

## Problem

Today, players experience the game entirely through a browser tab
(`src/pages/PlayerGame.js` and everything it renders). That has three
concrete costs the moderator (Allen) wants fixed:

- **No persistent login.** A browser tab can lose its session at any
  point (see `docs/superpowers/specs/2026-08-30-player-reconnect-design.md`'s
  Problem section — Safari Private Browsing and backgrounded-tab memory
  eviction both do this routinely during live, walk-around play), and
  reopening a tab after it's gone always starts from scratch.
- **Weaker offline/caching behavior.** A browser tab has no real offline
  story beyond whatever Firestore's own web SDK cache happens to retain,
  and a reload throws that away.
- **Connections feel fragile.** GPS (via `navigator.geolocation`) and
  the camera (via a hidden `<input type="file" capture>`) are both
  browser APIs layered awkwardly on top of what the OS actually offers
  natively, and a backgrounded/locked phone can suspend a browser tab's
  JS entirely, including its location watch.

The fix is a real native app for players, built with React Native via
Expo, that talks to the exact same Firebase backend this project already
has. It is a new client, not a new backend.

## Goals

- Full feature parity with the current player web experience — see
  "Scope: player features" below for the complete list.
- A session that survives the app being closed and reopened: a player
  who re-opens the app mid-game is dropped straight back into their
  game, not back at a join screen.
- Reuses `src/game/`'s existing pure game-rule modules directly, rather
  than re-deriving any game logic for the new client.
- No changes to the Firebase project, Firestore schema, Firestore rules,
  or Cloud Functions — the app calls the exact same `callableFunctions/`
  endpoints and reads/writes the exact same collections the web client
  does today.
- Buildable and testable directly on the moderator's own iPhone during
  development (Expo dev client), and submittable to the App Store (and,
  as a byproduct of React Native, the Play Store) when ready for a real
  game day, where players download it from the store like any other
  app.
- Visually matches the current web app: same dark theme, same colors,
  same layout/information, rebuilt with native controls rather than
  redesigned.

## Non-goals (this round)

- **The GM console stays web-only.** `DashBoard.js`, `Lobby.js`,
  `GameMasterView.js`, `Login.js`/`SignUp.js`, and everything under
  those pages are untouched and are not being rebuilt for mobile. This
  project is the player side only.
- **No push notifications.** The app only reflects live state while
  it's actually open, exactly like the web version today. A later
  project could add push (pinged, boundary changed, broadcast received,
  etc.) once this ships.
- **No background location tracking.** Location reporting runs only
  while the app is open and in the foreground, matching the existing
  "keep the game open for location updates" behavior and messaging
  (`PlayerGame.js`'s own "Enable Location" copy). The existing cadence
  logic (`src/game/locationReportCadence.js`) and the per-report rate
  limit (`reportPlayerLocation.js`) are unchanged and apply the same way.
- **No new visual design.** The goal is "the same thing, but native,"
  not a redesign — see Goals above.
- **No app-specific backend changes.** Every `callableFunctions/`
  endpoint, every Firestore collection shape in `docs/data-model.md`,
  and `firestore.rules` are used as-is. If something genuinely needs a
  backend change to work from a native client (anything), that's a
  deliberate, called-out decision in this doc, not an incidental one
  made later in the plan.

## Anti-goals

- Shipping something that's *functionally* parity but feels noticeably
  worse than the website (sluggish, flaky reconnects, janky camera/map)
  would defeat the point. Performance/battery/offline-robustness polish
  is explicitly deferred past this first build (per the brainstorming
  conversation: "well down the line, yes, but just build it first"),
  but the first build still has to actually work reliably enough to run
  a real game on.

## Scope: player features (full parity)

Every one of these, read directly from the current player-facing code
(`src/pages/PlayerGame.js`, `src/pages/JoinGame.js`,
`src/pages/ReconnectPending.js`, and everything under
`src/components/player_messages_components/`,
`src/components/shop_components/`, `src/components/task_components/`,
`src/components/game_end_components/`, `src/components/map_components/`
that those pages use), gets a native equivalent:

1. **Join a game** — game code + name, anonymous Firebase Auth sign-in
   (`joinRoom.js`). A join rejected because the game already
   started falls through to the reconnect-request flow
   (`requestReconnect.js`), same as today.
2. **Waiting room** — "Waiting for the host to start..." (today this is
   just `PlayerGame.js` rendering before `gameStarted` flips; the native
   app keeps that same single-screen shape).
3. **Reconnect-pending screen** — watches its own request doc live,
   routes into the game once the GM approves it, shows "denied" with a
   way back to the join screen otherwise.
4. **Main game screen**, once the game has started:
   - Current target(s), or an "eliminated" state with the revival-mission
     note.
   - Boundary/location panel: permission prompt, live inside/near-edge/
     outside status text, the exposure countdown, retryable
     unavailable-reason messages (`UNAVAILABLE_REASON_TEXT` in
     `PlayerGame.js`), and a button to open the live map.
   - Live map: the game boundary polygon, this player's own position,
     every other currently-exposed player's position, and ping-card
     "View on map" overlays — the same data `GameMap.js`/
     `PlayerMapModal.js` render today, in a native map view instead of
     Mapbox GL JS.
   - Group chat feed: chat messages, GM broadcasts/whispers,
     kill-photo submissions, mission/revival announcements, power-up
     ping/notice messages — everything `MessageBubble.js` renders today.
   - Chat composer: send a text message; take or pick a photo, claim it
     against a target or an open mission, and submit it
     (`submitChatMessage`/`submitKillPhoto`, unchanged).
   - Missions list (read-only — players never edit missions).
   - Leaderboard (standings, read-only).
   - Power-up shop, when alive and the game is active: watch-ad,
     ping-targets, ping-assassins, global-ping-picked,
     global-ping-random, block-camera, horcrux, mystery-box — the same
     catalog `src/game/powerUps.js` already defines, called through the
     same `purchasePowerUp`/`claimMysteryReward` endpoints.
   - Leave game, with the same confirm-dialog warning.
5. **Game-ended state** — the same banner/notice telling players to head
   back, with chat staying open afterward.

Nothing on this list is new; this is the existing player experience,
rebuilt as a native app.

## How it's built

These are the moderator's calls, made during brainstorming:

- **Expo** (managed workflow), not bare React Native — chosen
  specifically because production distribution is "from the app store
  itself" and testing is "my own thing," which is exactly what Expo's
  dev-client-for-testing / EAS-Build-for-store-submission split is for.
  It avoids hand-maintaining Xcode/Android Studio project files for
  camera, location, and push-notification native modules that Expo
  already wraps.
- **iPhone-first testing**, with both iOS and Android shipping
  eventually — Expo builds both from the same codebase, so this isn't
  a second project later, just a second EAS Build target when it's
  time to submit.
- **Same visual design as the web app** — dark theme, same colors and
  layout, no redesign.
- **Session persistence with auto-resume**: closing and reopening the
  app drops the player straight back into their game (see "Session
  persistence" below), not back at the join screen.
- **No push notifications, no background location** in this round (see
  Non-goals).

These are the moderator's calls left to the builder (implementation
plan), stated here as this design's intent rather than left
unspecified:

- **New top-level project, same repo.** The Expo app lives in a new
  `mobile/` directory alongside the existing `src/`, `functions/`, and
  `docs/` — not a separate repo. It has its own `package.json`
  (Expo/React Native dependencies don't belong in CRA's
  `package.json`, and vice versa).
- **`src/game/` is imported directly, not duplicated.** Every module
  listed in `CLAUDE.md`'s "Game rules, parsing, anything decidable from
  data" row is already plain JS with no React, no Firebase, no DOM —
  written that way specifically so it's reusable. The existing
  `functions/vendor/game/` setup *copies* those files because Cloud
  Functions deploys `functions/` in total isolation from the rest of
  the repo; `mobile/` has no such isolation constraint, since the whole
  repo ships together in git, so the plan should prefer Metro bundler
  config (`watchFolders`, extending the module resolution out to the
  repo root) over copying, to avoid a second place these files can
  drift out of sync. If that turns out not to work cleanly with Expo's
  Metro setup, vendoring via the existing
  `functions/scripts/sync-shared-game-logic.js` pattern is the fallback
  — either way, `src/game/` stays the single source of truth per
  `CLAUDE.md`.
- **Firebase JS SDK (`firebase` npm package), not
  `@react-native-firebase`.** The existing web app already uses the JS
  SDK; reusing it in the Expo app (with `firebase/auth`'s
  `getReactNativePersistence` backed by `@react-native-async-storage/
  async-storage` for persistent login, and the same `firebase/firestore`
  and `httpsCallable` APIs the web app's `dbCalls.js` and
  `src/components/*.js` callable wrappers already use) means the exact
  same Firebase config, project, and query/callable code patterns carry
  over almost directly, and avoids `@react-native-firebase`'s native
  module setup (which would pull Expo toward the less-simple
  "bare"/custom-dev-client path for no benefit here, since this project
  doesn't need anything the JS SDK can't do, like heavier background
  processing).
- **Native equivalents for the browser-only APIs the current player
  code depends on.** Found by reading the actual files, not just the
  top-level components:
  - `navigator.geolocation` (`useBoundaryLocation.js`) → `expo-location`'s
    foreground position watch. The cadence/throttling logic in
    `src/game/locationReportCadence.js` is reused unchanged; only the
    OS-level watch call changes.
  - The hidden `<input type="file" capture="environment">`
    (`MessageComposer.js`) → `expo-image-picker`'s camera capture.
  - `src/utils/compressImage.js`'s `new Image()`/`<canvas>`/
    `URL.createObjectURL` (run on every kill-photo before upload, so a
    multi-MB phone photo doesn't go out over a possibly-weak venue
    connection uncompressed — skipping this would reproduce exactly the
    "janky camera" failure this doc's Anti-goals section rules out) →
    `expo-image-manipulator` for the resize/compress step.
  - `crypto.randomUUID()` (`src/components/firebase_calls/
    storageCalls.js`'s `uploadKillPhoto`, naming the Storage object) →
    `expo-crypto` (or an equivalent RN UUID polyfill), since Hermes does
    not provide this by default.
  Each of these is a client-side swap only — none change what gets
  uploaded, stored, or how the backend processes it, so none of them
  are backend changes under this doc's Non-goals.
- **Firestore's realtime listeners need a transport setting under
  React Native.** The web SDK's default `onSnapshot` streaming
  transport is browser-specific; under Hermes it commonly needs
  `initializeFirestore(app, { experimentalForceLongPolling: true })`
  (or `experimentalAutoDetectLongPolling`) to work at all. Every
  parity feature in this doc (chat, boundary status, map positions,
  missions, leaderboard, shop) is an `onSnapshot` subscription, so the
  plan should verify this works — with that setting — as a first step,
  before estimating anything built on top of it. If it turns out not to
  work even with that setting, the fallback is reconsidering
  `@react-native-firebase`, which would be a real change to the "How
  it's built" decisions above, not a small fix — worth surfacing early
  rather than discovering mid-build.
- **A native map component** (e.g. `react-native-maps`) replacing
  `react-map-gl`/Mapbox GL JS for `GameMap.js`'s player-facing rendering
  — the boundary polygon, position markers, and accuracy circle are the
  same data, drawn with a different library's primitives.
- **Plain React Native components + `StyleSheet`**, not a heavy UI kit —
  matching the existing look doesn't need Chakra-equivalent theming
  infrastructure; buttons, modals/screens, text inputs, and `FlatList`
  for the chat feed and lists cover everything the current Chakra
  components render.
- **`AsyncStorage` in place of `localStorage`** for
  `utils/playerSession.js`'s equivalent (room ID + player name), read on
  app launch to decide whether to resume straight into the game screen
  or show the join screen.

## Session persistence (the "drop back into the game" behavior)

On launch, the app checks for a locally stored session (room ID +
player name, the native equivalent of `utils/playerSession.js`) and a
still-valid Firebase Auth session (persisted via `AsyncStorage`, so it
survives an app restart the way a browser tab's session currently does
not reliably survive one). If both are present, the app skips the join
screen and subscribes directly to that room/player the same way
`PlayerGame.js` does today — and exactly like today, if the room is gone
or this player's doc no longer exists (kicked, room deleted), the
existing `handleSubscriptionError` behavior applies: the stored session
is cleared and the player lands on the join screen instead. No new
Firestore reads or backend behavior — this changes only what screen the
app shows first.

## Rollout and submission logistics

- **The web player experience stays live.** `PlayerGame.js`,
  `JoinGame.js`, `ReconnectPending.js`, and everything they depend on
  are not retired or redirected once the app ships — the website
  remains a working fallback (e.g. for a player who hasn't installed
  the app yet, or before an Android build exists) indefinitely. No
  sunset/removal task belongs in the implementation plan.
- **App Store review access: a standing demo room.** Apple's reviewers
  need to get past the join screen, which requires a real game code —
  there is no "skip login" mode for reviewers. The moderator will
  maintain a permanent demo room (a fixed game code, left in an active,
  joinable state) for this purpose, rather than relying on written
  reviewer notes alone. The implementation plan should flag, for the
  moderator to confirm at submission time, that this demo room's code
  is included in the App Store Connect submission's reviewer notes, and
  should check whether `cleanupEndedRooms` (the scheduled function that
  deletes ended rooms) could ever sweep it — if it only acts on rooms
  where `isGameActive` has been `false` for some time, a permanently
  active demo room is already safe from that and needs no special
  casing; if not, the plan should call that out as something to fix or
  work around, not silently reproduce the sweep.
- **Apple Developer Program and Google Play Console accounts don't
  exist yet.** Both need to be created before a store submission can
  happen. Apple's enrollment in particular can take a day or two to
  clear, so the implementation plan should list "enroll in both
  programs" as an early, start-it-and-move-on task — not a blocker for
  building or for the moderator's own dev-client testing, which needs
  neither account.

## What's explicitly out of scope, even as nice-to-haves

Raised and deliberately deferred during brainstorming, listed here so a
later "wait, what about—" has an answer already on record:

- Push notifications.
- Background location tracking.
- Any visual redesign.
- Any change to the GM/moderator experience (stays web-only).
- Performance/battery/offline-robustness hardening beyond "it works
  reliably enough to run a real game" — explicitly a later pass.
