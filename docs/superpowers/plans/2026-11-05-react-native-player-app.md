# React Native Player App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native (Expo) app, in a new `mobile/` directory in
this same repo, that gives players full feature parity with today's
player-facing web experience (`src/pages/PlayerGame.js` and everything it
renders), talking to the exact same Firebase backend — no schema, rules,
or Cloud Function changes.

**Architecture:** A new client only. The actual game-rule logic
(`src/game/*.js`, plus the pure helpers `src/utils/applyMessageChanges.js`
and `src/utils/formatMessageTime.js`) is imported directly from `mobile/`
via Metro bundler config, never duplicated. A new, small Firebase seam
(`mobile/src/firebase/`) mirrors the web app's `dbCalls.js`/callable
wrappers against the mobile app's own Firebase SDK instances — it is not
a shared module with the web app, because the web versions hard-import
the web-only `utils/firebase.js`. Screens are plain React Native
components + `StyleSheet`, matching the web app's existing dark theme.

**Tech Stack:** Expo (managed workflow), `firebase` JS SDK (same major
version as the web app, `^10.x`), `@react-navigation/native`,
`@react-native-async-storage/async-storage`, `expo-location`,
`expo-image-picker`, `expo-image-manipulator`, `expo-crypto`,
`react-native-maps`.

**Spec:** `docs/superpowers/specs/2026-11-05-react-native-player-app-design.md`

## Global Constraints

- **This plan was revised after a merge.** The original plan was
  written against a local `main` that turned out to be badly behind
  `origin/main` — a large amount of upstream player-facing work had
  landed (player avatars, a Game Rules modal, a "just for fun" photo
  option, a "join after the game started" reconnect-request variant,
  and a visual refresh of the player header) that the original design
  doc and plan simply never saw. `main` has since been brought current
  and every task below reflects the real, current code. This note
  exists so a reader of the plan's history understands why some task
  text references files that didn't exist when the design doc was
  written.
- No changes to Firestore schema, `firestore.rules`, or any
  `functions/callableFunctions/*.js` endpoint. Every task below calls
  the exact same backend the web app already calls — this holds even
  for the avatar feature (Task 15): the write it needs
  (`players/{playerId}.avatarUrl`) is already permitted directly by an
  existing `firestore.rules` clause (a signed-in player may update only
  that one field on their own player doc), and the existing
  `storage.rules` already has a matching `rooms/{roomId}/avatars/
  {uid}` rule — nothing to add on either side.
- `src/game/*.js`, `src/utils/applyMessageChanges.js`, and
  `src/utils/formatMessageTime.js` are the single source of truth —
  imported by `mobile/`, never copied by hand. (`src/game/` mixes
  CommonJS `module.exports` files — e.g. `gameBoundary.js`,
  `powerUps.js`, `powerUpEffects.js`, `playerNames.js` — with ES
  `export` files — e.g. `locationReportCadence.js`, `leaderboard.js`,
  `photoClaimOptions.js`. Task 2 verifies Metro resolves both the same
  way CRA's webpack/Babel setup already does.)
- Firebase JS SDK, not `@react-native-firebase`. Auth persistence via
  `getReactNativePersistence` (from `firebase/auth`) backed by
  `@react-native-async-storage/async-storage`. Firestore initialized
  with `initializeFirestore(app, { experimentalForceLongPolling: true })`
  — Task 1 verifies this empirically (a second client's write shows up
  live in the app) before any later task is built on top of it.
- No push notifications, no background location tracking, no visual
  redesign, no GM-console work, in this round.
- The web player experience (`src/pages/PlayerGame.js`,
  `JoinGame.js`, `ReconnectPending.js`) stays live indefinitely — no
  task in this plan touches it.
- `functions/scheduledFunctions/cleanupEndedRooms.js` only deletes
  rooms where `endedAt <= cutoff` (a Firestore inequality query, which
  Firestore excludes documents with no `endedAt` field from entirely).
  A standing demo room for App Store review, left with `endedAt` never
  set, is therefore never swept — **no code change needed for this**,
  confirmed by reading the function; no task exists for it below.
- Visual parity means reusing the exact Chakra color tokens already in
  the web components, resolved to RN-usable hex via Chakra's published
  default theme palette (`@chakra-ui/theme`'s `foundations/colors`) at
  implementation time, plus one literal hex already in the source,
  `#202030` (every modal/panel background — `KillPhotoModal`,
  `PowerUpShopModal`, `LeaderboardModal`, `PlayerMapModal`,
  `PlayerTaskListModal`, `PlayerGameDialogs`' leave-confirm dialog).
  Named tokens in use, by where: `teal.700`/`blue.900` (chat bubbles,
  mine/theirs), `gray.700` (killPhoto/mission/leaderboard bubbles),
  `gray.800` (`PlayerRulesModal`, the target-photo-viewer modal —
  Task 15), `gray.900`/`gray.950` (the header, `PlayerGameHeader`, and
  the page background), `red.950` (page background once the game has
  ended, in place of the older `red.900` — `PlayerGame.js`'s own root
  `Flex`), `purple.900`/`purple.400`/`purple.700` (GM broadcast bubble
  bg/border; the target-list accordion's background/border in the
  header uses `purple.900`/`purple.700`), `whiteAlpha.100`/`gray.400`
  (GM whisper bubble bg/border, dashed; `whiteAlpha.100` also the
  waiting-room notice box), `whiteAlpha.200`/`whiteAlpha.400`/
  `whiteAlpha.600` (header dividers/borders/secondary text),
  `yellow.300` (the "GM:" label), `orange.900`/`orange.400`/
  `orange.300` (power-up ping bubble), `orange.800` (location denied/
  unavailable panel), `orange.700` (approaching-exposure panel),
  `red.900` (outside-boundary panel), `red.700` (the game-ended page
  banner and modal), `red.500` (the "YOU'VE BEEN ELIMINATED" heading),
  `green.800` (the "inside" status banner), `teal.200` (headings inside
  `PlayerRulesModal`), button `colorScheme`s `teal` (primary actions),
  `red` (Leave), `yellow` (Shop).
- Mobile's own Firebase-touching files (`mobile/src/firebase/*.js`) are
  never imported from a unit test — same rule as the web app's
  `dbCalls.js`/`utils/firebase.js` (`CLAUDE.md`), for the same reason:
  they are thin SDK wrappers, verified by running the app, not unit
  tested. This matches the web app's own precedent: none of
  `dbCalls.js`'s ~38 query-builder functions or any `httpsCallable`
  wrapper (`joinRoom.js`, `submitChatMessage.js`, etc.) has a dedicated
  unit test today either.

## Review Focus

- **Location permission re-granted from OS Settings while the app is
  already running.** `useBoundaryLocation.js`'s web version carries a
  comment that a browser's `PERMISSION_DENIED` kills a `watchPosition`
  call for good, so Retry must start a brand-new watch — `expo-location`
  may not share that exact semantic. Task 11's tests must prove Retry
  actually re-establishes reporting after a real grant, not just that it
  calls the right functions.
- **Backgrounding the app mid-location-watch, then foregrounding it
  again.** The web hook reacquires a fresh fix on `visibilitychange`
  (tab focus); the RN equivalent is `AppState` going to `'active'`. If
  this is skipped, a player locking and unlocking their phone — which
  happens constantly in live play — never gets the "force a fresh check"
  behavior the web version relies on. Task 11 must test this path
  explicitly.
- **Backgrounding the app mid-photo-upload.** `MessageComposer.js`
  closes its modal immediately and lets the upload/submit continue
  "in the background," surfacing failure via a toast — an assumption
  that holds in a desktop browser tab but not necessarily in a
  backgrounded RN app, where JS execution can suspend mid-upload with
  no toast ever shown. Task 10 must at minimum document (via a code
  comment, since there's no cross-platform automated way to assert on
  OS-level JS suspension in a test) what happens if this occurs, and
  its manual test pass must include "background the app immediately
  after tapping Submit."
- **Firestore listeners accumulating across repeated join/leave
  cycles.** `GameScreen` (Task 7) owns several simultaneous
  subscriptions (room, player, players, tasks, boundary status,
  outside-positions). If any isn't torn down on unmount/leave, repeated
  testing (join → leave → rejoin, many times, which this plan's own
  manual QA pass in Task 16 will naturally do) reproduces the exact
  listener-leak/read-amplification bug class already fixed on the web
  side this session. Task 7's tests must assert every subscription's
  unsubscribe function is called exactly once on unmount.
- **Room code / player name casing and whitespace.** The web
  `JoinGame.js` uppercases the room code as typed; the backend matches
  player names via `trimmedNameLowerCase`. A native `TextInput`'s
  default autocapitalize/autocorrect behavior differs from a web
  `<input>`'s, and if Task 5 doesn't explicitly mirror the same
  transform-on-input behavior, a player could type something that
  looks identical to what a GM sees on the roster but fails to join
  due to a casing/whitespace mismatch the web version never has. Task 5
  must test the exact transform applied to typed input.

---

## File Structure

```
mobile/
  package.json                      Expo app's own dependencies (not CRA's)
  app.config.js                     Expo config: app name, icon (reuse
                                     src/assets/mall-logo-black-green.png),
                                     EXPO_PUBLIC_FIREBASE_* env references
  metro.config.js                   watchFolders out to the repo root, so
                                     `../../src/game/*` and
                                     `../../src/utils/{applyMessageChanges,
                                     formatMessageTime}` resolve
  .env.example                      committed; real .env is gitignored,
                                     same EXPO_PUBLIC_FIREBASE_* keys the
                                     web app's REACT_APP_FIREBASE_* keys
                                     carry (values are public client
                                     config, not secrets)
  App.js                            NavigationContainer root; decides
                                     Join vs. resume-into-Game on launch
  src/
    firebase/
      firebaseConfig.js             initializeApp/Auth/Firestore/
                                     Storage/Functions, RN persistence +
                                     long-polling setting
      dbCalls.js                    query-builder functions mirroring the
                                     subset of web dbCalls.js the player
                                     screens use
      callables.js                  joinRoom/requestReconnect/leaveGame/
                                     submitChatMessage/submitKillPhoto/
                                     reportPlayerLocation/purchasePowerUp/
                                     claimMysteryReward wrappers
      storageCalls.js                uploadKillPhoto, RN-native version
    utils/
      playerSession.js              AsyncStorage-backed session (async API)
      playerSession.test.js
    hooks/
      useBoundaryLocation.js        expo-location version of the web hook
      useBoundaryLocation.test.js
    navigation/
      RootNavigator.js              native-stack: Join, ReconnectPending,
                                     Game
    screens/
      JoinScreen.js
      ReconnectPendingScreen.js
      GameScreen.js                 the PlayerGame.js equivalent: target/
                                     eliminated display, Leave, game-ended
                                     banner/modal, Rules modal entry point,
                                     hosts the panels below. Ports SIX web
                                     files, not one — PlayerGame.js's logic
                                     is split across src/pages/PlayerGame.js
                                     and src/components/player_game/
                                     {PlayerGameHeader,PlayerGameDialogs,
                                     PlayerGameStatusNotices,
                                     PlayerBoundaryPanel,PlayerRulesModal}.js
      components/
        ChatFeed.js
        ChatComposer.js
        MessageBubble.js
        KillPhotoModal.js
        LocationStatusPanel.js
        GameMapModal.js             react-native-maps
        MissionsModal.js
        LeaderboardModal.js
        PowerUpShopModal.js
        AvatarButton.js             Task 15: capture/compress/upload own
                                     avatar; also renders a target's avatar
                                     + opens TargetPhotoModal
        TargetPhotoModal.js         Task 15: view one target's full photo
```

---

### Task 1: Scaffold the Expo app, wire up Firebase, verify realtime listeners work

**Files:**
- Create: `mobile/package.json`, `mobile/app.config.js`,
  `mobile/.env.example`, `mobile/App.js` (placeholder screen only),
  `mobile/src/firebase/firebaseConfig.js`

**Interfaces:**
- Produces: `mobile/src/firebase/firebaseConfig.js` exports `app`,
  `auth`, `db`, `storage`, `functions` — the same five names
  `src/utils/firebase.js` exports on the web side, same shapes
  (`getAuth()`'s `Auth`, `getFirestore()`'s `Firestore`,
  `getStorage()`'s `FirebaseStorage`, `getFunctions()`'s `Functions`
  instances), for every later task to import from.

- [ ] **Step 1: Scaffold the project**

Run `npx create-expo-app@latest mobile` from the repo root (TypeScript
template declined — this repo's convention is plain JS throughout).
Inside `mobile/`, install `firebase`, `@react-native-async-storage/
async-storage`.

- [ ] **Step 2: Write `mobile/app.config.js`**

Expo config exporting `name`/`slug` (`"Mall Mystery Heroes"`/
`"mall-mystery-heroes-player"`), `icon` pointing at a copy of
`src/assets/mall-logo-black-green.png` placed at `mobile/assets/icon.png`,
and `extra`/env wiring so `EXPO_PUBLIC_FIREBASE_API_KEY` etc. (one per
key in the web app's `src/utils/firebase.js` config object — read that
file now for the exact key list) are readable via
`process.env.EXPO_PUBLIC_FIREBASE_*` at runtime (Expo inlines
`EXPO_PUBLIC_`-prefixed env vars automatically; no extra plugin needed).

- [ ] **Step 3: Write `.env.example` and a real (gitignored) `.env`**

One line per `EXPO_PUBLIC_FIREBASE_*` key in `.env.example` with blank/
placeholder values; the real `.env` (add to `mobile/.gitignore`) filled
with the same project's actual values from the web app's own `.env` —
this is the same Firebase project, so the values are identical, just
renamed from `REACT_APP_` to `EXPO_PUBLIC_` prefixes.

- [ ] **Step 4: Write `mobile/src/firebase/firebaseConfig.js`**

```js
import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = { /* from process.env.EXPO_PUBLIC_FIREBASE_* */ };

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
});
export const db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
});
export const storage = getStorage(app);
export const functions = getFunctions(app);
```

- [ ] **Step 5: Manually verify realtime listeners actually work (the
  day-one risk this plan exists to catch early)**

This is a platform-integration check, not a unit test — write a
throwaway screen in `App.js` that, on mount, signs in anonymously
(`signInAnonymously(auth)`), then subscribes with `onSnapshot` to any
existing room document from the real (or emulator) Firestore project,
and renders whatever it receives. Run it on a real iPhone via Expo Go
or an Expo dev client. Separately, from the web app or the Firebase
console, edit that same room document. **Pass condition: the change
appears on the phone screen without restarting the app.** If it
doesn't arrive within a few seconds, try
`experimentalAutoDetectLongPolling: true` in place of
`experimentalForceLongPolling: true` and retest. If neither works,
stop — this is the "reconsider `@react-native-firebase`" branch the
design doc calls out, and is a conversation with the project owner
before any further task proceeds, not a problem to solve by guessing.

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/app.config.js mobile/.env.example \
  mobile/App.js mobile/src/firebase/firebaseConfig.js mobile/.gitignore
git commit -m "Scaffold Expo player app with verified Firebase/Firestore wiring"
```

---

### Task 2: Share `src/game/` and the pure `src/utils/` helpers into `mobile/`

**Files:**
- Create: `mobile/metro.config.js`
- Create (throwaway, deleted at the end of this task once it passes):
  a temporary import in `mobile/App.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every later task may `import ... from '../../../src/game/<file>'`
  or `'../../../src/utils/applyMessageChanges'` /
  `'../../../src/utils/formatMessageTime'` (path depth varies by the
  importing file's own location under `mobile/src/`) and have it resolve
  both at dev time (Expo Go/dev client) and in a production Expo build.

- [ ] **Step 1: Write `mobile/metro.config.js`**

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(__dirname, '..', 'node_modules'),
];

module.exports = config;
```

- [ ] **Step 2: Verify both module styles resolve**

Temporarily import, in `App.js`, one CommonJS `src/game/` file
(`const { GAME_BOUNDARY_CONFIG } = require('../../src/game/gameBoundary')`)
and one ES-export file
(`import { MIN_SEND_INTERVAL_MS } from '../../src/utils/applyMessageChanges'`
— actually import something from `locationReportCadence.js`, the ES
file named in Global Constraints: `import { MIN_SEND_INTERVAL_MS } from
'../../src/game/locationReportCadence'`), and render both values on
screen. Run via Expo Go/dev client on the test iPhone.

**Pass condition:** both values render without a Metro resolution
error. If the CommonJS file fails to resolve where the ES file
succeeds (or vice versa), that is the signal to fall back to vendoring:
write `mobile/scripts/sync-shared-game-logic.js`, mirroring
`functions/scripts/sync-shared-game-logic.js`'s exact pattern (copy a
named file list from `../../src/game/` into a gitignored
`mobile/vendor/game/`, run before `expo start`/`eas build` the same way
the existing script runs before `firebase deploy`), and have every
later task's game-logic imports point at `../vendor/game/<file>`
instead of `../../../src/game/<file>`. Record in this task's commit
message which path was used.

- [ ] **Step 3: Remove the throwaway import/render from `App.js`**

- [ ] **Step 4: Commit**

```bash
git add mobile/metro.config.js
git commit -m "Share src/game/ pure logic into the mobile app via Metro watchFolders"
```

(If the vendoring fallback was needed, also `git add
mobile/scripts/sync-shared-game-logic.js` and note it in the message.)

---

### Task 3: Mobile Firebase data layer — query builders, callable wrappers, Storage upload

**Files:**
- Create: `mobile/src/firebase/dbCalls.js`
- Create: `mobile/src/firebase/callables.js`
- Create: `mobile/src/firebase/storageCalls.js`

**Interfaces:**
- Consumes: `app`, `auth`, `db`, `storage`, `functions` from Task 1's
  `mobile/src/firebase/firebaseConfig.js`.
- Produces (all consumed by Tasks 5–14):
  - `dbCalls.js`: `fetchRoomReferenceForRoom(roomID)`,
    `fetchPlayerReferenceForRoom(playerName, roomID)`,
    `fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID)`,
    `fetchTasksQueryForRoom(roomID)`,
    `fetchBoundaryStatusReferenceForPlayer(playerName, roomID)`,
    `fetchOutsideBoundaryStatusesQueryForRoom(roomID)`,
    `fetchPlayerMessagesQueryForRoom(roomID)`,
    `fetchReconnectRequestReferenceForRoom(requestId, roomID)` — same
    names, same return shapes (a `DocumentReference` or `Query`) as the
    web `src/components/firebase_calls/dbCalls.js`'s functions of the
    same names.
  - `callables.js`: `joinRoom(roomId, playerName)`,
    `requestReconnect(roomID, playerName)`, `leaveGame(roomID)`,
    `submitChatMessage({roomId, text})`,
    `submitKillPhoto({roomId, target, mission, url})`,
    `reportPlayerLocation(payload)`, `purchasePowerUp({roomId, itemId,
    targetName})`, `claimMysteryReward({roomId, targetName})` — same
    names/signatures/return shapes as the web app's
    `src/components/{joinRoom,requestReconnect,leaveGame,
    submitChatMessage,submitKillPhoto,reportPlayerLocation,
    purchasePowerUp}.js`.
  - `storageCalls.js`: `uploadKillPhoto(roomID, photoBlob)` — same
    name/signature/return (`Promise<string>`, the download URL) as the
    web version.

- [ ] **Step 1: Write `dbCalls.js`**

Read `src/components/firebase_calls/dbCalls.js` now, for each of the
eight function names above, and copy each one's body verbatim (they
are plain `firebase/firestore` calls — `collection`, `doc`, `query`,
`where`, `orderBy` — framework-agnostic already), substituting this
file's own `db` import for the web file's.

- [ ] **Step 2: Write `callables.js`**

Read each of the seven web client-wrapper files named above now, and
copy each one's body verbatim (each is a two-to-five-line
`httpsCallable(functions, '<name>')` wrapper), substituting this
file's own `functions` import.

- [ ] **Step 3: Write `storageCalls.js`**

```js
import { storage } from './firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as Crypto from 'expo-crypto';

export const uploadKillPhoto = async (roomID, photoBlob) => {
    const photoID = Crypto.randomUUID();
    const photoRef = ref(storage, `rooms/${roomID}/photos/${photoID}.jpg`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
```

Install `expo-crypto` if not already present from Task 1.
`photoBlob` here is expected to already be a `Blob` — Task 10 is
responsible for turning an `expo-image-manipulator` output URI into one
(via `await (await fetch(uri)).blob()`, the standard RN pattern) before
calling this function, matching how the web version's
`compressImage.js` already hands `MessageComposer.js` a `Blob` by the
time it reaches `uploadKillPhoto`.

- [ ] **Step 4: Manually verify against the real project**

No unit test (per Global Constraints — these are thin SDK wrappers,
same as their web counterparts). From a throwaway screen or the Expo
dev menu's JS console, call `joinRoom` against a real test room and
confirm the player doc appears in the Firebase console, then call
`fetchPlayerReferenceForRoom` and confirm `onSnapshot` on it fires.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/firebase/dbCalls.js mobile/src/firebase/callables.js \
  mobile/src/firebase/storageCalls.js
git commit -m "Add mobile app's own Firebase data-access layer, mirroring the web app's dbCalls/callable wrappers"
```

---

### Task 4: AsyncStorage-backed player session

**Files:**
- Create: `mobile/src/utils/playerSession.js`
- Test: `mobile/src/utils/playerSession.test.js`

**Interfaces:**
- Produces: `readPlayerSession(storage?)` returning
  `Promise<{roomID: string, playerName: string} | null>`,
  `writePlayerSession(roomID, playerName, storage?)` returning
  `Promise<void>`, `clearPlayerSession(storage?)` returning
  `Promise<void>` — same three names as the web
  `src/utils/playerSession.js`, but **async** (AsyncStorage's API is
  promise-based; `localStorage`'s is not), defaulting `storage` to the
  real `@react-native-async-storage/async-storage` module rather than
  `window.localStorage`. Consumed by Tasks 5, 7, and 8.

- [ ] **Step 1: Write the failing tests**

Read `src/utils/playerSession.test.js` now and mirror its five cases
exactly, `await`-ing each call and using a fake storage object whose
three methods (`getItem`/`setItem`/`removeItem`) return Promises
instead of acting synchronously:

```js
import { readPlayerSession, writePlayerSession, clearPlayerSession } from './playerSession';

const createFakeStorage = () => {
    const store = {};
    return {
        getItem: async (key) => (key in store ? store[key] : null),
        setItem: async (key, value) => { store[key] = value; },
        removeItem: async (key) => { delete store[key]; },
    };
};

describe('playerSession', () => {
    it('returns null when nothing is stored', async () => {
        await expect(readPlayerSession(createFakeStorage())).resolves.toBeNull();
    });

    it('round-trips a written session', async () => {
        const storage = createFakeStorage();
        await writePlayerSession('Fluffy42317', 'Alice', storage);
        await expect(readPlayerSession(storage)).resolves.toEqual({
            roomID: 'Fluffy42317',
            playerName: 'Alice',
        });
    });

    it('clears a stored session', async () => {
        const storage = createFakeStorage();
        await writePlayerSession('Fluffy42317', 'Alice', storage);
        await clearPlayerSession(storage);
        await expect(readPlayerSession(storage)).resolves.toBeNull();
    });

    it('returns null for malformed JSON instead of throwing', async () => {
        const storage = createFakeStorage();
        await storage.setItem('mmh:player-session', 'not valid json{{{');
        await expect(readPlayerSession(storage)).resolves.toBeNull();
    });

    it('returns null when the stored value is missing expected fields', async () => {
        const storage = createFakeStorage();
        await storage.setItem('mmh:player-session', JSON.stringify({ roomID: 'Fluffy42317' }));
        await expect(readPlayerSession(storage)).resolves.toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

First, set up `mobile/package.json`'s test script with the `jest-expo`
preset (`npx expo install jest-expo jest @testing-library/react-native`
if not already present) and a minimal `mobile/jest.config.js`
(`{ preset: 'jest-expo' }`).

Run: `cd mobile && npx jest src/utils/playerSession.test.js`
Expected: FAIL with "playerSession.js not found" or similar.

- [ ] **Step 3: Implement `playerSession.js`**

Same key (`'mmh:player-session'`) and same JSON shape/validation as the
web version — only the storage calls become `await`ed and the default
`storage` parameter becomes the real `AsyncStorage` import
(`import AsyncStorage from '@react-native-async-storage/async-storage'`)
in place of `window.localStorage`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/utils/playerSession.test.js`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utils/playerSession.js mobile/src/utils/playerSession.test.js \
  mobile/jest.config.js mobile/package.json
git commit -m "Add AsyncStorage-backed player session for the mobile app"
```

---

### Task 5: Navigation shell, anonymous sign-in, Join screen

**Files:**
- Create: `mobile/src/navigation/RootNavigator.js`
- Create: `mobile/src/screens/JoinScreen.js`
- Test: `mobile/src/screens/JoinScreen.test.js`
- Modify: `mobile/App.js` (renders `RootNavigator`; Task 8 later adds
  the auto-resume decision here)

**Interfaces:**
- Consumes: Task 1's `auth`; Task 3's `callables.joinRoom`,
  `callables.requestReconnect`; Task 4's `writePlayerSession`.
- Produces: `RootNavigator` registers three routes by name —
  `'Join'`, `'ReconnectPending'` (params: `{roomID, requestId}`),
  `'Game'` (params: `{roomID}`) — Tasks 6 and 7 fill in the latter two
  screens; this task implements `'Join'` and navigates to the other two
  by name.

- [ ] **Step 1: Write the failing test for input normalization**

This is the Review Focus item on room-code/player-name casing and
whitespace. Install `@testing-library/react-native` if not already
present (Task 4 may have added it).

```js
import { render, fireEvent } from '@testing-library/react-native';
import JoinScreen from './JoinScreen';

describe('JoinScreen', () => {
    it('uppercases the room code as typed, matching the web app', () => {
        const { getByPlaceholderText } = render(<JoinScreen navigation={{ navigate: jest.fn() }} />);
        const input = getByPlaceholderText('Game ID');
        fireEvent.changeText(input, 'abc123');
        expect(input.props.value).toBe('ABC123');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/JoinScreen.test.js`
Expected: FAIL with "Cannot find module './JoinScreen'".

- [ ] **Step 3: Implement `JoinScreen.js`**

Read `src/pages/JoinGame.js` now and mirror its logic exactly: two
`TextInput`s (game code — `autoCapitalize="characters"` plus an
explicit `.toUpperCase()` transform in `onChangeText`, matching the web
version's belt-and-suspenders uppercase-as-typed; player name, `maxLength={16}`
— read the file now to confirm this exact current value rather than
assuming),
a submit handler that calls `signInAnonymously(auth)` only if
`auth.currentUser` is null, then `callables.joinRoom(roomId, playerName)`,
then `playerSession.writePlayerSession(roomId, playerName)`, then
`navigation.navigate('Game', { roomID: roomId })`. On a rejection whose
`.message` is exactly `'This game has already started.'`, instead call
`callables.requestReconnect(roomId, playerName)` and navigate to
`'ReconnectPending'` with `{roomID: roomId, requestId: data.requestId}`;
any other rejection renders its `.message` in an inline error view
(matching the web version's `Alert`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/JoinScreen.test.js`
Expected: PASS.

- [ ] **Step 5: Write `RootNavigator.js` and wire it into `App.js`**

Install `@react-navigation/native` and `@react-navigation/native-stack`
(plus their Expo-required peer deps:
`react-native-screens`, `react-native-safe-area-context`). A
`createNativeStackNavigator()` with the three routes named above;
`'Join'` as `initialRouteName` for now (Task 8 changes this to a
conditional decision).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/navigation/RootNavigator.js mobile/src/screens/JoinScreen.js \
  mobile/src/screens/JoinScreen.test.js mobile/App.js mobile/package.json
git commit -m "Add navigation shell and Join screen to the mobile app"
```

---

### Task 6: Reconnect-pending screen

**Files:**
- Create: `mobile/src/screens/ReconnectPendingScreen.js`
- Test: `mobile/src/screens/ReconnectPendingScreen.test.js`

**Interfaces:**
- Consumes: Task 3's `dbCalls.fetchReconnectRequestReferenceForRoom`;
  Task 4's `writePlayerSession`; navigates to `'Game'` (Task 7) and back
  to `'Join'` (Task 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```js
import { render, waitFor } from '@testing-library/react-native';
import { onSnapshot } from 'firebase/firestore';
import ReconnectPendingScreen from './ReconnectPendingScreen';

jest.mock('firebase/firestore');

describe('ReconnectPendingScreen', () => {
    it('navigates to Game once the request is approved', async () => {
        const navigate = jest.fn();
        onSnapshot.mockImplementation((ref, onNext) => {
            onNext({ exists: () => true, data: () => ({ status: 'approved', playerName: 'Alice' }) });
            return () => {};
        });
        render(
            <ReconnectPendingScreen
                route={{ params: { roomID: 'ROOM1', requestId: 'req1' } }}
                navigation={{ navigate }}
            />
        );
        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith('Game', { roomID: 'ROOM1' })
        );
    });

    it('shows join-specific wording when requestType is "join"', async () => {
        onSnapshot.mockImplementation((ref, onNext) => {
            onNext({ exists: () => true, data: () => ({ status: 'pending', requestType: 'join' }) });
            return () => {};
        });
        const { findByText } = render(
            <ReconnectPendingScreen
                route={{ params: { roomID: 'ROOM1', requestId: 'req1' } }}
                navigation={{ navigate: jest.fn() }}
            />
        );
        await findByText('Waiting for the host to approve your join…');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/ReconnectPendingScreen.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ReconnectPendingScreen.js`**

Read `src/pages/ReconnectPending.js` now and mirror its logic exactly:
subscribe (via `onSnapshot`) to
`dbCalls.fetchReconnectRequestReferenceForRoom(requestId, roomID)`; on
`!snapshot.exists()`, render a "denied" state with a button back to
`'Join'`; on `data.status === 'approved'`, call
`playerSession.writePlayerSession(roomID, data.playerName)` then
`navigation.navigate('Game', { roomID })`; otherwise render
`data.status` (`'pending'`/`'denied'`) as a status message, matching
the web version's three-state render. Also track `data.requestType`
(defaulting to `'reconnect'` when absent) and switch the pending/denied
copy between "...your join…"/"Your join request..." and
"...your reconnect…"/"Your reconnect request..." accordingly — this is
a real, current behavior of the web version (a player joining fresh
after the game has already started goes through this same screen with
`requestType: 'join'`, not just a returning player reconnecting), not
an extra feature to invent.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/ReconnectPendingScreen.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/ReconnectPendingScreen.js \
  mobile/src/screens/ReconnectPendingScreen.test.js
git commit -m "Add reconnect-pending screen to the mobile app"
```

---

### Task 7: Game screen shell — subscriptions, target/eliminated display, Leave, game-ended state

**Files:**
- Create: `mobile/src/screens/GameScreen.js`
- Test: `mobile/src/screens/GameScreen.test.js`

**Interfaces:**
- Consumes: Task 3's `dbCalls.{fetchRoomReferenceForRoom,
  fetchPlayerReferenceForRoom,
  fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
  fetchTasksQueryForRoom}` and `callables.leaveGame`; Task 4's
  `playerSession.{readPlayerSession, clearPlayerSession}`.
- Produces: `GameScreen` renders child slots (filled by later tasks)
  for chat (Task 9), the location/map panel (Tasks 11–12), missions/
  leaderboard entry points (Task 13), the shop entry point (Task 14),
  and the avatar button + target-photo-viewer (Task 15) — this task
  stubs those as empty `<View>`s with a comment pointing at the task
  that fills each in, so later tasks have an exact mount point without
  needing to re-read this whole file.

- [ ] **Step 1: Write the failing tests**

Two tests: the Review Focus listener-cleanup assertion, and the
target/eliminated display.

```js
import { render, waitFor } from '@testing-library/react-native';
import { onSnapshot } from 'firebase/firestore';
import GameScreen from './GameScreen';

jest.mock('firebase/firestore');

describe('GameScreen', () => {
    it('unsubscribes every live listener exactly once on unmount', () => {
        const unsubscribes = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
        let call = 0;
        onSnapshot.mockImplementation(() => unsubscribes[call++]);
        const { unmount } = render(
            <GameScreen route={{ params: { roomID: 'ROOM1' } }} navigation={{ navigate: jest.fn() }} />
        );
        unmount();
        unsubscribes.forEach((unsubscribe) => expect(unsubscribe).toHaveBeenCalledTimes(1));
    });

    it('shows the waiting-room text before the host starts the game', async () => {
        onSnapshot.mockImplementation((ref, onNext) => {
            onNext({ exists: () => true, data: () => ({ gameStarted: false, isGameActive: true }) });
            return () => {};
        });
        const { findByText } = render(
            <GameScreen route={{ params: { roomID: 'ROOM1' } }} navigation={{ navigate: jest.fn() }} />
        );
        await findByText('Waiting for the host to start...');
    });

    it('shows the eliminated heading once the player is marked dead', async () => {
        // Drive the room-doc snapshot to {gameStarted: true, isGameActive:
        // true} and the player-doc snapshot to {isAlive: false} through
        // the mocked onSnapshot calls (two separate listeners — see the
        // player-doc subscription in Step 3), then assert:
        const { findByText } = render(
            <GameScreen route={{ params: { roomID: 'ROOM1' } }} navigation={{ navigate: jest.fn() }} />
        );
        await findByText("YOU'VE BEEN ELIMINATED");
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/screens/GameScreen.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GameScreen.js`**

Read `src/pages/PlayerGame.js` now in full, and also
`src/components/player_game/{PlayerGameHeader,PlayerGameDialogs,
PlayerGameStatusNotices,PlayerBoundaryPanel,PlayerRulesModal}.js` —
`PlayerGame.js`'s own logic is split across these five files today;
read all six before writing anything, not `PlayerGame.js` alone.
Mirror the following, for this task's scope only (chat/location/
missions/leaderboard/shop/avatar are explicitly out — later tasks):
- The room-doc subscription, including the `handleSubscriptionError`
  pattern (clear the session via `playerSession.clearPlayerSession`,
  navigate back to `'Join'`) on a missing room or a permission error.
- The player-doc subscription (only once `gameStarted` is true, same
  gate as the web version), same `handleSubscriptionError` on a missing
  player doc.
- The waiting-room state: while `!gameStarted`, render
  `"Waiting for the host to start..."` and nothing else from the list
  below (same as the web version — this is what makes `GameScreen`
  double as both the waiting room and the main game screen, exactly
  like `PlayerGame.js` does).
- The players-query and tasks-query subscriptions (needed by Task 9's
  chat composer and Task 13's missions list — mount them here, pass
  down as props to the stubbed child slots).
- Eliminated display (ported from `PlayerGameStatusNotices.js`):
  `"YOU'VE BEEN ELIMINATED"` heading (color `red.500`) +
  `"Be on the lookout for revival missions to get back in."` — exact
  copy, read the file now to confirm it hasn't drifted further.
- Leave button + confirm dialog (use `Alert.alert` with two buttons,
  the RN equivalent of the web's `AlertDialog`) calling
  `callables.leaveGame(roomID)`, then `clearPlayerSession()`, then
  `navigation.navigate('Join')`.
- Game-ended banner (persistent, matching the web's pinned red banner)
  once `isGameActive` is false — chat (Task 9) stays mounted regardless.
- A Rules button in the header opening a Game Rules modal: port
  `PlayerRulesModal.js` verbatim (it is pure static copy — targets,
  missions/points, avatars, zones, shop, safety, and
  "if you are eliminated" sections; read the file now for the exact
  text) to a RN `Modal`/`ScrollView`. This has no test of its own
  beyond "the button opens it" (covered by this task's existing
  render-based tests needing no new case) — there is no logic in this
  component to pin with an assertion.
- The target-list display itself (the accordion UI is Task 15's to
  build, since it's tightly coupled to avatars — this task only needs
  to pass `players`/`playerData.targets` down to the slot Task 15
  fills).
- Every `useEffect` that calls `onSnapshot` must return its unsubscribe
  function, and must not re-subscribe on every render (same dependency-
  array discipline as the web version) — this is what the Step 1
  listener-cleanup test is pinning down.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/screens/GameScreen.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/GameScreen.js mobile/src/screens/GameScreen.test.js
git commit -m "Add Game screen shell: subscriptions, target display, leave flow, game-ended state"
```

---

### Task 8: Session auto-resume on launch

**Files:**
- Modify: `mobile/App.js`
- Test: `mobile/App.test.js`

**Interfaces:**
- Consumes: Task 4's `playerSession.readPlayerSession`; Task 1's
  `auth`; navigates to `'Join'` or `'Game'` (Tasks 5 and 7).

- [ ] **Step 1: Write the failing tests**

```js
import { render, waitFor } from '@testing-library/react-native';
import App from './App';
import { readPlayerSession } from './src/utils/playerSession';
import { auth } from './src/firebase/firebaseConfig';

jest.mock('./src/utils/playerSession');
jest.mock('./src/firebase/firebaseConfig');

describe('App launch', () => {
    it('resumes straight into the Game screen with a valid stored session', async () => {
        readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
        auth.currentUser = { uid: 'uid1' };
        const { findByTestId } = render(<App />);
        await findByTestId('game-screen');
    });

    it('shows the Join screen with no stored session', async () => {
        readPlayerSession.mockResolvedValue(null);
        auth.currentUser = null;
        const { findByTestId } = render(<App />);
        await findByTestId('join-screen');
    });

    it('shows the Join screen when a session is stored but there is no signed-in user', async () => {
        readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
        auth.currentUser = null;
        const { findByTestId } = render(<App />);
        await findByTestId('join-screen');
    });
});
```

Add `testID="game-screen"`/`testID="join-screen"` to each screen's root
element now, if not already present from Tasks 5/7.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest App.test.js`
Expected: FAIL — `App` doesn't yet make this decision.

- [ ] **Step 3: Implement the resume decision in `App.js`**

On mount, call `playerSession.readPlayerSession()`; once resolved,
render `RootNavigator` with `initialRouteName` set to `'Game'` (with
`initialParams={{roomID: session.roomID}}`) when both
`session !== null` and `auth.currentUser !== null`, else `'Join'`.
Render nothing (or a blank splash) while that read is in flight — same
"decide before rendering the real screen" shape as a typical RN
launch-time auth check. `GameScreen`'s own
`handleSubscriptionError`-equivalent (Task 7, Step 3) already covers
the case where the resumed room/player no longer exists, so this task
does not re-validate that itself — it only decides which screen to
show first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest App.test.js`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add mobile/App.js mobile/App.test.js
git commit -m "Resume straight into the game on launch when a valid session is stored"
```

---

### Task 9: Chat feed and composer (text only)

**Files:**
- Create: `mobile/src/screens/components/ChatFeed.js`
- Create: `mobile/src/screens/components/ChatComposer.js`
- Create: `mobile/src/screens/components/MessageBubble.js`
- Test: `mobile/src/screens/components/ChatFeed.test.js`
- Test: `mobile/src/screens/components/ChatComposer.test.js`
- Modify: `mobile/src/screens/GameScreen.js` (mounts both, replacing
  the chat stub from Task 7)

**Interfaces:**
- Consumes: Task 3's `dbCalls.fetchPlayerMessagesQueryForRoom` and
  `callables.submitChatMessage`; the shared
  `src/utils/applyMessageChanges.js` (Task 2).
- Produces: `ChatFeed` takes the same props as the web `MessageFeed.js`
  (`roomID`, `playerName`, `pendingMessages`,
  `onPendingMessageConfirmed`, `onShowPings` — the last one wired up in
  Task 12); `ChatComposer` takes the same props as the web
  `MessageComposer.js` minus the camera-related ones (`players`,
  `missions`, `cameraBlockedUntil` arrive in Task 10 alongside the
  camera button).

- [ ] **Step 1: Write the failing tests**

`ChatFeed.test.js`: mirror the web `MessageFeed.test.jsx`'s core case —
a message whose sender matches `playerName` renders via the "mine"
styling path; a `whisper`/`broadcast` message renders the "GM:" label.
`ChatComposer.test.js`: typing text and pressing Send calls
`callables.submitChatMessage({roomId, text})` with the typed text,
trimmed, and calls `onOptimisticSend` before the call resolves.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/screens/components/ChatFeed.test.js
src/screens/components/ChatComposer.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `MessageBubble.js`**

Read `src/components/player_messages_components/MessageBubble.js` now
and port every branch (`leaderboard`, `mission`, `killPhoto`,
`powerUpPing`, `whisper`/`broadcast`, `chat`, and the fallback) to RN
`View`/`Text`/`Image` with `StyleSheet`, using the exact color tokens
listed in Global Constraints for each branch. `gameEndedLeaderboard`'s
own sub-component (`GameEndedLeaderboardBubble.js`) is in scope for
Task 13 (it shares the leaderboard-standings shape) — stub that one
branch as plain text for now with a comment pointing at Task 13.

- [ ] **Step 4: Implement `ChatFeed.js`**

Read `src/components/player_messages_components/MessageFeed.js` now
and port its logic: subscribe via `onSnapshot` to
`dbCalls.fetchPlayerMessagesQueryForRoom(roomID)`, merge via the shared
`applyMessageChanges(previous, snapshot.docChanges())`, filter to
`!recipient || recipient === playerName` (case-insensitive, via the
shared `normalizePlayerName` from `src/game/playerNames.js`), render
with a `FlatList` (RN's equivalent of the web's scrolling `Box`) that
auto-scrolls to the end on new messages, append `pendingMessages` after
the filtered list, and call `onPendingMessageConfirmed` the moment a
`type: 'chat'` message whose sender matches `playerName` arrives.

- [ ] **Step 5: Implement `ChatComposer.js`**

Read `src/components/player_messages_components/MessageComposer.js`
now and port its text-sending logic only (`handleSend`,
`handleKeyDown`'s RN equivalent — a `TextInput`'s `onSubmitEditing`):
build the same `pendingId`/pending-message shape, call
`onOptimisticSend`, call `callables.submitChatMessage`, and on
rejection restore the typed text and call `onOptimisticSendFailed`.
Render the camera button as disabled/absent for now — Task 10 fills it
in.

- [ ] **Step 6: Mount both in `GameScreen.js`, lifting `pendingMessages`
  state the same way `PlayerGame.js` does**

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/screens/components/ChatFeed.test.js
src/screens/components/ChatComposer.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/screens/components/ChatFeed.js \
  mobile/src/screens/components/ChatComposer.js \
  mobile/src/screens/components/MessageBubble.js \
  mobile/src/screens/components/ChatFeed.test.js \
  mobile/src/screens/components/ChatComposer.test.js \
  mobile/src/screens/GameScreen.js
git commit -m "Add text chat feed and composer to the mobile game screen"
```

---

### Task 10: Kill-photo / mission-photo capture, compression, claim picker, submission

**Files:**
- Create: `mobile/src/screens/components/KillPhotoModal.js`
- Modify: `mobile/src/screens/components/ChatComposer.js` (adds the
  camera button and capture/compress/submit flow)
- Test: `mobile/src/screens/components/KillPhotoModal.test.js`
- Test (modified): `mobile/src/screens/components/ChatComposer.test.js`

**Interfaces:**
- Consumes: Task 3's `callables.submitKillPhoto` and
  `storageCalls.uploadKillPhoto`; the shared
  `src/game/photoClaimOptions.js`'s `buildPhotoClaimOptions` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test for `KillPhotoModal`**

Read `src/components/player_messages_components/KillPhotoModal.js`
now — it has a "Just for fun" option always available alongside any
real target/mission claims (under a "Socials" group in the web
picker), not just a kill/mission choice. Mirror its current cases:
zero target/mission options still enables Submit, defaulted to `'fun'`,
with the message "No open targets or missions; this will be a fun
photo." (not a disabled-Submit state — that behavior is gone); one or
more real options plus the always-present fun option render a picker,
defaulting to the first real option if any exist, else to `'fun'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/components/KillPhotoModal.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `KillPhotoModal.js`**

Port the file read in Step 1 to a RN `Modal`: the same
`buildPhotoClaimOptions` call, plus the always-present `{value: 'fun',
label: 'Just for fun'}` option the web version adds directly in the
component (not from `buildPhotoClaimOptions` — that function only ever
returns real target/mission options); a native picker (e.g.
`@react-native-picker/picker` if installed, or a custom list — the
behavior being tested is the option set and the default selection, not
the exact picker widget) grouped the same way (Kill Target / Mission /
Socials); Submit disabled only while `!previewUrl` (a selection always
exists now, since `'fun'` is always a valid fallback).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/components/KillPhotoModal.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the capture/compress/submit flow**

```js
// in ChatComposer.test.js, extending Task 9's file
it('compresses a captured photo before uploading it', async () => {
    // mock expo-image-picker's launchCameraAsync to resolve with a
    // local file uri, mock expo-image-manipulator's manipulateAsync to
    // resolve with a smaller uri, and assert storageCalls.uploadKillPhoto
    // is called with a Blob built from the MANIPULATED uri, not the
    // original capture.
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/components/ChatComposer.test.js`
Expected: FAIL.

- [ ] **Step 7: Implement the camera button and its flow in
  `ChatComposer.js`**

Install `expo-image-picker` and `expo-image-manipulator`. Read the
current `src/components/player_messages_components/MessageComposer.js`
now: the camera button takes a `locationEnabled` prop (passed from
`GameScreen` as `permissionState === 'granted'`, from Task 11's hook)
and is disabled whenever `!locationEnabled`, in addition to the
existing `disabled`/`!isGameActive`/`cameraBlocked` conditions — port
this exact gate, even though it means the button stays disabled in a
room with no boundary/zones enabled at all (boundaryless rooms never
move `permissionState` past `'unknown'`, since Task 11's hook only
starts tracking once a boundary exists) — that is the current,
real behavior of the web app, not a bug this plan is fixing. On
tapping the camera button (disabled when `cameraBlocked`, same
`isCameraBlocked(blockedUntilMs, nowMs)` check from the shared
`src/game/powerUpEffects.js` as the web version): call
`ImagePicker.launchCameraAsync({mediaTypes: ImagePicker.MediaTypeOptions.Images})`;
on a result, call `ImageManipulator.manipulateAsync(uri, [{resize:
{width: 1600}}], {compress: 0.8, format: ImageManipulator.SaveFormat.JPEG})`
— the same `MAX_DIMENSION`/`JPEG_QUALITY` values as the web
`compressImage.js`, read now for the exact numbers — open
`KillPhotoModal` with the manipulated result's `uri` as the preview; on
Submit, derive `target`/`mission`/`isFunPhoto` from the picker's
selected value the same way the web version's `handlePhotoSubmit`
does (`target:`/`mission:` prefixes, or `isFunPhoto = claimValue ===
'fun'`), convert the `uri` to a `Blob` (`await (await
fetch(uri)).blob()`), call `storageCalls.uploadKillPhoto(roomID, blob)`,
then `callables.submitKillPhoto({roomId, url, target, mission,
isFunPhoto})` — same error handling as the web version (log + a visible alert on rejection,
since the modal has already closed by the time a network call could
fail, matching the web version's own "assume success, alert on
failure" design named in the spec's Review Focus).

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/components/ChatComposer.test.js`
Expected: PASS.

- [ ] **Step 9: Manual verification (per this plan's Review Focus item
  on backgrounding mid-upload)**

On a real device: capture a photo, tap Submit, then immediately
background the app (home button/swipe) before the upload could
plausibly finish. Reopen the app and check whether the submission
landed (Firebase console / GM console). Record the actual behavior as
a code comment next to the Submit handler — whichever way it goes, a
future reader should not have to re-discover this by testing it again.

- [ ] **Step 10: Commit**

```bash
git add mobile/src/screens/components/KillPhotoModal.js \
  mobile/src/screens/components/KillPhotoModal.test.js \
  mobile/src/screens/components/ChatComposer.js \
  mobile/src/screens/components/ChatComposer.test.js
git commit -m "Add camera capture, compression, and kill/mission-photo submission to the mobile chat composer"
```

---

### Task 11: Location/boundary status hook and status panel

**Files:**
- Create: `mobile/src/hooks/useBoundaryLocation.js`
- Create: `mobile/src/screens/components/LocationStatusPanel.js`
- Test: `mobile/src/hooks/useBoundaryLocation.test.js`
- Test: `mobile/src/screens/components/LocationStatusPanel.test.js`
- Modify: `mobile/src/screens/GameScreen.js` (mounts the hook + panel,
  replacing the location stub from Task 7)

**Interfaces:**
- Consumes: Task 3's `callables.reportPlayerLocation` and
  `dbCalls.{fetchBoundaryStatusReferenceForPlayer,
  fetchOutsideBoundaryStatusesQueryForRoom}`; the shared
  `src/game/locationReportCadence.js` (`shouldSendFix`, `isPollDue`) and
  `src/game/gameBoundary.js` (`deriveFreshStatus`, `isPositionFresh`,
  `canSee`, `GAME_BOUNDARY_CONFIG`) (Task 2).
- Produces: `useBoundaryLocation({roomID, boundaryRevision,
  boundaryEnabled, isGameActive, isAlive})` returns
  `{permissionState, ownPosition, requestPermission}` — same shape as
  the web hook (`lastResult` is dropped; nothing in this plan's scope
  reads it, same as the web version, where only `PlayerGame.js`'s own
  internal bookkeeping touches it). Consumed by Task 12's map.

- [ ] **Step 1: Write the failing tests for the hook**

Read `src/hooks/useBoundaryLocation.test.js` now (if one exists; if
not, write cases covering the same scenarios its header comment
describes) and port its cases, substituting mocked `expo-location`
calls (`Location.watchPositionAsync`, `Location.getCurrentPositionAsync`,
`Location.requestForegroundPermissionsAsync`) for the web version's
mocked `navigator.geolocation`. Explicitly include the two Review Focus
cases:
- Calling `requestPermission()` after a `PERMISSION_DENIED` result
  actually re-requests permission and, once granted, resumes reporting
  (not just "calls the right mock" — assert a subsequent position
  update results in a `reportPlayerLocation` call).
- Returning to the foreground (simulate via `AppState`'s change-event
  mock firing `'active'`) triggers a fresh one-shot position request,
  the same way the web hook's `visibilitychange` handler does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/hooks/useBoundaryLocation.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useBoundaryLocation.js`**

Read `src/hooks/useBoundaryLocation.js` now in full and port its
structure: `permissionState`/`enabled`/`ownPosition`/`watchEpoch`
state, the same `isTrackingActive` derivation, `sendReport`/
`handlePosition`/`handlePositionError` callbacks calling
`callables.reportPlayerLocation` and the shared `shouldSendFix`. Swap
browser APIs for `expo-location`: `requestPermission` calls
`Location.requestForegroundPermissionsAsync()`; the watch effect calls
`Location.watchPositionAsync({accuracy: Location.Accuracy.High,
timeInterval: 0, distanceInterval: 0}, handlePosition)` (returns a
subscription object with `.remove()`, in place of `clearWatch`);
`requestFreshFix` calls `Location.getCurrentPositionAsync({accuracy:
Location.Accuracy.High})` wrapped in the same `oneShotInFlightRef`
in-flight guard, with a manual `Promise.race` against a 10-second
timeout (`ONE_SHOT_TIMEOUT_MS`, same value as the web version) since
`getCurrentPositionAsync` has no built-in timeout option the way the
browser API does. Replace the `visibilitychange` listener with an
`AppState.addEventListener('change', ...)` handler that calls
`requestFreshFix()` when the new state is `'active'`, gated the same
way (skip while `permissionState === 'denied'`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/hooks/useBoundaryLocation.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `LocationStatusPanel`**

Read `src/components/player_game/PlayerBoundaryPanel.js` now — this is
where the status-rendering logic actually lives today (moved out of
`PlayerGame.js` itself), and it added one behavior since the design
doc was written: the `inside` status renders in a dismissible banner
(`green.800` background, an X button) that, once dismissed, stays
hidden until `liveBoundaryStatus.status` changes away from `'inside'`
and back. Mirror its rendering logic for one representative case per
status (`inside` — both not-yet-dismissed and dismissed, `near` with
the countdown, `outside`, each `unavailable` reason's exact text from
`UNAVAILABLE_REASON_TEXT`).

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/components/LocationStatusPanel.test.js`
Expected: FAIL.

- [ ] **Step 7: Implement `LocationStatusPanel.js`**

Port the status-rendering block from `PlayerBoundaryPanel.js` (the
`UNAVAILABLE_REASON_TEXT` map and `DEFAULT_UNAVAILABLE_TEXT`/
`UNAVAILABLE_RETRY_REASONS` constants live in `src/pages/PlayerGame.js`
— both files are needed) to RN `View`/`Text`/`Button`, same exact copy
and the same Global-Constraints color tokens (`blue.900` prompt,
`orange.800` denied/unavailable, `orange.700` approaching-exposure,
`red.900` outside, `green.800` inside — with the dismiss button from
Step 5, using a local `isInsideStatusDismissed` state reset whenever
`liveBoundaryStatus.status` changes away from `'inside'`, same as the
web version).

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/components/LocationStatusPanel.test.js`
Expected: PASS.

- [ ] **Step 9: Mount both in `GameScreen.js`**

Same gating as the web version: mounted once `gameBoundary?.enabled`
and the player is alive, independent of whether the map (Task 12) is
open.

- [ ] **Step 10: Commit**

```bash
git add mobile/src/hooks/useBoundaryLocation.js \
  mobile/src/hooks/useBoundaryLocation.test.js \
  mobile/src/screens/components/LocationStatusPanel.js \
  mobile/src/screens/components/LocationStatusPanel.test.js \
  mobile/src/screens/GameScreen.js
git commit -m "Add location/boundary status tracking and status panel to the mobile app"
```

---

### Task 12: Native boundary map

**Files:**
- Create: `mobile/src/screens/components/GameMapModal.js`
- Test: `mobile/src/screens/components/GameMapModal.test.js`
- Modify: `mobile/src/screens/GameScreen.js` (wires `onShowPings` from
  Task 9's `ChatFeed` to open this modal, replacing the map stub from
  Task 7)

**Interfaces:**
- Consumes: Task 11's `ownPosition`; Task 3's
  `dbCalls.fetchOutsideBoundaryStatusesQueryForRoom`; the shared
  `src/game/gameBoundary.js`'s `canSee`/`isPositionFresh` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Mirror the web `PlayerMapModal`'s contract: given `boundaryVertices`,
`ownPosition`, and `otherPositions`, the rendered map (mock
`react-native-maps`' `MapView`/`Polygon`/`Marker` in the test, same
approach the web tests take mocking `react-map-gl`) receives a
`Polygon` with the boundary's coordinates and one `Marker` per position
passed in.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/components/GameMapModal.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GameMapModal.js`**

Install `react-native-maps`. Read `src/components/map_components/
{GameMap.js, PlayerMapModal.js}` now and port: a `MapView` with a
`Polygon` for `boundaryVertices` (note the coordinate-order flip — RN
Maps' `Polygon` takes `{latitude, longitude}` objects, whereas the web
`toGeoJson` helper deliberately flips to GeoJSON's `[lng, lat]`; this
port does not need that flip at all, since it never produces GeoJSON),
a `Marker` for `ownPosition` and one per `otherPositions` entry
(labeled, matching the web's always-visible-label marker style via a
custom marker view), a "Recenter on Me" button calling the map ref's
`animateToRegion`, and the `statusText` banner passed straight through
from `GameScreen` (Task 11's panel), rendered above the map the same
way `PlayerMapModal.js` does.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/components/GameMapModal.test.js`
Expected: PASS.

- [ ] **Step 5: Wire `onShowPings` through from `ChatFeed`/
  `MessageBubble`'s `powerUpPing` branch (Task 9) to open this modal
  with the ping's positions, matching the web version exactly**

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/components/GameMapModal.js \
  mobile/src/screens/components/GameMapModal.test.js \
  mobile/src/screens/GameScreen.js
git commit -m "Add native boundary map to the mobile app"
```

---

### Task 13: Missions list and leaderboard screens

**Files:**
- Create: `mobile/src/screens/components/MissionsModal.js`
- Create: `mobile/src/screens/components/LeaderboardModal.js`
- Test: `mobile/src/screens/components/MissionsModal.test.js`
- Test: `mobile/src/screens/components/LeaderboardModal.test.js`
- Modify: `mobile/src/screens/components/MessageBubble.js` (fills in
  the `gameEndedLeaderboard` branch stubbed in Task 9, reusing
  `LeaderboardModal`'s standings-rendering logic)
- Modify: `mobile/src/screens/GameScreen.js` (wires both into the
  Missions/Leaderboard buttons stubbed in Task 7)

**Interfaces:**
- Consumes: Task 7's `missions` (from the tasks-query subscription
  already mounted in `GameScreen`) and `players`; the shared
  `src/game/leaderboard.js`'s `buildLeaderboardStandings` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

`MissionsModal.test.js`: given a `missions` array, renders each
mission's title/description/task-type/point-value/completion-limit
text, matching `MessageBubble.js`'s `mission` branch copy exactly (read
it now for the exact string: `"{taskType} · {pointValue} points ·
{maxCompletions ? 'Limited to N players' : 'Unlimited players'}"`).
`LeaderboardModal.test.js`: given `standings` (the shape
`buildLeaderboardStandings` returns), renders each entry as
`"{index+1}. {name} — {score}"` plus `" (eliminated)"` when
`!isAlive`, matching the web version exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/screens/components/MissionsModal.test.js
src/screens/components/LeaderboardModal.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both modals**

Read `src/components/task_components/PlayerTaskListModal.js` (and the
`PlayerTaskList` it wraps) and
`src/components/game_end_components/LeaderboardModal.js` now and port
each to a RN `Modal` + `FlatList`, read-only, same copy, same
Global-Constraints `#202030` background.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/screens/components/MissionsModal.test.js
src/screens/components/LeaderboardModal.test.js`
Expected: PASS.

- [ ] **Step 5: Fill in `MessageBubble.js`'s `gameEndedLeaderboard`
  branch, reusing the same standings-rendering logic as
  `LeaderboardModal.js`**

- [ ] **Step 6: Wire both modals into `GameScreen.js`'s Missions/
  Leaderboard buttons**

- [ ] **Step 7: Commit**

```bash
git add mobile/src/screens/components/MissionsModal.js \
  mobile/src/screens/components/LeaderboardModal.js \
  mobile/src/screens/components/MissionsModal.test.js \
  mobile/src/screens/components/LeaderboardModal.test.js \
  mobile/src/screens/components/MessageBubble.js \
  mobile/src/screens/GameScreen.js
git commit -m "Add missions list and leaderboard screens to the mobile app"
```

---

### Task 14: Power-up shop screen

**Files:**
- Create: `mobile/src/screens/components/PowerUpShopModal.js`
- Test: `mobile/src/screens/components/PowerUpShopModal.test.js`
- Modify: `mobile/src/screens/GameScreen.js` (wires the Shop button
  stubbed in Task 7; this is the single most UI-complex screen in the
  app and is deliberately built last, once every supporting piece — the
  players list, the chat feed a ping posts into, the map a ping's
  "View on map" opens — already exists end-to-end from earlier tasks)

**Interfaces:**
- Consumes: Task 3's `callables.{purchasePowerUp, claimMysteryReward}`;
  Task 7's `players` and the player doc's `score`/`cooldowns`/
  `horcruxActive`/`pendingMysteryItem` fields, plus
  `gameBoundary?.enabled === true` (passed down as `zonesEnabled` — see
  Step 3); the shared `src/game/powerUps.js`'s `POWER_UPS`,
  `cooldownRemaining`, `purchaseBlockReason` and
  `src/game/powerUpEffects.js`'s `isHorcruxActive` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Mirror the web `PowerUpShopModal`'s core cases: a disabled item shows
`purchaseBlockReason`'s text; tapping Buy on an enabled item calls
`callables.purchasePowerUp({roomId, itemId, targetName})`; a mystery
box result containing `mysteryBox` opens the reveal with its label.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/screens/components/PowerUpShopModal.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PowerUpShopModal.js`**

Read `src/components/shop_components/{PowerUpShopModal.js,
ShopItemCard.js, MysteryBoxReveal.js}` now and port the full flow: a
`FlatList`/`SimpleGrid`-equivalent grid of `POWER_UPS`, each card
showing its cooldown countdown (re-rendering once a second only while
the modal is open, same as the web version), a player picker for
items where `item.needsTarget` (a native `Picker`/custom list, same
filtering — alive, not self), the mystery-box reveal flow calling
`claimMysteryReward` when a target is needed. Also port the
`zonesEnabled` prop (default `true` in the web version, but
`GameScreen` always passes a real value, same as `canShop`): thread it
into `purchaseBlockReason`'s `boundaryEnabled` argument, and disable/
hide the pending-mystery-reward claim button when the rolled item
`requiresGameBoundary === true` and `!zonesEnabled` — read the exact
current gating logic in `PowerUpShopModal.js` now rather than guessing
its shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/screens/components/PowerUpShopModal.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into `GameScreen.js`'s Shop button, same
  `canShop` gate as the web version (`gameStarted && isGameActive &&
  playerData?.isAlive === true`)**

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/components/PowerUpShopModal.js \
  mobile/src/screens/components/PowerUpShopModal.test.js \
  mobile/src/screens/GameScreen.js
git commit -m "Add power-up shop screen to the mobile app"
```

---

### Task 15: Player avatar — capture, upload, display, target photo viewer

**Files:**
- Create: `mobile/src/screens/components/AvatarButton.js`
- Create: `mobile/src/screens/components/TargetPhotoModal.js`
- Test: `mobile/src/screens/components/AvatarButton.test.js`
- Test: `mobile/src/screens/components/TargetPhotoModal.test.js`
- Modify: `mobile/src/firebase/storageCalls.js` (adds
  `uploadPlayerAvatar`)
- Modify: `mobile/src/screens/GameScreen.js` (wires the avatar button
  into the header and the target list into an accordion that opens
  `TargetPhotoModal`, replacing the plain-text target display and the
  avatar/target-photo stubs from Task 7)

**Interfaces:**
- Consumes: Task 3's `dbCalls.fetchPlayerReferenceForRoom` (for the
  direct `updateDoc` call below) and `storage` (via this task's own
  new `storageCalls.uploadPlayerAvatar`); Task 7's `players` and
  `playerData`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test for `uploadPlayerAvatar`**

Read `src/components/firebase_calls/storageCalls.js`'s current
`uploadPlayerAvatar(roomID, uid, photoBlob)` now — it uploads to
`rooms/{roomID}/avatars/{uid}` (no file extension, unlike
`uploadKillPhoto`'s `.jpg` suffix — read the file now to confirm this
exactly, rather than assuming the same naming scheme applies) and
returns the download URL. No dedicated unit test (per Global
Constraints, thin SDK wrappers aren't unit tested) — add it to
`mobile/src/firebase/storageCalls.js` directly.

- [ ] **Step 2: Implement `uploadPlayerAvatar` in
  `mobile/src/firebase/storageCalls.js`**

```js
export const uploadPlayerAvatar = async (roomID, uid, photoBlob) => {
    const photoRef = ref(storage, `rooms/${roomID}/avatars/${uid}`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
```

- [ ] **Step 3: Write the failing test for `AvatarButton`**

```js
it('uploads a captured selfie and writes avatarUrl onto the player doc', async () => {
    // mock expo-image-picker's launchCameraAsync (front camera —
    // cameraType: ImagePicker.CameraType.front, matching the web
    // version's capture="user"), expo-image-manipulator's
    // manipulateAsync, storageCalls.uploadPlayerAvatar resolving with
    // a URL, and updateDoc; assert updateDoc was called with
    // { avatarUrl: <that URL> } against
    // dbCalls.fetchPlayerReferenceForRoom(playerName, roomID).
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/components/AvatarButton.test.js`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `AvatarButton.js`**

Read `src/components/player_game/PlayerGameHeader.js`'s own-avatar
button (`handleAvatarChange` lives in `src/pages/PlayerGame.js` itself
— read that too) now and port: an `Image`/placeholder showing
`playerData.avatarUrl` or a generic placeholder when absent, tapped to
launch `ImagePicker.launchCameraAsync({cameraType:
ImagePicker.CameraType.front})`, then the same
`expo-image-manipulator` resize/compress step Task 10 already
introduced (same `MAX_DIMENSION`/`JPEG_QUALITY` values — reuse, don't
redefine), then this task's own `uploadPlayerAvatar`, then
`updateDoc(dbCalls.fetchPlayerReferenceForRoom(playerName, roomID),
{avatarUrl})` directly (no Cloud Function — this exact direct write is
what the existing `firestore.rules` clause permits, and is what the
web version does). Show a loading state while in flight (mirroring
`avatarBusy`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/components/AvatarButton.test.js`
Expected: PASS.

- [ ] **Step 7: Write the failing test for `TargetPhotoModal`**

Mirror `PlayerGameHeader.js`'s target-photo-viewer modal: given a
target with `avatarUrl` set, renders the image; given one without,
renders `"This player has not added a photo yet."` (read the file now
for this exact string).

- [ ] **Step 8: Run the test to verify it fails**

Run: `cd mobile && npx jest src/screens/components/TargetPhotoModal.test.js`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement `TargetPhotoModal.js`**

Port the modal directly from `PlayerGameHeader.js`'s
`isTargetPhotoOpen` block.

- [ ] **Step 10: Run the test to verify it passes**

Run: `cd mobile && npx jest src/screens/components/TargetPhotoModal.test.js`
Expected: PASS.

- [ ] **Step 11: Wire into `GameScreen.js`**

Read `PlayerGameHeader.js`'s target-list accordion now and port it:
each target rendered as a button with their avatar (or a
name-initials placeholder — RN has no direct equivalent of Chakra's
`Avatar` `name` fallback, so render the initial letter(s) manually
when `avatarUrl` is absent) that opens `TargetPhotoModal` for that
target. Mount the own-avatar `AvatarButton` in the header next to the
existing Leave/Rules buttons from Task 7.

- [ ] **Step 12: Commit**

```bash
git add mobile/src/screens/components/AvatarButton.js \
  mobile/src/screens/components/TargetPhotoModal.js \
  mobile/src/screens/components/AvatarButton.test.js \
  mobile/src/screens/components/TargetPhotoModal.test.js \
  mobile/src/firebase/storageCalls.js mobile/src/screens/GameScreen.js
git commit -m "Add player avatar capture/upload/display and the target photo viewer to the mobile app"
```

---

### Task 16: Docs update and full-parity manual QA pass

**Files:**
- Modify: `docs/architecture.md` (the "Player mobile app (aspirational
  — does not exist)" box and its surrounding prose)
- Modify: `docs/data-model.md` (if any field read by the mobile app
  turns out to need a documentation fix discovered during manual QA —
  expected to be none, since no schema changed, but this task is where
  such a fix would land if found)

**Interfaces:**
- Consumes: the finished app from every prior task.

- [ ] **Step 1: Update `docs/architecture.md`**

Read the current "System context" section now (the box diagram and the
two paragraphs following it). Replace "Player mobile app (aspirational
— does not exist)" with a short factual description: a React Native
(Expo) app, in `mobile/`, calling the same Cloud Functions and
Firestore collections the web player experience does — reference
`docs/superpowers/specs/2026-11-05-react-native-player-app-design.md`
for the full design, the same way other entries in this file reference
their own specs. Remove the "nothing in this repository writes it" /
"treat as unknowns" framing for `photos` and `playerMessages`, since a
real writer/reader now exists.

- [ ] **Step 2: Full manual parity pass**

Install the app on the test iPhone (Expo dev client) and a real test
room. Work through every item in the design doc's "Scope: player
features" list end to end against the real backend (not mocks):
join → waiting room → set an avatar before the game starts → game
start → see target (tap a target's avatar to view their photo) → send
chat → receive a GM broadcast and whisper from the web GM console →
take and submit a kill photo → take and submit a mission photo → take
and submit a "just for fun" photo with no target/mission claimed →
enable location and confirm inside/near/outside status text and the
map, including dismissing the "inside" banner → view the Game Rules
modal → view missions → view leaderboard → buy at least one power-up
of each `needsTarget` true/false shape, including one gated on
zones/boundary being enabled → trigger a mystery box → get eliminated
and confirm the eliminated state → have the GM end the game and
confirm the game-ended banner, with chat still usable → leave the
game. Also
exercise this plan's own Review Focus items manually: deny location
permission then grant it from OS Settings while the app is still
running; lock and unlock the phone while location tracking is active;
background the app immediately after submitting a kill photo; join,
leave, and rejoin the same room several times in a row while watching
for any duplicate/accumulating Firestore read activity in the Firebase
console's usage dashboard.

Fix anything this pass turns up before moving on — this step has no
fixed "done" output beyond "every item above works against the real
backend," so file any fix as part of this task's own commit rather than
a new task.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/data-model.md
git commit -m "Document the mobile player app in architecture.md; fix issues found in full-parity manual QA"
```

---

## Logistics outside this plan's code (track, don't block on)

Two items from the design doc's "Rollout and submission logistics"
section are the project owner's own to-dos, not implementation tasks —
noted here so they aren't lost, but they do not gate any task above and
have no code or tests of their own:

- Enroll in the Apple Developer Program and Google Play Console (the
  design doc flags this as "start early" — Apple's enrollment can take
  a day or two to clear). Needed only at EAS Build/store-submission
  time, not for any task above.
- Set up and maintain a standing demo room with a fixed, always-active
  game code for App Store reviewer access (see Global Constraints —
  `cleanupEndedRooms` will never sweep it on its own). Needed only at
  submission time.
