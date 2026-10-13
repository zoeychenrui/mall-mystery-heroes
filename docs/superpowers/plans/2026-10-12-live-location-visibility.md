# Live Location Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the GM a live map of every player's location at all times, and make a confirmed-outside player's location visible to every other player too, with a personal countdown warning first.

**Architecture:** One schema change — `lat`/`lng` added to the already-existing `boundaryStatuses/{playerId}` document — serves both features, because the host's Firestore read grant on that document already has no restriction, and Firestore evaluates list/query rules per document. A single added rule clause lets any player read another player's document, coordinates included, exactly while that document's `status` field reads `'outside'`.

**Tech Stack:** React 18 + Chakra UI 2, react-map-gl/mapbox-gl (already installed), Firebase Firestore security rules, Firebase Cloud Functions (Admin SDK).

**Spec:** `docs/superpowers/specs/2026-10-12-live-location-visibility-design.md`

## Global Constraints

- **Module format:** every new pure export in `src/game/gameBoundary.js` stays CommonJS (`module.exports`), exactly as that file already is — it is vendored into `functions/` via `functions/scripts/sync-shared-game-logic.js`, and anything in `src/` that needs it uses a bare `require()` call, never a named `import`, exactly as `GameMap.js`/`PlayerGame.js` already do.
- **The core trade-off, from the spec:** `lat`/`lng` are now written to `boundaryStatuses/{playerId}` on every report, for every player, for the whole game. Visibility is controlled entirely by the Firestore read rule, never by whether the data exists. On an error report (no fresh coordinates), the previous stored `lat`/`lng` are carried forward unchanged rather than cleared — a `null`/`null` only when nothing has ever been stored for that player.
- **Firestore rules list-query mechanics (already established precedent in this exact file):** a `list`/query operation is only allowed when Firestore can prove the rule holds for every possible result of that exact query shape. An unfiltered `collection()` read is NOT provably safe under the new rule (a mix of inside/outside/near documents) and stays denied for a non-host, non-self player, same as today. A query with `where('status', '==', 'outside')` IS provably safe, since Firestore can match that literal filter against the rule's `resource.data.status == 'outside'` clause — this is the exact same mechanic `firestore.rules`' own `rooms/{roomId}` `allow list` clause already uses and documents.
- **Reuse, not reinvention:** the exposure countdown uses the already-stored `outsideSince` field and the already-exported `GAME_BOUNDARY_CONFIG.confirmMinSpanMs` (20000). No new timer, no new constant.
- **Run `npm run format`, `npm run lint`, and `npm test` after every task's implementation step, before committing.**

## Review Focus

- A player whose very first-ever report is an error report (never had a real fix) must get `lat: null, lng: null` written, not crash on reading an undefined previous value. (Task 2's first-report-is-an-error test.)
- The widened rule must NOT let a non-host, non-self player read a status document via an unfiltered list query, even though the per-document check can pass for some documents in the room — Firestore's query-shape provability is what prevents this, and it needs its own test, not just an assumption. (Task 3's unfiltered-list-still-denied test.)
- A player's OWN exposure countdown must stop and the "you are now exposed" transition must happen the instant their own status flips to confirmed `outside` — not lag a tick behind the Firestore snapshot that reports it. (Task 7's countdown-to-exposure transition test.)
- A formerly-exposed player's dot must disappear from every other player's map the instant they return inside — the design relies on Firestore's own live-query semantics to drop a document that stops matching a filter, with no explicit "clear" step anywhere in the code, which is exactly the kind of implicit behavior that needs its own test, not just an assumption that it "just works." (Task 7's return-inside-removes-the-dot test.)
- The GM's live map and another player's "who's exposed near me" map must both hide/grey a marker whose `lastUsableReceivedAt` has gone stale — a live-looking dot for a disconnected player is worse than no dot. (Task 6 and Task 7's staleness tests.)
- Closing the GM's live map modal, or a player's `PlayerMapModal`, must not affect whether `useBoundaryLocation`'s own tracking keeps running — this plan adds new subscriptions but must not touch that existing invariant from Phase 3. (Task 7's modal-close test.)

---

### Task 1: Pure freshness helper in `gameBoundary.js`

**Files:**

- Modify: `src/game/gameBoundary.js`
- Modify: `src/game/gameBoundary.test.js`

**Interfaces:**

- Produces: `isPositionFresh(lastUsableMs, nowMs)` — exported from `module.exports`, same file/module as `deriveFreshStatus`/`GAME_BOUNDARY_CONFIG`.

This is a simpler, standalone check than `deriveFreshStatus`: it has no concept of revision or uid mismatch, because it is used to decide whether to render _someone else's_ marker as live, not to drive that person's own tracking loop.

- [ ] **Step 1: Write the failing test**

Add to `src/game/gameBoundary.test.js`, in a new `describe('isPositionFresh', ...)` block near the existing `deriveFreshStatus` tests (read that block first for the file's existing `require()` destructure line — add `isPositionFresh` to it):

```javascript
describe('isPositionFresh', () => {
    it('is false when there is no last-usable time at all', () => {
        expect(isPositionFresh(null, 1000)).toBe(false);
    });

    it('is true exactly at the freshness boundary', () => {
        expect(isPositionFresh(1000, 1000 + GAME_BOUNDARY_CONFIG.freshnessMs)).toBe(true);
    });

    it('is false just past the freshness boundary', () => {
        expect(isPositionFresh(1000, 1000 + GAME_BOUNDARY_CONFIG.freshnessMs + 1)).toBe(false);
    });

    it('is true well within the freshness window', () => {
        expect(isPositionFresh(1000, 1500)).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/game/gameBoundary.test.js -t "isPositionFresh"`
Expected: FAIL — `isPositionFresh is not a function` (it isn't exported yet).

- [ ] **Step 3: Implement**

In `src/game/gameBoundary.js`, add directly after `deriveFreshStatus`'s own definition (read that function first for its exact location):

```javascript
// Whether a stored position is recent enough to render as a live marker on
// someone else's map — simpler than deriveFreshStatus, which also carries
// revision/uid mismatch logic for driving the OWNER's own tracking loop.
// This is used only to decide whether a marker showing SOMEONE ELSE's
// position (the GM's live map, or another player's "who's exposed near
// me" view) should render as live, dim, or be hidden.
const isPositionFresh = (lastUsableMs, nowMs) => {
    if (lastUsableMs === null || lastUsableMs === undefined) return false;
    return nowMs - lastUsableMs <= GAME_BOUNDARY_CONFIG.freshnessMs;
};
```

Add `isPositionFresh` to the `module.exports = {...}` object at the bottom of the file, alongside `deriveFreshStatus`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/game/gameBoundary.test.js`
Expected: all pass, including the 4 new tests and every pre-existing test in this file.

- [ ] **Step 5: Re-vendor, format, lint, commit**

```bash
node functions/scripts/sync-shared-game-logic.js
cmp src/game/gameBoundary.js functions/vendor/game/gameBoundary.js
npx prettier --write src/game/gameBoundary.js src/game/gameBoundary.test.js
npx eslint src/game/gameBoundary.js src/game/gameBoundary.test.js --max-warnings=0
git add src/game/gameBoundary.js src/game/gameBoundary.test.js functions/vendor/game/gameBoundary.js
git commit -m "Add isPositionFresh, a simple marker-freshness check for other players' positions"
```

---

### Task 2: Server writes and carries forward `lat`/`lng`

**Files:**

- Modify: `functions/callableFunctions/reportPlayerLocation.js`
- Modify: `functions/callableFunctions/reportPlayerLocation.integration.test.js`

**Interfaces:**

- Produces: `boundaryStatuses/{playerId}` documents now carry `lat: number|null` and `lng: number|null`.

Read `functions/callableFunctions/reportPlayerLocation.js` in full first — this task edits it directly, not from a blank slate. `lat`/`lng` are tracked as plain sibling values alongside the existing `prev`/`next` boundary-state machine, not threaded through `nextBoundaryState` itself — position carry-forward is bookkeeping orthogonal to the inside/outside state machine, and the shared, vendored `gameBoundary.js` module should not need to know about it.

- [ ] **Step 1: Write the failing tests**

Three changes to `functions/callableFunctions/reportPlayerLocation.integration.test.js`:

First, find and **replace** the existing test named `'the stored status doc contains no lat or lng fields'` (it asserts the behavior this task reverses):

```javascript
it('a valid fix writes lat and lng onto the status doc', async () => {
    const alice = await newIdentity();
    await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

    await reportAs(alice)(fix(INSIDE, Date.now() - 5000));

    const status = await readStatus('alice');
    expect(status.lat).toBe(INSIDE.lat);
    expect(status.lng).toBe(INSIDE.lng);
});
```

Second, find and **replace** the existing test named `'an error report writes status unavailable with the reason, carries no coordinates, and writes no outside event'` (its "carries no coordinates" assertion is also reversed — a _first-ever_ report that happens to be an error report has nothing to carry forward, so it writes `null`, not an absent field):

```javascript
it('an error report with no prior fix writes status unavailable with the reason and null coordinates', async () => {
    const alice = await newIdentity();
    await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

    const result = await reportAs(alice)({
        roomId: ROOM,
        boundaryRevision: 1,
        sampleMs: Date.now() - 5000,
        error: 'permission_denied',
    });

    expect(result.data).toEqual({ status: 'unavailable', reason: 'permission_denied' });
    const status = await readStatus('alice');
    expect(status).toMatchObject({ status: 'unavailable', reason: 'permission_denied' });
    expect(status.lat).toBeNull();
    expect(status.lng).toBeNull();
    expect(await readEvents()).toEqual([]);
});
```

Third, **add** a new test proving the carry-forward behavior — the one genuinely new piece of logic this task introduces:

```javascript
it('an error report after a known fix carries the previous lat and lng forward unchanged', async () => {
    const alice = await newIdentity();
    await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { gameBoundary: BOUNDARY });

    await reportAs(alice)(fix(INSIDE, Date.now() - 10000));
    await reportAs(alice)({
        roomId: ROOM,
        boundaryRevision: 1,
        sampleMs: Date.now() - 5000,
        error: 'timeout',
    });

    const status = await readStatus('alice');
    expect(status).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(status.lat).toBe(INSIDE.lat);
    expect(status.lng).toBe(INSIDE.lng);
});
```

- [ ] **Step 2: Run to verify the new/changed tests fail**

Run: `npm run test:emulator -- -t "lat|lng|coordinates"`
Expected: all three FAIL against the current, unmodified function — the first two because `lat`/`lng` are never written at all today; the third because there is nothing to carry forward since nothing is written.

- [ ] **Step 3: Implement**

In `functions/callableFunctions/reportPlayerLocation.js`:

Where `prev` is computed from `storedData` (read that block first — the ternary handling a revision mismatch, a fresh player, and the normal case), add a sibling pair of plain variables right after it:

```javascript
const prevLat = storedData === null ? null : (storedData.lat ?? null);
const prevLng = storedData === null ? null : (storedData.lng ?? null);
```

(A revision mismatch does NOT reset these — unlike the boundary-confirmation state, a player's last known position is still their last known position regardless of which boundary revision it was measured against; only the boundary math changes.)

In the fix-report branch (the `else` of `if (isErrorReport)`, where `classifyFix`/`nextBoundaryState` are called), capture the new position right there:

```javascript
let nextLat = prevLat;
let nextLng = prevLng;
if (isErrorReport) {
    next = nextBoundaryState(prev, { kind: 'unusable', reason: error }, { sampleMs, receivedMs });
} else {
    if (Number.isFinite(accuracyM)) {
        accuracyMeters = accuracyM;
    }
    const classification = classifyFix(boundary.vertices, { lat, lng, accuracyM });
    next = nextBoundaryState(prev, classification, { sampleMs, receivedMs });
    nextLat = lat;
    nextLng = lng;
}
```

In the write phase, add `lat: nextLat, lng: nextLng` to the `transaction.set(statusRef, {...})` call, alongside the existing fields (do not add `{ merge: true }` — this call already fully replaces the document every time, which is exactly why `nextLat`/`nextLng` must be computed and included here rather than relying on a merge to preserve them).

Also update the doc comment above `exports.reportPlayerLocation` — it currently says "Coordinates are evaluated here and never stored." Replace that sentence with a pointer to the new behavior and the spec:

```javascript
/**
 * Accepts one location report from a player and records their boundary
 * status. lat/lng are written to the status doc on every report (carried
 * forward unchanged on an error report) — see
 * docs/superpowers/specs/2026-10-12-live-location-visibility-design.md for
 * why, and firestore.rules for how read access is controlled instead. A
 * boundaryEvents doc fires only on the confirmation edge: outsideConfirmedAt
 * moving from null to set, or from set to cleared by an inside status.
 * ...
```

Keep the rest of the existing comment (the fix/error-report shape description below this point) unchanged.

- [ ] **Step 4: Run to verify the tests pass**

Run: `npm run test:emulator`
Expected: all pass, including every pre-existing test in this file (re-read the full suite's output, not just the three touched tests — the write-phase change touches every test that calls the callable).

- [ ] **Step 5: Re-vendor, format, lint, commit**

```bash
node functions/scripts/sync-shared-game-logic.js
npx prettier --write functions/callableFunctions/reportPlayerLocation.js functions/callableFunctions/reportPlayerLocation.integration.test.js
npx eslint functions/callableFunctions/reportPlayerLocation.js --max-warnings=0
git add functions/callableFunctions/reportPlayerLocation.js functions/callableFunctions/reportPlayerLocation.integration.test.js
git commit -m "Write and carry-forward lat/lng on the boundary status doc"
```

---

### Task 3: Widen the `boundaryStatuses` read rule

**Files:**

- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Consumes: `isPlayerOfRoom(roomId)` (already defined in this file, already used by `isHostOrPlayerOfRoom`).

Read the `firestore.rules` file's `boundaryStatuses` match block and its surrounding helper functions in full first (they are short — the whole file's rules-mechanics comments at the top are also worth reading, since this task's new tests depend on the exact list-query provability mechanic those comments already explain for a different collection).

- [ ] **Step 1: Write the failing tests**

Add to `test/firestore.rules.test.js`, inside the existing `describe('game boundary: ...', ...)` block (read its `beforeEach` first — it seeds `alice` with `status: 'inside'` and `bob` with `status: 'outside'`, reused below):

```javascript
it('allows a player to read ANOTHER player's boundaryStatuses doc once it reads outside', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    // PLAYER_UID owns bob's player doc (see this block's beforeEach/seed),
    // so reading bob's own status is the "own doc" case already covered
    // elsewhere — this test is specifically about a DIFFERENT player
    // (alice) whose status is NOT outside, confirming the new clause does
    // not open her door, then flips it to outside and confirms it does.
    await expectPermissionDenied(getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'rooms', 'room-a', 'boundaryStatuses', 'alice'), {
            status: 'outside',
        });
    });

    await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice')));
});

it('returns only the currently-outside players from a status-filtered list query, for a non-host player', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    const outsideQuery = query(
        collection(db, 'rooms', 'room-a', 'boundaryStatuses'),
        where('status', '==', 'outside')
    );
    const snapshot = await assertSucceeds(getDocs(outsideQuery));
    // bob is seeded as 'outside' in this block's beforeEach; alice is
    // 'inside' and must not appear even though the query ran successfully.
    expect(snapshot.docs.map((d) => d.id)).toEqual(['bob']);
});

it('still denies an unfiltered list of boundaryStatuses for a non-host player, even though some documents in the room are outside', async () => {
    // The new rule clause makes SOME documents in this room readable to
    // this player (bob's, since it's outside) but not ALL of them
    // (alice's, which is inside) — Firestore cannot prove an unfiltered
    // list query safe under a rule that only some candidate documents
    // satisfy, so the whole query must still be denied, exactly as the
    // pre-existing 'denies a player listing boundaryStatuses' test already
    // asserts for the pre-change rule. This test exists specifically to
    // confirm that invariant survives this rule change.
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await expectPermissionDenied(getDocs(collection(db, 'rooms', 'room-a', 'boundaryStatuses')));
});
```

If `query`/`where` are not already imported at the top of `test/firestore.rules.test.js`, add them to the existing `firebase/firestore` import line (read that line first — most of these helpers are very likely already imported for other describe blocks in this large file).

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest test/firestore.rules.test.js -t "outside"`
Expected: the first two FAIL (permission-denied / empty results, since the rule clause doesn't exist yet); the third PASSES already (today's unfiltered rule already denies this for an unrelated reason — confirms this is a regression guard, not a new behavior, exactly as its own comment says).

- [ ] **Step 3: Implement**

In `firestore.rules`, change the `boundaryStatuses` match block's `allow read` from:

```
allow read: if isHostOfExistingRoom(roomId) ||
  (isSignedIn() && isOwnBoundaryStatus(roomId, playerId));
```

to:

```
allow read: if isHostOfExistingRoom(roomId) ||
  (isSignedIn() && isOwnBoundaryStatus(roomId, playerId)) ||
  (isSignedIn() && isPlayerOfRoom(roomId) && resource.data.status == 'outside');
```

Update the match block's own comment (currently: "A player reads only their own status doc, and there is no list grant for players, so the roster of statuses stays host-only.") to note the new exception — point at `docs/superpowers/specs/2026-10-12-live-location-visibility-design.md` rather than re-explaining the whole mechanic inline.

- [ ] **Step 4: Run to verify all three pass**

Run: `npx jest test/firestore.rules.test.js`
Expected: all pass, including every pre-existing test in this file's `boundaryStatuses`/`boundaryEvents` describe block — re-read that block's full output, not just the 3 new tests, since the clause change could in principle interact with a test you haven't anticipated.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write firestore.rules test/firestore.rules.test.js
git add firestore.rules test/firestore.rules.test.js
git commit -m "Let any player read another player's boundary status once it reads outside"
```

---

### Task 4: GameMap renders a list of other players' positions

**Files:**

- Modify: `src/components/map_components/GameMap.js`
- Modify: `src/components/map_components/GameMap.test.jsx`

**Interfaces:**

- Consumes: nothing new from earlier tasks.
- Produces: `GameMap` gains a new prop, `otherPositions: Array<{id: string, lat: number, lng: number, label?: string}>` (default `[]`). Each entry renders a marker the same shape and color as the existing own-position marker, with an optional hover-revealed name when `label` is given (used by the GM's live map; omitted by a player's "who's exposed near me" view, per the spec's decision not to add hover labels there).

Read `src/components/map_components/GameMap.js` in full first — this task generalizes its existing single `ownPosition` marker-rendering block, it does not add a second, separate one. The existing `ownPosition` marker stays exactly as it renders today; `otherPositions` is new, additive JSX alongside it, sharing the same visual style (reuse the same `Box` marker styling, not a copy/paste with different colors unless you have a reason to differ — there isn't one here).

- [ ] **Step 1: Write the failing tests**

Add to `src/components/map_components/GameMap.test.jsx`'s `describe('GameMap — own position', ...)` block (or a new sibling `describe('GameMap — other players\' positions', ...)` block, your call on which reads better given the final file):

```jsx
it('renders no markers when otherPositions is empty or omitted', () => {
    renderMap({ otherPositions: [] });
    expect(screen.queryAllByTestId('other-position-marker')).toHaveLength(0);
});

it('renders one marker per entry in otherPositions, at the right coordinates', () => {
    renderMap({
        otherPositions: [
            { id: 'alice', lat: 10, lng: 20 },
            { id: 'bob', lat: 30, lng: 40 },
        ],
    });
    const markers = screen.getAllByTestId('other-position-marker');
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveAttribute('data-lng', '20');
    expect(markers[0]).toHaveAttribute('data-lat', '10');
    expect(markers[1]).toHaveAttribute('data-lng', '40');
    expect(markers[1]).toHaveAttribute('data-lat', '30');
});

it("shows a player's name on hover when a label is given, and no title attribute when it is not", () => {
    renderMap({
        otherPositions: [
            { id: 'alice', lat: 10, lng: 20, label: 'Alice' },
            { id: 'bob', lat: 30, lng: 40 },
        ],
    });
    const markers = screen.getAllByTestId('other-position-marker');
    expect(markers[0].querySelector('[title]')).toHaveAttribute('title', 'Alice');
    expect(markers[1].querySelector('[title]')).not.toBeInTheDocument();
});
```

The existing mocked `Marker` in this file (`data-testid="mock-marker"`) is shared by the own-position marker and would collide with these new assertions if reused unchanged — add a second mocked export is unnecessary; instead, read how the mock currently distinguishes markers (it currently doesn't need to — there's only ever been one). Extend the mock's `Marker` so it accepts and forwards a `data-testid` prop from its caller instead of hardcoding one:

```jsx
Marker: ({ longitude, latitude, children, 'data-testid': testId }) => (
    <div data-testid={testId ?? 'mock-marker'} data-lng={longitude} data-lat={latitude}>
        {children}
    </div>
),
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/GameMap.test.jsx`
Expected: the 3 new tests FAIL (`otherPositions` is not rendered at all yet); every pre-existing test still passes (the mock change is additive/backward-compatible — confirm this, don't just assume it).

- [ ] **Step 3: Implement**

In `src/components/map_components/GameMap.js`, add `otherPositions = []` to the destructured props:

```javascript
const GameMap = ({
    boundaryVertices,
    fitTo,
    dragPan = true,
    ownPosition,
    otherPositions = [],
    onMapLoad,
    onMapError,
    children,
}) => {
```

After the existing own-position `<Marker>` block inside the `<Map>` tree, add:

```jsx
{
    otherPositions.map((position) => (
        <Marker
            key={position.id}
            data-testid="other-position-marker"
            longitude={position.lng}
            latitude={position.lat}
        >
            <Box
                title={position.label || undefined}
                w="14px"
                h="14px"
                borderRadius="full"
                bg="#4299E1"
                border="2px solid white"
            />
        </Marker>
    ));
}
```

(`title={position.label || undefined}` rather than `title={position.label}` — an explicit `title=""` on a DOM element is still a present `title` attribute with an empty string, which the test's `not.toBeInTheDocument()` check for "no title at all" would not catch; `undefined` genuinely omits the attribute.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/GameMap.test.jsx`
Expected: all pass, including every pre-existing test.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx
npx eslint src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx --max-warnings=0
git add src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx
git commit -m "GameMap renders a list of other players' positions, with an optional hover label"
```

---

### Task 5: Query helpers for all-players and outside-only status feeds

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`

**Interfaces:**

- Produces: `fetchBoundaryStatusesQueryForRoom(roomID)` → a Firestore `Query` over the whole `boundaryStatuses` subcollection (no filter — used by the GM's always-allowed read). `fetchOutsideBoundaryStatusesQueryForRoom(roomID)` → a Firestore `Query` filtered to `where('status', '==', 'outside')` (used by a player's "who's exposed" feed, matching exactly the query shape Task 3's widened rule is provably safe for).

This task is mechanical, mirroring exact, already-shipped patterns in this same file — no dedicated test file, for the same reason `fetchBoundaryStatusReferenceForPlayer` (added in an earlier phase) has none: it is a thin wrapper around `collection()`/`query()`/`where()`, already imported at the top of this file.

- [ ] **Step 1: Add both query functions**

Read `fetchBoundaryStatusReferenceForPlayer`'s exact current location in `src/components/firebase_calls/dbCalls.js` first. Add directly after it:

```javascript
// Every boundary status in the room, unfiltered — only the host's read
// grant makes this succeed (firestore.rules); a non-host player's
// equivalent call is denied outright, by design, since Firestore cannot
// prove an unfiltered query safe under a rule only some documents satisfy
// (docs/superpowers/specs/2026-10-12-live-location-visibility-design.md).
export const fetchBoundaryStatusesQueryForRoom = (roomID) => {
    return collection(db, 'rooms', roomID, 'boundaryStatuses');
};

// Only the currently-outside statuses — the one query shape Firestore can
// prove safe for a non-host player under the widened boundaryStatuses read
// rule, since the rule's own condition matches this exact filter.
export const fetchOutsideBoundaryStatusesQueryForRoom = (roomID) => {
    return query(
        collection(db, 'rooms', roomID, 'boundaryStatuses'),
        where('status', '==', 'outside')
    );
};
```

- [ ] **Step 2: Format, lint, commit**

```bash
npx prettier --write src/components/firebase_calls/dbCalls.js
npx eslint src/components/firebase_calls/dbCalls.js --max-warnings=0
git add src/components/firebase_calls/dbCalls.js
git commit -m "Add query helpers for the all-players and outside-only boundary status feeds"
```

---

### Task 6: The GM's live player map

**Files:**

- Create: `src/components/map_components/LivePlayerMapButton.js`
- Create: `src/components/map_components/LivePlayerMapButton.test.jsx`
- Modify: `src/components/header_components/HeaderExecution.js`
- Modify: `src/components/header_components/HeaderExecution.test.jsx` (if it exists — check first; if not, this task does not need to create one, since `GameBoundaryButton`'s own addition to this file apparently didn't require one either — confirm by checking whether `HeaderExecution.test.jsx` currently asserts on `GameBoundaryButton`'s presence at all before deciding whether a new assertion belongs here)

**Interfaces:**

- Consumes: `GameMap` (Task 4's `otherPositions` prop), `isPositionFresh` (Task 1), `fetchBoundaryStatusesQueryForRoom` (Task 5).
- Produces: `LivePlayerMapButton` component. Props: `roomID` (string), `players` (array of `{name}` — this view only needs each player's display name to label markers; it does not need scores/targets/alive-status), `boundaryVertices` (`Array<{lat,lng}>|null`, default `null` — so the GM's live map can also show the boundary outline, not just the dots, when the caller has it in scope).

Read `src/components/map_components/GameBoundaryButton.js` in full first — this component is the same shape (owns its own open/closed modal state, takes just the props it needs) and the new one should mirror it, not invent a different pattern.

- [ ] **Step 1: Write the failing tests**

Create `src/components/map_components/LivePlayerMapButton.test.jsx`:

```jsx
/**
 * Layer 2 — React Testing Library. GameMap is stubbed (it has its own
 * thorough tests); this file stays focused on LivePlayerMapButton's own
 * job: opening the modal, subscribing to the room's boundary statuses, and
 * turning each live, fresh status into a GameMap otherPositions entry
 * labeled with the matching player's name.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import LivePlayerMapButton from './LivePlayerMapButton';

let lastGameMapProps;
jest.mock('./GameMap', () => (props) => {
    lastGameMapProps = props;
    return <div data-testid="mock-game-map" />;
});

let snapshotCallback;
jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn((ref, callback) => {
        snapshotCallback = callback;
        return jest.fn();
    }),
}));

jest.mock('../firebase_calls/dbCalls', () => ({
    fetchBoundaryStatusesQueryForRoom: jest.fn(() => 'statuses-query'),
}));

const makeSnapshot = (docs) => ({
    docs: docs.map(([id, data]) => ({ id, data: () => data })),
});

const NOW = 1_700_000_000_000;

const renderButton = (props = {}) =>
    render(
        <ChakraProvider>
            <LivePlayerMapButton
                roomID="room-a"
                players={[{ name: 'Alice' }, { name: 'Bob' }]}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    lastGameMapProps = undefined;
    snapshotCallback = undefined;
});

afterEach(() => jest.useRealTimers());

describe('LivePlayerMapButton', () => {
    it('opens the map modal on click', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));
        expect(screen.getByTestId('mock-game-map')).toBeInTheDocument();
    });

    it('turns each fresh status into a labeled otherPositions entry', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW - 1000 },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'alice', lat: 10, lng: 20, label: 'Alice' },
        ]);
    });

    it('excludes a status whose last usable fix has gone stale', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW - 60000 },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it('excludes a status with no lastUsableReceivedAt at all', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(makeSnapshot([['alice', { lat: 10, lng: 20 }]]));
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it('falls back to the raw document id as the label when no matching player name is found', () => {
        renderButton({ players: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    ['alice', { lat: 10, lng: 20, lastUsableReceivedAt: { toMillis: () => NOW } }],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'alice', lat: 10, lng: 20, label: 'alice' },
        ]);
    });
});
```

This test mocks `firebase/firestore` wholesale at the module level — check whether another test file in `src/components/map_components/` already does this for `onSnapshot` specifically (several files in `src/pages/` do, for comparison) and match the house style for how the mock module is structured if it differs from the sketch above; the sketch's shape is what matters, not its exact syntax.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/LivePlayerMapButton.test.jsx`
Expected: FAIL — `./LivePlayerMapButton` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/map_components/LivePlayerMapButton.js`:

```jsx
import React, { useEffect, useState } from 'react';
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import GameMap from './GameMap';
import { fetchBoundaryStatusesQueryForRoom } from '../firebase_calls/dbCalls';
// require(), not a named import — gameBoundary.js is CommonJS by design
// (see GameMap.js for the same pattern and why).
const { isPositionFresh } = require('../../game/gameBoundary');

/**
 * The GM's live map of every player's current location — every player,
 * at all times, not just outside ones (docs/superpowers/specs/
 * 2026-10-12-live-location-visibility-design.md). Subscribes to the whole
 * boundaryStatuses subcollection; only the host's Firestore read grant
 * makes this succeed at all (firestore.rules is unchanged for the host's
 * side of this — it already had no restriction).
 */
const LivePlayerMapButton = ({ roomID, players, boundaryVertices = null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [positions, setPositions] = useState([]);

    useEffect(() => {
        if (!isOpen || !roomID) return undefined;
        const statusesQuery = fetchBoundaryStatusesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(statusesQuery, (snapshot) => {
            const nowMs = Date.now();
            const next = [];
            snapshot.docs.forEach((doc) => {
                const data = doc.data();
                const lastUsableMs = data.lastUsableReceivedAt?.toMillis?.() ?? null;
                if (!isPositionFresh(lastUsableMs, nowMs)) return;
                const matchingPlayer = players.find((player) => player.name === doc.id);
                next.push({
                    id: doc.id,
                    lat: data.lat,
                    lng: data.lng,
                    label: matchingPlayer ? matchingPlayer.name : doc.id,
                });
            });
            setPositions(next);
        });
        return () => unsubscribe();
    }, [isOpen, roomID, players]);

    return (
        <>
            <Button
                colorScheme="teal"
                variant="outline"
                borderRadius="3xl"
                onClick={() => setIsOpen(true)}
            >
                Live Player Map
            </Button>
            <Modal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                size={{ base: 'full', md: '6xl' }}
            >
                <ModalOverlay />
                <ModalContent bg="#202030" h={{ base: '100%', md: '85vh' }}>
                    <ModalHeader color="#ffffff">Live Player Map</ModalHeader>
                    <ModalCloseButton aria-label="Close modal" />
                    <ModalBody>
                        <GameMap
                            boundaryVertices={boundaryVertices}
                            fitTo={null}
                            otherPositions={positions}
                            dragPan
                            onMapLoad={() => {}}
                            onMapError={() => {}}
                        />
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
};

export default LivePlayerMapButton;
```

Before finalizing this component's prop list: check whether `HeaderExecution`/`GameMasterView` already has the current `gameBoundary.vertices` in scope to hand to this component as a prop (`GameMasterView.js` already tracks `gameBoundary` in state). If so, add a `boundaryVertices` prop to `LivePlayerMapButton` and pass `boundaryVertices={gameBoundary?.vertices ?? null}` through from `HeaderExecution`, through to `GameMap`, instead of hardcoding `null` — so the GM's live map also shows the boundary outline, not just the dots. This is a one-line improvement available for free with data already in hand one level up, and should not be skipped.

In `src/components/header_components/HeaderExecution.js`, add the import and render it next to `GameBoundaryButton`:

```javascript
import LivePlayerMapButton from '../map_components/LivePlayerMapButton';
```

```jsx
<GameBoundaryButton roomID={roomID} gameBoundary={gameBoundary} />
<LivePlayerMapButton
    roomID={roomID}
    players={arrayOfAlivePlayers.map((name) => ({ name }))}
    boundaryVertices={gameBoundary?.vertices ?? null}
/>
```

Check `arrayOfAlivePlayers`'s actual current shape in `HeaderExecution.js` before writing this line — it may already be an array of plain name strings (as its own name suggests) rather than objects, in which case the `.map((name) => ({ name }))` above is exactly right; if `GameMasterView.js`'s `players` state (richer objects) is more appropriate to thread through instead, that is a `GameMasterView.js`/`HeaderExecution.js` prop-plumbing decision to make by reading both files' current prop flow fresh, not by guessing from this plan.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/LivePlayerMapButton.test.jsx`
Expected: all pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/LivePlayerMapButton.js src/components/map_components/LivePlayerMapButton.test.jsx src/components/header_components/HeaderExecution.js
npx eslint src/components/map_components/LivePlayerMapButton.js src/components/map_components/LivePlayerMapButton.test.jsx src/components/header_components/HeaderExecution.js --max-warnings=0
git add src/components/map_components/LivePlayerMapButton.js src/components/map_components/LivePlayerMapButton.test.jsx src/components/header_components/HeaderExecution.js
git commit -m "Add the GM's live player map, showing every player's current position"
```

---

### Task 7: Exposure feed, countdown warning, and copy update in PlayerGame

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`
- Modify: `src/components/map_components/PlayerMapModal.js`
- Modify: `src/components/map_components/PlayerMapModal.test.jsx`
- Modify: `docs/data-model.md`, `docs/architecture.md`, `docs/game-flows.md`

**Interfaces:**

- Consumes: `fetchOutsideBoundaryStatusesQueryForRoom` (Task 5), `isPositionFresh` (Task 1), `otherPositions` prop on `GameMap`/`PlayerMapModal` (Task 4), `GAME_BOUNDARY_CONFIG.confirmMinSpanMs` (already exported from `src/game/gameBoundary.js`).

Read `src/pages/PlayerGame.js` and `src/components/map_components/PlayerMapModal.js` in full before editing — both are now-mature files from Phase 3, not blank slates. This is the largest task in this plan; it has two genuinely separate pieces (the exposure feed, and the countdown popup) that happen to live in the same file.

#### Part A — PlayerMapModal gains otherPositions

- [ ] **Step 1: Write the failing test**

Add to `src/components/map_components/PlayerMapModal.test.jsx`:

```jsx
it('passes otherPositions straight through to GameMap', () => {
    const otherPositions = [{ id: 'bob', lat: 11, lng: 21 }];
    renderModal({ otherPositions });
    expect(lastProps.otherPositions).toEqual(otherPositions);
});
```

(This file's existing `renderModal` helper likely needs `otherPositions` added to its default props object — read it first and extend it rather than only the new test's own call site, matching how `ownPosition: null` is already defaulted there.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/PlayerMapModal.test.jsx`
Expected: FAIL — `lastProps.otherPositions` is `undefined` (not yet threaded through).

- [ ] **Step 3: Implement**

In `src/components/map_components/PlayerMapModal.js`, add `otherPositions = []` to the destructured props and pass it straight to `<GameMap>`:

```javascript
const PlayerMapModal = ({
    isOpen,
    onClose,
    boundaryVertices,
    ownPosition,
    otherPositions = [],
    statusText,
}) => {
```

```jsx
<GameMap
    boundaryVertices={boundaryVertices}
    fitTo={null}
    ownPosition={ownPosition}
    otherPositions={otherPositions}
    dragPan
    onMapLoad={handleMapLoad}
    onMapError={() => {}}
/>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/PlayerMapModal.test.jsx`
Expected: all pass.

#### Part B — PlayerGame's exposure feed and countdown

- [ ] **Step 5: Write the failing tests**

Add to `src/pages/PlayerGame.test.jsx`. Extend this file's existing `jest.mock('../components/firebase_calls/dbCalls', ...)` factory with `fetchOutsideBoundaryStatusesQueryForRoom: jest.fn(() => 'outside-statuses-query')`, matching how `fetchBoundaryStatusReferenceForPlayer` is already mocked there. Extend this file's existing room-snapshot/status-doc mocking helpers (read them fresh — do not assume their exact shape) to also support a second live `onSnapshot` subscription (the new outside-players query) the same way the existing `boundaryStatuses` own-doc subscription is already mocked, since this file already has at least two concurrent `onSnapshot` mocks to juggle.

```javascript
it("shows another player's position on the map once their status reads outside, excluding the viewer's own id", () => {
    // Seed: gameBoundary enabled/revision 1; the room's player list includes
    // 'bob'; the new outside-statuses query snapshot includes bob's doc
    // with status 'outside', lat/lng, and a recent lastUsableReceivedAt.
    // Open the map and assert the mocked PlayerMapModal's otherPositions
    // prop includes bob's position with a fresh lat/lng, and does NOT
    // include the viewer's own name even if seeded present in that same
    // query's result (defense against the query ever accidentally
    // including the viewer's own now-outside doc).
    mountPlayerGame();
    fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
    expect(mockLastPlayerMapModalProps.otherPositions).toEqual([{ id: 'bob', lat: 11, lng: 21 }]);
});

it('excludes a stale outside position from the map', () => {
    // Same seed shape as above, but lastUsableReceivedAt far enough in the
    // past (> GAME_BOUNDARY_CONFIG.freshnessMs) that isPositionFresh is
    // false.
    mountPlayerGame();
    fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
    expect(mockLastPlayerMapModalProps.otherPositions).toEqual([]);
});

it('shows a countdown warning while near-confirming outside, naming the seconds remaining', () => {
    // Seed the player's own boundaryStatuses doc with status: 'near' and an
    // outsideSince Timestamp set 5 seconds before "now" (use
    // jest.useFakeTimers().setSystemTime so "now" is exact and
    // controllable) — GAME_BOUNDARY_CONFIG.confirmMinSpanMs is 20000, so
    // 15 remaining seconds is the expected number.
    mountPlayerGame();
    expect(screen.getByText(/15/)).toBeInTheDocument();
});

it('replaces the countdown with an exposure notice the instant status is confirmed outside', () => {
    // Mount with the near/outsideSince seed from the previous test, then
    // simulate the room's status-doc subscription delivering a LATER
    // snapshot with status: 'outside' (this file's existing
    // onSnapshot.mockImplementation re-invocation pattern, same one Phase
    // 3's "Game area updated" test already uses) — assert the countdown
    // text is gone and a "your location is visible to everyone" (or
    // equivalent) notice is shown instead.
    mountPlayerGame();
    expect(screen.queryByText(/15/)).not.toBeInTheDocument();
    expect(screen.getByText(/visible to everyone/i)).toBeInTheDocument();
});

it('closing the map modal does not stop the outside-players subscription from updating', () => {
    // Mirrors the existing Phase 3 test proving useBoundaryLocation keeps
    // running after the modal closes — assert the outside-statuses
    // onSnapshot mock's call count/args are unaffected by toggling the
    // modal open and closed.
    mountPlayerGame();
    fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    // Assert the subscription established for the outside-players feed
    // was set up once, at PlayerGame's own mount, not tied to the modal.
});

it("removes a player's dot once their status is no longer outside, on the very next snapshot", () => {
    // Mount with bob present and outside (same seed as the first test in
    // this block), confirm his dot is in otherPositions, then simulate a
    // LATER snapshot of the outside-statuses query that no longer includes
    // bob's document at all (exactly what Firestore delivers once a
    // document stops matching a live query's filter — this file's
    // existing onSnapshot.mockImplementation re-invocation pattern can
    // simulate this by calling the captured callback a second time with a
    // snapshot whose docs array omits bob entirely). Assert
    // otherPositions no longer contains bob — this is the one place in
    // this task where "it just works because Firestore's query semantics
    // handle it" needs to actually be proven, not assumed.
    mountPlayerGame();
    fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
    expect(mockLastPlayerMapModalProps.otherPositions).toEqual([{ id: 'bob', lat: 11, lng: 21 }]);

    act(() => {
        triggerOutsideStatusesSnapshot([]); // bob no longer matches the query at all
    });

    expect(mockLastPlayerMapModalProps.otherPositions).toEqual([]);
});
```

Write each test's exact seeding against this file's ACTUAL existing mock shapes — read the file fully first; the sketches above describe intent, not a literal transcription to paste in blind, exactly as Phase 3's own plan said about this same file for the same reason.

- [ ] **Step 6: Run to verify the new tests fail**

Run: `npx jest src/pages/PlayerGame.test.jsx`
Expected: FAIL — none of this exists yet; every pre-existing test in this file still passes.

- [ ] **Step 7: Implement**

In `src/pages/PlayerGame.js`:

Add the new import alongside the existing `dbCalls` import line:

```javascript
import { fetchOutsideBoundaryStatusesQueryForRoom } from '../components/firebase_calls/dbCalls';
```

Add `isPositionFresh` to the existing `const { deriveFreshStatus, GAME_BOUNDARY_CONFIG } = require('../game/gameBoundary');` line (it is the exact same `require()` call site Task 1 touches too — do not add a second `require()` of the same module).

New state for the exposure feed:

```javascript
const [otherOutsidePositions, setOtherOutsidePositions] = useState([]);
```

A new subscription, mounted unconditionally once the boundary is enabled (same gating as the existing own-status subscription, same reasoning: it must not depend on whether the map modal happens to be open):

```javascript
useEffect(() => {
    if (!roomID || !gameBoundary?.enabled) {
        setOtherOutsidePositions([]);
        return undefined;
    }
    const outsideQuery = fetchOutsideBoundaryStatusesQueryForRoom(roomID);
    const unsubscribe = onSnapshot(
        outsideQuery,
        (snapshot) => {
            const nowMs = Date.now();
            const next = [];
            snapshot.docs.forEach((doc) => {
                if (doc.id === normalizePlayerName(playerName)) return; // never show yourself
                const data = doc.data();
                const lastUsableMs = data.lastUsableReceivedAt?.toMillis?.() ?? null;
                if (!isPositionFresh(lastUsableMs, nowMs)) return;
                next.push({ id: doc.id, lat: data.lat, lng: data.lng });
            });
            setOtherOutsidePositions(next);
        },
        () => setOtherOutsidePositions([])
    );
    return () => unsubscribe();
}, [roomID, gameBoundary?.enabled, playerName]);
```

Check whether `normalizePlayerName` is already imported in this file (it very likely is, given `playerName` is already compared/used elsewhere here) before adding a second import of it.

The countdown. Derive it as a plain computed value each render, from data already on `boundaryStatusDoc` (no new Firestore field, per the spec):

```javascript
const outsideSinceMs = boundaryStatusDoc?.outsideSince?.toMillis?.() ?? null;
const isApproachingExposure = liveBoundaryStatus.status === 'near' && outsideSinceMs !== null;
const secondsUntilExposed = isApproachingExposure
    ? Math.max(
          0,
          Math.ceil((GAME_BOUNDARY_CONFIG.confirmMinSpanMs - (nowMs - outsideSinceMs)) / 1000)
      )
    : null;
```

Render, alongside the existing permission/status boxes inside the `{gameBoundary?.enabled && (...)}` block:

```jsx
{
    isApproachingExposure && (
        <Box bg="orange.700" color="white" borderRadius="md" p={2} mb={2} textAlign="center">
            <Text fontWeight="bold">
                Return to the game area — your location will be revealed to everyone in{' '}
                {secondsUntilExposed}s.
            </Text>
        </Box>
    );
}
{
    liveBoundaryStatus.status === 'outside' && (
        <Box bg="red.900" color="white" borderRadius="md" p={2} mb={2} textAlign="center">
            <Text fontWeight="bold">
                You are outside the game area — your location is visible to everyone until you
                return.
            </Text>
        </Box>
    );
}
```

(This second box replaces the existing bare `outside` status box from Phase 3's wiring — read that existing block first, since this is a copy change to an already-shipped `{liveBoundaryStatus.status === 'outside' && (...)}` branch, not a new, separate conditional alongside it.)

Pass `otherOutsidePositions` to `PlayerMapModal`:

```jsx
<PlayerMapModal
    isOpen={isMapOpen}
    onClose={onMapClose}
    boundaryVertices={gameBoundary.vertices}
    otherPositions={otherOutsidePositions}
    ownPosition={
        ownPosition && nowMs - ownPosition.acquiredAtMs <= GAME_BOUNDARY_CONFIG.freshnessMs
            ? ownPosition
            : null
    }
    statusText={mapStatusText}
/>
```

Finally, the player-facing copy. Find the pre-permission explanation's exact current text (Phase 3 wired it verbatim from the spec: "Turn on location so we can check that you are inside the game area. The moderator sees your boundary status. Other players cannot see your location. Keep the game open for location updates.") and change the third sentence to reflect the exception:

```
Other players cannot see your location unless you leave the game area.
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx jest src/pages/PlayerGame.test.jsx`
Expected: all pass, including every pre-existing test in this file.

- [ ] **Step 9: Format, lint, full test run, build, commit**

```bash
npm run format
npm run lint
npm test -- --watchAll=false
npm run build
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx src/components/map_components/PlayerMapModal.js src/components/map_components/PlayerMapModal.test.jsx
git commit -m "Show exposed players on the map, and a countdown before a player's own exposure"
```

- [ ] **Step 10: Update documentation**

Update `docs/data-model.md`'s `boundaryStatuses` section: add `lat`/`lng` to the field table (see the spec's own table for exact wording), replace the "No coordinates are stored in `boundaryStatuses`..." sentence with the spec's updated privacy statement, AND update the separate "Reads:" paragraph's sentence "A player can read only their own status document... There is no list grant for players" — it is now stale (Task 3 already widened the actual rule; this paragraph just describes it in prose) and needs to state the new exception: any player may also read another player's status once it reads `outside`, though there is still no grant broad enough to list every status unfiltered. Add a short paragraph to `docs/architecture.md` naming `LivePlayerMapButton.js` in the component inventory. Add a short paragraph to `docs/game-flows.md` describing the new flow: a player drifts outside → sees the countdown → status confirms outside → every other player's (and the GM's) map shows their position → they return inside → it disappears immediately. Read all three files first and match each one's existing section style (the same files Phases 1-3 already extended for this feature, each more than once).

```bash
git add docs/data-model.md docs/architecture.md docs/game-flows.md
git commit -m "Document live location visibility in data-model, architecture, and game-flows"
```

---

## Final gate

Before calling this plan done, run the full gate from `CLAUDE.md`:

```bash
npm run format
npm run lint
npm test
npm run build
```

`npm run test:emulator` and `npm run test:rules` are both exercised directly by this plan (Tasks 2 and 3) and must also be run as part of this final gate, not just during their own tasks — a later task's changes could in principle affect either.

Device checks confirming the exposure countdown and live markers behave correctly on a real phone, outdoors, crossing a real boundary, are the user's own step — nothing in this plan's automated gate can substitute for that, same as every prior phase's plan has noted.
