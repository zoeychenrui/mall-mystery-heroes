# Exposure Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminated players stop being tracked and exposed; a confirmed-outside player's exposure clears cleanly (not just hidden client-side) the instant the GM disables the boundary or ends the game, rather than persisting indefinitely in Firestore. Separately, two map-label UX fixes: the GM's hover-to-see-a-name delay is shortened and the name is shown larger, and a regular player's own map now shows exposed players' names too — always visible, not hover-gated, since realistically few players are ever exposed at once.

**Architecture:** One small shared helper clears every exposed status in a room inside an existing or new transaction. `disableGameBoundary` (already transactional) gets one more step added to its existing transaction. "End Game" currently has no Cloud Function at all — just a raw client write — so it gets a new one, which also uses the shared helper. `killPlayer` (already transactional) clears just the one victim's own exposure. The location-tracking hook stops running entirely for a dead player, so no further reports are even sent. Separately: `GameMap.js`'s hover-to-reveal-name mechanism is rewritten from the browser's native `title` attribute (which cannot be sped up or resized) to a real rendered Chakra `Tooltip`, and gains a second, independent "always show this label" mode used only by a player's own view of other exposed players.

**Tech Stack:** Firebase Cloud Functions (Admin SDK, `onCall`), Firestore transactions, React hooks.

**Spec:** No separate design doc — this is a bounded follow-up to `docs/superpowers/specs/2026-10-12-live-location-visibility-design.md`, confirmed directly with the user in chat (not a new architectural decision; see that spec's own "Data flow"/"Error handling" sections for the exposure semantics this plan completes).

## Global Constraints

- **Boundary revision changes are explicitly NOT in this plan's scope.** The user confirmed a republished (still-enabled) boundary already resumes tracking correctly via Phase 3's existing revision-mismatch/immediate-recheck logic — exposure there corrects itself within one report cycle, not instantly, and that's accepted as-is.
- **Player disconnection is explicitly NOT solved by a new detection mechanism.** There is no reliable "player disconnected" signal in this stack (no Firestore presence feature is wired up). The already-shipped client-side staleness filter (a position stops rendering after `GAME_BOUNDARY_CONFIG.freshnessMs`, 30s, with no new report) is the accepted mechanism for this case — nothing in this plan changes it.
- **Module format:** nothing in this plan touches `src/game/gameBoundary.js` or any other vendored pure module — no new vendoring step needed.
- **Admin-SDK-only data:** `boundaryStatuses` documents have `allow write: if false` in `firestore.rules` — they can only ever be written by a Cloud Function under the Admin SDK (confirmed, unchanged by this plan). Both "clear on disable" and "clear on end game" MUST happen inside a Cloud Function transaction; there is no client-side way to do this at all.
- Run `npm run format`, `npm run lint`, and the relevant test command (`npm test`, `npm run test:emulator`, or both) after every task's implementation step, before committing.

## Review Focus

- A player who is killed WHILE already confirmed-outside must stop showing as exposed on the very next read, not after some delay — the kill-time clear must actually take effect, not just stop future reports from updating it. (Task 3's kill-while-exposed test.)
- Disabling the boundary while MULTIPLE players are simultaneously confirmed-outside must clear every one of them, not just the first one found — a loop/batch bug here would leave some players silently still exposed. (Task 1's multi-player test, exercised by both Task 2 and Task 4.)
- A player with NO `boundaryStatuses` document at all (never reported, or already cleared) must not cause `disableGameBoundary`/`endGame` to throw — clearing is a no-op for them, not an error. (Task 1's no-op-for-missing-doc test.)
- Ending the game via `AbandonRoomButton` must go through the same new callable as `Endgamebutton` — both existing call sites must be updated, not just one. (Task 4's review step explicitly checks both.)
- The GM's hover tooltip and a player's always-visible exposed-player label must stay visually and behaviorally distinct — a tooltip that's merely "always open" is not the same thing as a separately-rendered, permanently-visible label, and conflating them risks the GM's own map crowding with open tooltips it never asked for. (Task 5's two-separate-rendering-paths test.)

---

### Task 1: Shared helper — clear every room's exposed statuses inside a transaction

**Files:**

- Create: `functions/callableFunctions/clearBoundaryExposure.js`

**Interfaces:**

- Produces: `clearExposureForRoom(transaction, roomRef, reason)` — an async function. `transaction` is an already-open Firestore transaction (the caller owns its lifecycle — this function only reads/writes through it, never commits or starts its own). `roomRef` is a `DocumentReference` to the room. `reason` is a string (e.g. `'boundary_disabled'`, `'game_ended'`) written as each cleared document's new `reason` field.

This function has no dedicated test file — it is exercised through Task 2's and Task 4's own integration tests (one of which must cover the multi-player and no-op cases in full; the other may assert only its own end-to-end effect, per this plan's Review Focus). It is not registered in `functions/index.js` — it is a plain internal helper, not a callable.

- [ ] **Step 1: Implement**

Read `functions/callableFunctions/reportPlayerLocation.js` in full first for the exact Firestore field names and shapes this function must write compatibly with (`status`, `reason`, `lat`, `lng`, `accuracyMeters`, `outsideSince`, `lastOutsideSampleAt`, `outsideSampleCount`, `outsideConfirmedAt`, `statusChangedAt`) — this helper must leave every one of those fields in a state that `reportPlayerLocation`'s own `stateFromDoc` can correctly read back from on the player's next report (i.e., don't invent a new shape).

Create `functions/callableFunctions/clearBoundaryExposure.js`:

```javascript
const { FieldValue } = require('firebase-admin/firestore');

/**
 * Clears every currently-exposed (or being-confirmed) status in a room,
 * inside the caller's own open transaction — used when there is no
 * meaningful boundary to be outside of anymore (it was just disabled) or
 * no one will report again (the game just ended). Does NOT delete the
 * documents — a player's own next report (if any) should still be able to
 * read a clean slate back, the same shape reportPlayerLocation.js's own
 * stateFromDoc already expects for a player with no outside history.
 *
 * A player with no boundaryStatuses document at all, or one that's
 * already fully inside/unavailable, is left alone — this only touches
 * documents that are actually exposed or approaching exposure.
 *
 * @param {FirebaseFirestore.Transaction} transaction already open; this
 *   function only reads/writes through it, never commits
 * @param {FirebaseFirestore.DocumentReference} roomRef
 * @param {string} reason written as the cleared reason, e.g.
 *   'boundary_disabled' or 'game_ended'
 */
const clearExposureForRoom = async (transaction, roomRef, reason) => {
    const statusesSnapshot = await transaction.get(roomRef.collection('boundaryStatuses'));
    statusesSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'outside' && data.status !== 'near') return;
        transaction.update(doc.ref, {
            status: 'unavailable',
            reason,
            lat: null,
            lng: null,
            accuracyMeters: null,
            outsideSince: null,
            lastOutsideSampleAt: null,
            outsideSampleCount: 0,
            outsideConfirmedAt: null,
            statusChangedAt: FieldValue.serverTimestamp(),
        });
    });
};

module.exports = { clearExposureForRoom };
```

- [ ] **Step 2: Format, lint, commit**

```bash
npx prettier --write functions/callableFunctions/clearBoundaryExposure.js
npx eslint functions/callableFunctions/clearBoundaryExposure.js --max-warnings=0
git add functions/callableFunctions/clearBoundaryExposure.js
git commit -m "Add a shared helper to clear a room's exposed boundary statuses"
```

---

### Task 2: `disableGameBoundary` clears exposure in its existing transaction

**Files:**

- Modify: `functions/callableFunctions/gameBoundary.js`
- Modify: `functions/callableFunctions/gameBoundary.integration.test.js`

**Interfaces:**

- Consumes: `clearExposureForRoom(transaction, roomRef, reason)` (Task 1).

Read `functions/callableFunctions/gameBoundary.js`'s current `exports.disableGameBoundary` in full first (it is short — a single `db.runTransaction` with a read, two precondition checks, and one `transaction.update`). Read `functions/callableFunctions/gameBoundary.integration.test.js`'s existing `disableGameBoundary` tests for this file's exact `seedRoom`/emulator-helper conventions before adding to them.

- [ ] **Step 1: Write the failing tests**

Add to `functions/callableFunctions/gameBoundary.integration.test.js`, in whatever `describe` block already covers `disableGameBoundary` (read the file to find its exact name and seeding helpers):

```javascript
it("clears every exposed player's boundary status when the boundary is disabled", async () => {
    const host = await newIdentity();
    const alice = await newIdentity();
    const bob = await newIdentity();
    await seedRoom(
        ROOM,
        [
            { name: 'alice', uid: alice.uid },
            { name: 'bob', uid: bob.uid },
        ],
        {
            hostId: host.uid,
            gameBoundary: BOUNDARY, // whatever this file's existing enabled-boundary fixture is named
        }
    );
    await withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'rooms', ROOM, 'boundaryStatuses', 'alice'), {
            status: 'outside',
            lat: 1,
            lng: 2,
            outsideSince: Timestamp.now(),
            outsideConfirmedAt: Timestamp.now(),
        });
        await setDoc(doc(db, 'rooms', ROOM, 'boundaryStatuses', 'bob'), {
            status: 'near',
            lat: 3,
            lng: 4,
            outsideSince: Timestamp.now(),
        });
    });

    await disableAs(host)({ roomId: ROOM, expectedRevision: 1 }); // this file's existing disableGameBoundary caller helper, adjust the expected-revision value to match BOUNDARY's actual seeded revision

    const aliceStatus = (
        await getDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'))
    ).data();
    const bobStatus = (await getDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'bob'))).data();
    expect(aliceStatus).toMatchObject({
        status: 'unavailable',
        reason: 'boundary_disabled',
        lat: null,
        lng: null,
        outsideConfirmedAt: null,
    });
    expect(bobStatus).toMatchObject({
        status: 'unavailable',
        reason: 'boundary_disabled',
        outsideSince: null,
    });
});

it('does not throw when disabling a boundary for a player with no boundaryStatuses document at all', async () => {
    const host = await newIdentity();
    await seedRoom(ROOM, [{ name: 'alice', uid: (await newIdentity()).uid }], {
        hostId: host.uid,
        gameBoundary: BOUNDARY,
    });
    // No boundaryStatuses document seeded for alice at all.
    await expect(disableAs(host)({ roomId: ROOM, expectedRevision: 1 })).resolves.toBeDefined();
});

it("leaves an already-inside player's boundary status untouched when the boundary is disabled", async () => {
    const host = await newIdentity();
    const alice = await newIdentity();
    await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], {
        hostId: host.uid,
        gameBoundary: BOUNDARY,
    });
    await withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'rooms', ROOM, 'boundaryStatuses', 'alice'), {
            status: 'inside',
        });
    });

    await disableAs(host)({ roomId: ROOM, expectedRevision: 1 });

    const aliceStatus = (
        await getDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', 'alice'))
    ).data();
    expect(aliceStatus).toEqual({ status: 'inside' });
});
```

Adjust every helper name (`seedRoom`, `withSecurityRulesDisabled`, `disableAs`, `bypass`, `BOUNDARY`, `ROOM`) to this file's ACTUAL existing names — read the file first; the sketch above describes the required assertions, not a literal transcription.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm run test:emulator -- -t "disabled"`
Expected: the first two FAIL (the clearing logic doesn't exist yet); the third ALREADY PASSES (today's code already leaves an inside status alone, trivially, since it doesn't touch `boundaryStatuses` at all yet) — confirm this, it's a regression guard for after this task's change, not a new behavior.

- [ ] **Step 3: Implement**

In `functions/callableFunctions/gameBoundary.js`, add the import at the top:

```javascript
const { clearExposureForRoom } = require('./clearBoundaryExposure');
```

In `exports.disableGameBoundary`'s transaction, after the existing `transaction.update(roomRef, {...})` call (the one that sets `gameBoundary.enabled: false`), add:

```javascript
await clearExposureForRoom(transaction, roomRef, 'boundary_disabled');
```

(This must come AFTER the existing `transaction.get(roomRef)` read at the top of the transaction, which it already does by virtue of being added after the existing update — but double check no write happens before this function's own internal `transaction.get` call, since Firestore transactions require all reads before any write in that transaction; `clearExposureForRoom`'s own `transaction.get` must execute before the `gameBoundary.enabled` update, or move this call to right after the room read instead, before the existing update. Read the real file and place it in the position that keeps the read-before-write ordering correct — do not assume the sketch's ordering is automatically valid.)

- [ ] **Step 4: Run to verify the tests pass**

Run: `npm run test:emulator`
Expected: all pass, including every pre-existing test in this file (not just the 3 new ones).

- [ ] **Step 5: Re-vendor if needed, format, lint, commit**

(This task does not touch any vendored pure module, so no re-vendor step is needed — confirm by checking `git diff --stat` only shows `functions/callableFunctions/gameBoundary.js` and its test file.)

```bash
npx prettier --write functions/callableFunctions/gameBoundary.js functions/callableFunctions/gameBoundary.integration.test.js
npx eslint functions/callableFunctions/gameBoundary.js --max-warnings=0
git add functions/callableFunctions/gameBoundary.js functions/callableFunctions/gameBoundary.integration.test.js
git commit -m "Clear exposed boundary statuses when the game boundary is disabled"
```

---

### Task 3: Eliminated players stop tracking and lose exposure immediately

**Files:**

- Modify: `src/hooks/useBoundaryLocation.js`
- Modify: `src/hooks/useBoundaryLocation.test.jsx`
- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`
- Modify: `functions/callableFunctions/killPlayer.js`
- Modify: `functions/callableFunctions/killPlayer.integration.test.js`
- Modify: `src/components/map_components/LivePlayerMapButton.js`
- Modify: `src/components/map_components/LivePlayerMapButton.test.jsx`

**Interfaces:**

- `useBoundaryLocation` gains one more argument: `isAlive` (boolean). `isTrackingActive` becomes `enabled && boundaryEnabled && isGameActive && isAlive && Boolean(roomID)`.

Read `src/hooks/useBoundaryLocation.js` in full first (specifically the `isTrackingActive` derivation) and `src/pages/PlayerGame.js` in full (specifically wherever it reads its OWN player doc's `isAlive` field today — it must already have this, since the existing "eliminated" message elsewhere in this file depends on it; read fresh rather than assuming the variable name).

- [ ] **Step 1: Write the failing tests**

Add to `src/hooks/useBoundaryLocation.test.jsx`, inside `describe('useBoundaryLocation', ...)`:

```jsx
it('does not start a watch when isAlive is false, even with everything else enabled', () => {
    renderHook(() => useBoundaryLocation({ ...baseProps, isAlive: false }));
    expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
});

it('stops an active watch the moment isAlive flips to false', () => {
    const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
        initialProps: { ...baseProps, isAlive: true },
    });
    act(() => result.current.requestPermission());
    const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

    rerender({ ...baseProps, isAlive: false });

    expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(watchId);
});
```

(`baseProps` is this file's existing fixture — add `isAlive: true` to it as the default, so every pre-existing test that doesn't mention `isAlive` keeps passing unchanged.)

Add to `src/pages/PlayerGame.test.jsx`: find wherever this file's `useBoundaryLocation` mock is called/asserted, and add one test confirming `isAlive` (read from this player's own subscribed player-doc state, whatever its existing variable is named) is passed through to the hook call.

Add to `functions/callableFunctions/killPlayer.integration.test.js`: find this file's existing test seeding/asserting shape, and add:

```javascript
it("clears the target's boundary status if they were confirmed outside at the moment of the kill", async () => {
    // Seed assassin and target with a valid kill relationship (read this
    // file's existing happy-path test for the exact seeding shape), plus
    // a boundaryStatuses doc for the target with status: 'outside',
    // lat/lng set, outsideConfirmedAt set (via withSecurityRulesDisabled,
    // matching this file's own existing emulator-helper conventions).
    // After the kill succeeds, read the target's boundaryStatuses doc
    // directly and assert status is no longer 'outside' (e.g. 'unavailable',
    // reason 'eliminated'), lat/lng are null.
});

it('does not throw when killing a target with no boundaryStatuses document at all', async () => {
    // Same valid-kill seeding, but no boundaryStatuses doc for the target.
    // Assert the kill still succeeds.
});
```

Add to `src/components/map_components/LivePlayerMapButton.test.jsx`: a test confirming a status doc belonging to a player NOT in the `players` prop's alive-names list (i.e. a dead player) still resolves to that player's real name when a FULLER player-name list is passed — read this file's existing label-resolution test for the exact pattern, and confirm the component's `players` prop is used as-is (no filtering inside the component) once Step 3 below updates the caller to pass every player, not just alive ones.

- [ ] **Step 2: Run to verify the new tests fail**

Run the four touched test files/projects individually (`npx jest src/hooks/useBoundaryLocation.test.jsx`, `npx jest src/pages/PlayerGame.test.jsx`, `npx jest src/components/map_components/LivePlayerMapButton.test.jsx`, `npm run test:emulator -- -t "eliminated"`) and confirm each new test fails for the right reason before implementing.

- [ ] **Step 3: Implement**

In `src/hooks/useBoundaryLocation.js`, add `isAlive` to the destructured argument and to `isTrackingActive`'s derivation:

```javascript
const useBoundaryLocation = ({ roomID, boundaryRevision, boundaryEnabled, isGameActive, isAlive }) => {
    // ...
    const isTrackingActive = enabled && boundaryEnabled && isGameActive && isAlive && Boolean(roomID);
```

In `src/pages/PlayerGame.js`, pass this player's own `isAlive` (read it from whatever state this file already subscribes to for their own player document — it already must track this, since an "eliminated" UI state exists elsewhere in this file) into the existing `useBoundaryLocation({...})` call.

In `functions/callableFunctions/killPlayer.js`, add the import:

```javascript
const { clearExposureForRoom } = require('./clearBoundaryExposure');
```

`clearExposureForRoom` clears a WHOLE ROOM; killing one player only needs to clear ONE document. Read it, but do not call it here directly — instead, inline the single-document version right where `targetDoc`/`targetData` are already available in the transaction (after `captureSnapshot(target, targetData)`, where `targetDoc.id` and `targetDoc.ref` are already in scope):

```javascript
const targetStatusRef = roomRef.collection('boundaryStatuses').doc(targetDoc.id);
const targetStatusSnapshot = await transaction.get(targetStatusRef);
if (targetStatusSnapshot.exists) {
    const targetStatus = targetStatusSnapshot.data();
    if (targetStatus.status === 'outside' || targetStatus.status === 'near') {
        transaction.update(targetStatusRef, {
            status: 'unavailable',
            reason: 'eliminated',
            lat: null,
            lng: null,
            accuracyMeters: null,
            outsideSince: null,
            lastOutsideSampleAt: null,
            outsideSampleCount: 0,
            outsideConfirmedAt: null,
            statusChangedAt: FieldValue.serverTimestamp(),
        });
    }
}
```

Check whether `FieldValue` is already imported in `killPlayer.js` (read the top of the file) — if not, add `const { FieldValue } = require('firebase-admin/firestore');` alongside its existing requires. This read (`transaction.get(targetStatusRef)`) must happen before any of this transaction's existing writes — find the exact position in the transaction where `targetDoc`/`targetData` first become available and insert this block immediately after, before any `transaction.update`/`transaction.create` call appears anywhere later in the function.

In `src/components/map_components/LivePlayerMapButton.js`: no change needed to the component itself (it already takes whatever `players` list it's given and resolves labels against it) — the fix is entirely at the call site.

In `src/components/header_components/HeaderExecution.js`, change the `players` prop passed to `LivePlayerMapButton` from `arrayOfAlivePlayers.map((name) => ({ name }))` to the full roster. Read `GameMasterView.js`'s own `players` state (already richer objects with `.name`) and thread an "all player names" value through `HeaderExecution`'s own props the same way `gameBoundary` already is, rather than deriving it from `arrayOfAlivePlayers` (which is alive-only by construction) — check `GameMasterView.js`'s current prop flow fresh before deciding the exact plumbing; this may need a new prop on `HeaderExecution` itself (e.g. `allPlayerNames`) alongside its existing `arrayOfAlivePlayers`.

- [ ] **Step 4: Run to verify the tests pass**

Run each of the four touched test suites again; all pass, including every pre-existing test.

- [ ] **Step 5: Format, lint, full test run, build, commit**

```bash
npm run format
npm run lint
npm test -- --watchAll=false
npm run test:emulator
npm run build
git add src/hooks/useBoundaryLocation.js src/hooks/useBoundaryLocation.test.jsx src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx functions/callableFunctions/killPlayer.js functions/callableFunctions/killPlayer.integration.test.js src/components/map_components/LivePlayerMapButton.js src/components/map_components/LivePlayerMapButton.test.jsx src/components/header_components/HeaderExecution.js
git commit -m "Stop tracking and clear exposure for eliminated players"
```

---

### Task 4: A real `endGame` Cloud Function, clearing exposure atomically

**Files:**

- Create: `functions/callableFunctions/endGame.js`
- Create: `functions/callableFunctions/endGame.integration.test.js`
- Create: `src/components/endGame.js`
- Modify: `src/components/firebase_calls/dbCalls.js` (remove the old client-side `endGame` export)
- Modify: `src/components/header_components/Endgamebutton.js`
- Modify: `src/components/lobby_components/AbandonRoomButton.js`
- Modify: `src/components/header_components/Endgamebutton.test.jsx` (if it exists — check first)
- Modify: `src/components/lobby_components/AbandonRoomButton.test.jsx` (if it exists — check first)
- Modify: `functions/index.js`

**Interfaces:**

- Consumes: `clearExposureForRoom(transaction, roomRef, reason)` (Task 1).
- Produces: `endGame` Cloud Function, registered in `functions/index.js`. Client wrapper `src/components/endGame.js` exporting `endGame(roomID)` → `Promise<void>`, matching the OLD client function's exact name and signature so both call sites need only an import-path change, not a call-site rewrite.

Read `src/components/firebase_calls/dbCalls.js`'s current `export const endGame` in full first (it is three lines). Read `src/components/header_components/Endgamebutton.js` and `src/components/lobby_components/AbandonRoomButton.js` in full — both currently import `endGame` from `dbCalls.js` and call it directly; find their exact import lines. Read `functions/callableFunctions/reportPlayerLocation.js`'s host/auth-check preamble shape once more for this new function's own precondition style (host-only, room-must-exist, game-must-still-be-active — mirror `gameBoundary.js`'s `readRoomForHost` pattern, inlined here since it isn't exported from that file).

- [ ] **Step 1: Write the failing tests**

Create `functions/callableFunctions/endGame.integration.test.js`, following `functions/callableFunctions/gameBoundary.integration.test.js`'s exact `seedRoom`/emulator-helper conventions (read that file fresh for the precise patterns — do not invent new ones):

```javascript
it('sets isGameActive false and endedAt, as the host', async () => {
    // Seed a room with isGameActive: true, hostId set to a known identity.
    // Call endGame as that host. Read the room doc directly and assert
    // isGameActive is false and endedAt is a Timestamp.
});

it("clears every exposed player's boundary status when the game ends", async () => {
    // Mirror Task 2's equivalent test exactly: seed two players, one
    // 'outside' and one 'near', call endGame as the host, assert both
    // are cleared to status 'unavailable', reason 'game_ended'.
});

it('rejects a non-host caller with permission-denied and changes nothing', async () => {
    // Call endGame as a signed-in identity who is not the room's host.
    // Assert the room doc's isGameActive is still true afterward.
});

it('rejects ending an already-ended game', async () => {
    // Seed isGameActive: false already. Call endGame as the host and
    // assert it's rejected with failed-precondition.
});
```

Create `src/components/endGame.js`'s own usage is exercised indirectly through `Endgamebutton.test.jsx`/`AbandonRoomButton.test.jsx` if they exist — check first (per this task's file list) and, if either exists, read its current test for how it mocks the OLD `dbCalls.endGame` import, then update that mock to target the new `src/components/endGame.js` import path instead, keeping every existing assertion in that test otherwise unchanged.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm run test:emulator -- -t "endGame"`
Expected: FAIL — the function doesn't exist yet, so the emulator has nothing to call.

- [ ] **Step 3: Implement**

Create `functions/callableFunctions/endGame.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { clearExposureForRoom } = require('./clearBoundaryExposure');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The atomic replacement for the old client-side `endGame` (formerly a
 * plain updateDoc in dbCalls.js): marks the room's game as over AND clears
 * every player's exposed boundary status in the same transaction, since
 * boundaryStatuses can only ever be written under the Admin SDK — there
 * was no way for the old client-only write to do this at all.
 */
exports.endGame = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }
    const { roomId } = data || {};
    if (!roomId) {
        throw new functions.https.HttpsError('invalid-argument', 'roomId is required.');
    }

    const roomRef = db.collection('rooms').doc(roomId);
    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', 'Room not found.');
        }
        const room = roomSnapshot.data();
        if (room.hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can end the game.'
            );
        }
        if (!room.isGameActive) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This game has already ended.'
            );
        }

        await clearExposureForRoom(transaction, roomRef, 'game_ended');

        transaction.update(roomRef, {
            isGameActive: false,
            endedAt: FieldValue.serverTimestamp(),
        });
    });
});
```

Create `src/components/endGame.js`:

```javascript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const endGameCallable = httpsCallable(functions, 'endGame');

/**
 * Ends the room's game and clears every player's exposed boundary status
 * in the same server-side transaction. Replaces the old dbCalls.js
 * client-only write — boundaryStatuses can only be written under the
 * Admin SDK, so there was no way for a plain client write to also clear
 * exposure.
 *
 * @throws if the caller is not the room's host, the room doesn't exist,
 *   or the game has already ended — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const endGame = async (roomID) => {
    await endGameCallable({ roomId: roomID });
};
```

In `src/components/firebase_calls/dbCalls.js`, delete the old `export const endGame = async (roomID) => {...}` entirely (do not leave a re-export shim — `src/components/endGame.js` is the new, sole home for this name).

In `src/components/header_components/Endgamebutton.js` and `src/components/lobby_components/AbandonRoomButton.js`, change the import from `'../firebase_calls/dbCalls'` (or wherever each currently imports `endGame` from — read each file's actual import line) to `'../endGame'` (adjust the relative path per each file's actual location). No other change to either file — the function's name and call signature (`endGame(roomID)`) are unchanged.

In `functions/index.js`, add:

```javascript
const { endGame } = require('./callableFunctions/endGame');
exports.endGame = endGame;
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npm run test:emulator` (full suite) and `npm test -- --watchAll=false` (full suite). Expected: all pass, including every pre-existing test — `Endgamebutton.test.jsx`/`AbandonRoomButton.test.jsx` (if either exists) must still pass with their mock import path updated.

- [ ] **Step 5: Format, lint, build, commit**

```bash
npm run format
npm run lint
npm run build
git add functions/callableFunctions/endGame.js functions/callableFunctions/endGame.integration.test.js functions/index.js src/components/endGame.js src/components/firebase_calls/dbCalls.js src/components/header_components/Endgamebutton.js src/components/lobby_components/AbandonRoomButton.js
git commit -m "Replace the client-only endGame write with a real Cloud Function that also clears exposure"
```

(If either `Endgamebutton.test.jsx` or `AbandonRoomButton.test.jsx` exists and needed changes, add it to this commit's `git add` list too.)

---

### Task 5: Faster/larger GM hover labels; always-visible labels for a player's own exposed-neighbor view

**Files:**

- Modify: `src/components/map_components/GameMap.js`
- Modify: `src/components/map_components/GameMap.test.jsx`
- Modify: `src/components/map_components/LivePlayerMapButton.js` (no behavior change needed — confirm its entries already omit the new flag, defaulting to hover mode)
- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- `GameMap`'s `otherPositions` entries gain one new optional field: `alwaysShowLabel: boolean` (default `false` — unset entries keep today's hover behavior, just faster/larger). `label` keeps its existing meaning (the name to show); `alwaysShowLabel` only controls WHETHER that label needs a hover to appear.
- `PlayerGame.js`'s own exposed-neighbor positions — the render-time, freshness-filtered derived list this file already computes for `PlayerMapModal`'s `otherPositions` prop (built by the earlier `docs/superpowers/plans/2026-10-12-live-location-visibility.md` plan, then touched again by Task 3 of THIS plan — read the file fresh rather than assuming its exact current variable name) — gain a resolved `label` (same `resolvePlayerDisplayName(doc.id, players)` pattern `LivePlayerMapButton.js` already uses — `players` is this file's own existing, already-subscribed roster state) and `alwaysShowLabel: true` on each entry.

Read `src/components/map_components/GameMap.js` in full first, specifically `PositionDot` and the `otherPositions.map(...)` block — this task replaces `PositionDot`'s `title`-attribute approach entirely, it does not add a second mechanism alongside it. Read `src/pages/PlayerGame.js` in full, specifically wherever `freshOtherOutsidePositions` (or whatever this file currently calls its render-time-derived, freshness-filtered list of other exposed players' positions) is computed — this is almost certainly immediately after Task 3's own changes to that same derivation in THIS plan, so re-read the file fresh rather than assuming its shape from this plan's own earlier text.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/map_components/GameMap.test.jsx`, inside or alongside the existing `describe("GameMap — other players' positions", ...)` block:

```jsx
it('shows a hover tooltip (not a native title attribute) for a position with a label and no alwaysShowLabel', () => {
    renderMap({
        otherPositions: [{ id: 'alice', lat: 10, lng: 20, label: 'Alice' }],
    });
    const marker = screen.getByTestId('other-position-marker');
    // No native title attribute at all — the tooltip is a separate
    // rendered element now, not an HTML attribute.
    expect(marker.querySelector('[title]')).not.toBeInTheDocument();
});

it('always renders a visible label (no hover needed) when alwaysShowLabel is true', () => {
    renderMap({
        otherPositions: [{ id: 'alice', lat: 10, lng: 20, label: 'Alice', alwaysShowLabel: true }],
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
});

it('does not render a visible label at all for a position with no label', () => {
    renderMap({ otherPositions: [{ id: 'alice', lat: 10, lng: 20 }] });
    expect(
        screen.queryByText(/./, { selector: '[data-testid="always-visible-label"]' })
    ).not.toBeInTheDocument();
});
```

Read this file's existing mocked `react-map-gl` module first — if it mocks a Chakra `Tooltip` import at all today (it doesn't need to; `Tooltip` comes from `@chakra-ui/react`, already used unmocked elsewhere in this same test file via the real `ChakraProvider` wrapper, so no new mock should be needed). If introducing `Tooltip` causes any jsdom-specific warning or error in this test file specifically, read the error and handle it the same way this file already handles other Chakra-component quirks — do not silently suppress a real warning.

Add to `src/pages/PlayerGame.test.jsx`: find the existing test asserting the shape of an exposed-neighbor's entry passed to the mocked `PlayerMapModal`'s `otherPositions` prop (e.g. `'shows another player's position on the map once their status reads outside, excluding the viewer's own id'`, from the earlier `2026-10-12-live-location-visibility.md` plan) and extend its assertion to also check the entry now includes `label` (the seeded player's real display name, not the raw normalized id) and `alwaysShowLabel: true`.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest src/components/map_components/GameMap.test.jsx src/pages/PlayerGame.test.jsx`
Expected: the 3 new `GameMap.test.jsx` tests fail (today's code still uses `title`, has no always-visible mode); the extended `PlayerGame.test.jsx` test fails on the new `label`/`alwaysShowLabel` assertions specifically (its existing assertions about `id`/`lat`/`lng` should still pass).

- [ ] **Step 3: Implement**

In `src/components/map_components/GameMap.js`, add `Tooltip` to the existing `@chakra-ui/react` import line, and replace `PositionDot` with a version that renders either a `Tooltip`-wrapped dot (hover mode) or a dot with a sibling always-visible label (always-show mode):

```javascript
import { Box, Button, Text, Tooltip } from '@chakra-ui/react';

// ...

// The one visual for a player's position dot, shared by the own-position
// marker and every other-players' marker so they cannot drift apart.
// `label` with no `alwaysShowLabel` shows on hover via a real rendered
// Tooltip (replacing the old native `title` attribute, which cannot be
// sped up or resized) — a short openDelay and a larger font, per the
// moderator's own request. `label` WITH `alwaysShowLabel` skips the
// tooltip entirely and renders the name permanently next to the dot,
// used only by a player's own view of other currently-exposed players
// (the spec's "few players are ever exposed at once" reasoning — no
// hover needed there).
const Dot = () => (
    <Box w="14px" h="14px" borderRadius="full" bg="#4299E1" border="2px solid white" />
);

const PositionDot = ({ label, alwaysShowLabel }) => {
    if (!label) return <Dot />;
    if (alwaysShowLabel) {
        return (
            <Box position="relative">
                <Dot />
                <Text
                    data-testid="always-visible-label"
                    position="absolute"
                    top="-20px"
                    left="50%"
                    transform="translateX(-50%)"
                    whiteSpace="nowrap"
                    fontSize="sm"
                    fontWeight="bold"
                    color="white"
                    bg="blackAlpha.700"
                    px="4px"
                    borderRadius="sm"
                >
                    {label}
                </Text>
            </Box>
        );
    }
    return (
        <Tooltip label={label} openDelay={150} fontSize="md" hasArrow>
            <Box>
                <Dot />
            </Box>
        </Tooltip>
    );
};
```

(`openDelay={150}` is milliseconds — a deliberate, large reduction from a native browser tooltip's typical ~1000ms+ delay; adjust the exact value only if the user asks for something different, don't guess a different number unprompted. `fontSize="md"` is Chakra's own scale, visibly larger than a native OS tooltip's default small system font — again, don't invent a different value unprompted.)

Update both call sites — the existing own-position marker and the `otherPositions.map(...)` block — to pass the new props instead of `title`:

```jsx
{
    ownPosition && (
        <Marker longitude={ownPosition.lng} latitude={ownPosition.lat}>
            <PositionDot />
        </Marker>
    );
}
{
    otherPositions.map((position) => (
        <Marker
            key={position.id}
            data-testid="other-position-marker"
            longitude={position.lng}
            latitude={position.lat}
        >
            <PositionDot label={position.label} alwaysShowLabel={position.alwaysShowLabel} />
        </Marker>
    ));
}
```

In `src/components/map_components/LivePlayerMapButton.js`: no change — its entries already only ever set `label`, never `alwaysShowLabel`, so they correctly default to the (now faster/larger) hover mode. Confirm this by reading the file; do not add `alwaysShowLabel: false` explicitly anywhere, since `undefined` already means the same thing and an explicit `false` would be noise.

In `src/pages/PlayerGame.js`: find wherever the render-time-derived, freshness-filtered other-positions list is built (immediately after Task 3's own edit to this same derivation, in this same file, in this same plan) and add a resolved label and the always-show flag to each entry:

```javascript
// require()/import already present in this file for normalizePlayerName
// — reuse it; do not add a second import of the same module under a
// different name.
.map((position) => ({
    id: position.id,
    lat: position.lat,
    lng: position.lng,
    label: resolvePlayerDisplayName(position.id, players),
    alwaysShowLabel: true,
}))
```

Check whether `resolvePlayerDisplayName` is already imported in this file (Task 3 of THIS plan already imports `normalizePlayerName` from the same module, `src/game/playerNames.js` — add `resolvePlayerDisplayName` to that SAME import line, do not add a second import statement for the same module) and whether `players` (this file's own subscribed player-roster state, already used elsewhere in this file) is in scope at the point this derivation runs — it must be, since this file already subscribes to it for other existing features.

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx jest src/components/map_components/GameMap.test.jsx src/pages/PlayerGame.test.jsx`
Expected: all pass, including every pre-existing test in both files.

- [ ] **Step 5: Format, lint, full test run, build, commit**

```bash
npm run format
npm run lint
npm test -- --watchAll=false
npm run build
git add src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Faster/larger GM hover labels; always-visible names for a player's exposed neighbors"
```

---

## Final gate

Before calling this plan done, run the full gate from `CLAUDE.md`:

```bash
npm run format
npm run lint
npm test
npm run build
npm run test:rules
npm run test:emulator
```

Device checks are not needed for this plan — nothing here changes any player-facing UI behavior in a way that depends on real GPS hardware; everything is exercised by the automated gate.
