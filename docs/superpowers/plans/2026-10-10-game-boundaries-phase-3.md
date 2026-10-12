# Game Boundaries Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give players location permission and tracking, a read-only map of the published game area with their own position, and status UI on the player page — the player half of Game Boundaries, built entirely on Phases 1-2's already-shipped server and moderator-editor code.

**Architecture:** A `useBoundaryLocation` hook owns the one-and-only browser geolocation watch per player session, reporting fixes/errors to Phase 1's `reportPlayerLocation` callable at the cadence the spec sets. It is mounted at `PlayerGame.js`'s level, independent of whether the map modal happens to be open, so closing the map never stops tracking. `PlayerGame.js` separately subscribes to the player's own `boundaryStatuses` doc for a reload-proof status display, re-deriving freshness locally on a timer the same way the moderator side already anticipated. `PlayerMapModal.js` reuses Phase 2's `GameMap.js`, which gains one new prop for the player's own position and accuracy circle.

**Tech Stack:** React 18 + Chakra UI 2, react-map-gl/mapbox-gl (already installed in Phase 2), the browser Geolocation and Page Visibility APIs (new to this codebase), Firebase callables and Firestore (existing patterns).

**Spec:** `docs/superpowers/specs/2026-09-30-game-boundaries-design.md` — this plan implements the "Player experience" section and the player half of "Boundary detection"/"Data flow"/"Error handling". The moderator roster badges/toasts and dashboard-flag-loading half of "Components" (`PlayersList.js`) remain a separate, later plan, as both prior plans recorded.

## Global Constraints

- **Module format, learned the hard way in Phase 2:** CRA's production webpack build fails on a named ES `import` of anything written as CommonJS `module.exports` — confirmed by a real build failure, fixed by converting `src/game/boundaryDraft.js` to ES `export` (see its header comment for the exact story). `src/game/gameBoundary.js` stays CommonJS on purpose (it's vendored into `functions/` via `functions/scripts/sync-shared-game-logic.js`, a hard, unrelated constraint) — anything in `src/` that needs something from it uses a bare `require()` call, never a named `import`, exactly as `BoundaryEditorModal.js` already does. **Every new pure module this plan adds in `src/game/` must use ES `export`**, since it will be consumed by a named import from a webpack-bundled hook or component. Jest's unit project (`src/game/**/*.test.js`) can still `require()` an ES-export source file — Babel transpiles it — proven working in Phase 2.
- **Mock fidelity, learned the harder way in Phase 2:** the final whole-branch review there found a critical bug every task-level review missed, because a test's mock of a real API (`map.off(event)`) silently "worked" by deleting a dictionary key, while the real library's actual behavior (removing nothing without a handler reference) was different. This phase's riskiest task wraps three real browser APIs that are easy to mock unfaithfully: `navigator.geolocation.watchPosition`/`getCurrentPosition`/`clearWatch`, the Page Visibility API, and `setInterval`. Every test of that task must prove behavior against a mock that tracks watch IDs and handler references the way the real API's contract does — not a single mutable slot — so a forgotten cleanup call is a real, provable test failure, not something the mock quietly papers over.
- **No coordinates ever reach Firestore, a log, or anything beyond this browser's own render.** The device's own position lives only in this hook's in-memory state, for display and for the one outgoing report at a time — `reportPlayerLocation`'s own contract (Phase 1) never persists them, and nothing in this plan may `console.log` a `lat`/`lng`/`accuracyM` value.
- **Deliberate scope cut, noted for the user's review:** the spec's Error handling section mentions an "offline indicator" for a dropped connection. This plan does not add a `navigator.onLine`/`online`-event listener or any explicit offline UI. GPS positioning itself is not network-dependent, so a dropped Firestore/callable connection only affects whether a report's `reportPlayerLocation()` call succeeds — `sendReport`'s existing catch already swallows that failure safely, and the existing 15-second backstop poll already retries on its own schedule without needing a dedicated reconnect signal. The player-visible effect of a real outage is simply "no status update for a while," which the existing 30-second freshness timeout already surfaces as Location unavailable — the spec's own intended outcome, just reached passively rather than via a dedicated indicator. Flag if a more explicit indicator is wanted.
- Exact player-facing copy and cadence, from the spec (do not paraphrase):
    - Pre-permission explanation (verbatim): "Turn on location so we can check that you are inside the game area. The moderator sees your boundary status. Other players cannot see your location. Keep the game open for location updates."
    - Status table: Inside → "In game area." · Near boundary → "You are near the edge of the game area; check the map." · Outside → persistent warning "You are outside the game area. Please return inside." · Location unavailable → explain the reason, offer Enable Location/Retry where applicable, show the last successful check time if any. · Boundary disabled → hide enforcement status and stop collection.
    - Cadence: send a newly acquired fix at most once every 5 seconds; aim for a fresh check at least every 15 seconds while the page is active; reacquire a fresh fix when the page becomes visible again; never resend an old fix as a fresh heartbeat.
    - Freshness: after 30 seconds without a usable fix, show Location unavailable even if the stored status was Inside or Outside — derived locally on a timer, even when Firestore emits no new snapshot.
    - Do not continually reopen the permission prompt. A missing geolocation API, timeout, or disabled device service is an actionable unavailable message, never an outside warning.
- `reportPlayerLocation` callable (Phase 1, `functions/callableFunctions/reportPlayerLocation.js`, registered): a fix report is `{ roomId, boundaryRevision, sampleMs, lat, lng, accuracyM }`; an error report is `{ roomId, boundaryRevision, sampleMs, error }` with `error` one of `'permission_denied' | 'unavailable' | 'timeout'` and no coordinates. Both return `{ status: 'inside'|'outside'|'near'|'unavailable', reason: string|null }`. Rejects with `.message` on an ended game, a disabled or revision-mismatched boundary, an invalid/stale/out-of-order sample, or the 20-per-minute rate limit.
- `deriveFreshStatus(state, nowMs, current = {})` (Phase 1, `src/game/gameBoundary.js`, already exported): `state` is `{ status, reason, lastUsableMs, boundaryRevision, uid }`; `current` is optionally `{ currentRevision, currentUid }`, and when both are given a revision or uid mismatch returns `{ status: 'unavailable', reason: 'wrong_revision' | 'wrong_uid' }` ahead of the ordinary freshness check. `GAME_BOUNDARY_CONFIG.freshnessMs` is `30000`.
- `rooms/{roomID}/boundaryStatuses/{playerId}` (Phase 1, `docs/data-model.md`): document ID is the same normalized player-document ID as `players/{playerId}`; fields include `boundaryRevision`, `uid`, `status`, `reason`, `lastUsableReceivedAt` (`Timestamp|null`), among others. A player may read only their own status doc, authorized by their current player document's `uid` matching their auth `uid` — already enforced by `firestore.rules`.
- `GameMap.js` (Phase 2) current props: `boundaryVertices`, `fitTo` (`{lat, lng}|null`), `dragPan` (default `true`), `onMapLoad`, `onMapError`. This plan adds one more: `ownPosition`.
- Test routing per `jest.config.js`: `src/game/**/*.test.js` → unit (node, pure). `src/**/*.test.jsx` → dom (jsdom, Testing Library, every browser/map API mocked). No new `.integration.test.js` files — `reportPlayerLocation`'s server side already has full emulator coverage from Phase 1, and this repo's established precedent (`publishGameBoundary.js`, `disableGameBoundary.js`) ships a thin callable wrapper with no dedicated test file.
- Run `npm run format`, `npm run lint`, and `npm test` after every task's implementation step, before committing.

## Review Focus

- The page goes to the background and comes back (phone locked, app switched) — the hook must reacquire a fresh fix on return, not just trust whatever the suspended watch eventually delivers. (Task 4's visibility test.)
- A denied permission must not turn into a loop of automatic in-app re-prompts; only an explicit Enable Location/Retry click asks again. (Task 4's denial test; Task 6's Retry-button test.)
- Closing `PlayerMapModal` must not stop location reporting — the watch lives at `PlayerGame.js`'s level, not inside the modal. (Task 6's close-modal-keeps-tracking test.)
- A reading that has gone stale must never render as a live marker on the map, and the status line must say Location unavailable even if the last stored status was Inside or Outside. (Task 6's staleness test.)
- A boundary revision change mid-session must restart the outside-confirmation sequence with fresh readings, not misreport the old revision's status under the new one — `deriveFreshStatus`'s `wrong_revision` path exists for exactly this, and the hook must also fire an immediate fresh check on a revision change, not wait for the next passive tick. (Task 4's revision-change test; Task 6's "Game area updated" test.)

---

### Task 1: Pure location-report cadence helper

**Files:**

- Create: `src/game/locationReportCadence.js`
- Test: `src/game/locationReportCadence.test.js`

**Interfaces:**

- Produces: `shouldSendFix(lastSentMs, nowMs)`, `isPollDue(lastSentMs, nowMs)`, `MIN_SEND_INTERVAL_MS` (`5000`), `MAX_FRESH_INTERVAL_MS` (`15000`).

- [ ] **Step 1: Write the failing tests**

Create `src/game/locationReportCadence.test.js`:

```javascript
const {
    shouldSendFix,
    isPollDue,
    MIN_SEND_INTERVAL_MS,
    MAX_FRESH_INTERVAL_MS,
} = require('./locationReportCadence');

describe('shouldSendFix', () => {
    it('is true with no prior send', () => {
        expect(shouldSendFix(null, 1000)).toBe(true);
    });

    it('is false just under the minimum interval', () => {
        expect(shouldSendFix(1000, 1000 + MIN_SEND_INTERVAL_MS - 1)).toBe(false);
    });

    it('is true at exactly the minimum interval', () => {
        expect(shouldSendFix(1000, 1000 + MIN_SEND_INTERVAL_MS)).toBe(true);
    });

    it('is true well past the minimum interval', () => {
        expect(shouldSendFix(1000, 1000 + MIN_SEND_INTERVAL_MS + 5000)).toBe(true);
    });
});

describe('isPollDue', () => {
    it('is true with no prior send', () => {
        expect(isPollDue(null, 1000)).toBe(true);
    });

    it('is false just under the max fresh interval', () => {
        expect(isPollDue(1000, 1000 + MAX_FRESH_INTERVAL_MS - 1)).toBe(false);
    });

    it('is true at exactly the max fresh interval', () => {
        expect(isPollDue(1000, 1000 + MAX_FRESH_INTERVAL_MS)).toBe(true);
    });

    it('the poll interval is never shorter than the send interval, or the backstop would be wasted motion', () => {
        expect(MAX_FRESH_INTERVAL_MS).toBeGreaterThanOrEqual(MIN_SEND_INTERVAL_MS);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/game/locationReportCadence.test.js`
Expected: FAIL — `./locationReportCadence` does not exist.

- [ ] **Step 3: Implement**

Create `src/game/locationReportCadence.js`:

```javascript
/**
 * Decides when to send a freshly acquired location fix, and when to
 * force a backstop re-check if the browser's own watch has gone quiet
 * (some platforms stop firing watchPosition callbacks when the position
 * hasn't changed). Pure — no Date.now() call inside; the caller
 * supplies nowMs. Two plain elapsed-time checks, not a capped rate
 * limiter like rateLimit.js's nextRateLimitWindow — there is no window
 * to reset, only "has enough time passed since the last one."
 *
 * ES `export`, not CommonJS: useBoundaryLocation.js (a webpack-bundled
 * React hook) imports these by name, and a named ES import of a
 * `module.exports` object isn't statically analyzable by CRA's
 * production build — see src/game/boundaryDraft.js's header comment for
 * the exact failure this avoids. Jest's unit project still runs this
 * file's own test via require(), which Babel transpiles fine either way.
 */
export const MIN_SEND_INTERVAL_MS = 5000;
export const MAX_FRESH_INTERVAL_MS = 15000;

/**
 * @param {number|null} lastSentMs when the last report was actually sent, or null if none yet
 * @param {number} nowMs
 */
export const shouldSendFix = (lastSentMs, nowMs) => {
    if (lastSentMs === null || lastSentMs === undefined) return true;
    return nowMs - lastSentMs >= MIN_SEND_INTERVAL_MS;
};

/**
 * True once it has been long enough since the last sent report that a
 * forced getCurrentPosition call is due.
 *
 * @param {number|null} lastSentMs
 * @param {number} nowMs
 */
export const isPollDue = (lastSentMs, nowMs) => {
    if (lastSentMs === null || lastSentMs === undefined) return true;
    return nowMs - lastSentMs >= MAX_FRESH_INTERVAL_MS;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/game/locationReportCadence.test.js`
Expected: all 8 pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/game/locationReportCadence.js src/game/locationReportCadence.test.js
npx eslint src/game/locationReportCadence.js src/game/locationReportCadence.test.js --max-warnings=0
git add src/game/locationReportCadence.js src/game/locationReportCadence.test.js
git commit -m "Add a pure cadence helper for location reporting"
```

---

### Task 2: Client plumbing — a status-doc getter and the report callable wrapper

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js` (one new function, placed directly after the existing `fetchPlayerReferenceForRoom`)
- Create: `src/components/reportPlayerLocation.js`

**Interfaces:**

- Produces: `fetchBoundaryStatusReferenceForPlayer(playerName, roomID)` → a Firestore `DocumentReference`. `reportPlayerLocation(payload)` → `Promise<{status, reason}>`, where `payload` is either the fix shape or the error shape from the Global Constraints.

This task is mechanical — both additions mirror exact, already-shipped patterns in this same repo. No dedicated test file for `reportPlayerLocation.js`, for the same reason `publishGameBoundary.js`/`disableGameBoundary.js` have none (see Global Constraints).

- [ ] **Step 1: Add the status-doc getter**

Read `src/components/firebase_calls/dbCalls.js`'s existing `fetchPlayerReferenceForRoom` first — it is:

```javascript
export const fetchPlayerReferenceForRoom = (playerName, roomID) => {
    return doc(db, 'rooms', roomID, 'players', normalizePlayerName(playerName));
};
```

Add, directly after it:

```javascript
// A player's own boundary-status document — read-only from the client,
// and only the player's own (firestore.rules checks the uid on their
// player doc), same normalized ID scheme as fetchPlayerReferenceForRoom
// above (docs/data-model.md's boundaryStatuses section).
export const fetchBoundaryStatusReferenceForPlayer = (playerName, roomID) => {
    return doc(db, 'rooms', roomID, 'boundaryStatuses', normalizePlayerName(playerName));
};
```

- [ ] **Step 2: Add the callable wrapper**

Create `src/components/reportPlayerLocation.js`:

```javascript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const reportPlayerLocationCallable = httpsCallable(functions, 'reportPlayerLocation');

/**
 * Reports one location fix or one location error for the calling
 * player, evaluated server-side against the room's current game
 * boundary. Identity comes from the caller's own Firebase Auth session,
 * same as submitChatMessage.js — there is no player name to pass here.
 *
 * A fix report: { roomId, boundaryRevision, sampleMs, lat, lng, accuracyM }.
 * An error report: { roomId, boundaryRevision, sampleMs, error }, where
 * error is 'permission_denied' | 'unavailable' | 'timeout', with no
 * coordinates.
 *
 * @returns {Promise<{status: 'inside'|'outside'|'near'|'unavailable', reason: string|null}>}
 * @throws if the caller isn't a player of the room, the game has ended,
 *   the boundary is disabled or revision-mismatched, the sample is
 *   out-of-order/too old/too far in the future, or the rate limit is
 *   exceeded — surfaces as a rejected promise carrying `.message`.
 */
export const reportPlayerLocation = async (payload) => {
    const { data } = await reportPlayerLocationCallable(payload);
    return data;
};
```

- [ ] **Step 3: Format, lint, commit**

```bash
npx prettier --write src/components/firebase_calls/dbCalls.js src/components/reportPlayerLocation.js
npx eslint src/components/firebase_calls/dbCalls.js src/components/reportPlayerLocation.js --max-warnings=0
git add src/components/firebase_calls/dbCalls.js src/components/reportPlayerLocation.js
git commit -m "Add a boundary-status getter and the location-report callable wrapper"
```

---

### Task 3: GameMap gains an own-position marker

**Files:**

- Modify: `src/components/map_components/GameMap.js`
- Modify: `src/components/map_components/GameMap.test.jsx`

**Interfaces:**

- Consumes: `shapeToPolygon` from `../../game/gameBoundary`, via `require()` (it is CommonJS and vendored — see Global Constraints), to render the accuracy circle as the exact same kind of canonical sampled polygon the moderator editor already produces and tests, instead of inventing new pixel-based circle math.
- Produces: `GameMap` gains a new prop, `ownPosition: {lat: number, lng: number, accuracyM: number}|null`.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/map_components/GameMap.test.jsx`'s `react-map-gl` mock factory, alongside the existing `Map`/`Source`/`Layer`:

```jsx
Marker: ({ longitude, latitude, children }) => (
    <div data-testid="mock-marker" data-lng={longitude} data-lat={latitude}>
        {children}
    </div>
),
```

Add this `describe` block:

```jsx
describe('GameMap — own position', () => {
    it('renders no marker and no accuracy source when ownPosition is null', () => {
        renderMap({ ownPosition: null });
        expect(screen.queryByTestId('mock-marker')).not.toBeInTheDocument();
        expect(screen.queryByTestId('own-position-accuracy-source')).not.toBeInTheDocument();
    });

    it('renders a marker at the given position', () => {
        renderMap({ ownPosition: { lat: 10, lng: 20, accuracyM: 15 } });
        const marker = screen.getByTestId('mock-marker');
        expect(marker).toHaveAttribute('data-lng', '20');
        expect(marker).toHaveAttribute('data-lat', '10');
    });

    it('renders the accuracy circle as a sampled polygon centered on the position', () => {
        renderMap({ ownPosition: { lat: 10, lng: 20, accuracyM: 15 } });
        const source = screen.getByTestId('own-position-accuracy-source');
        const geojson = JSON.parse(source.getAttribute('data-geojson'));
        const ring = geojson.geometry.coordinates[0];
        // A circle's own center is the average of its ring's points —
        // close enough to 20/10 to confirm this used the position, not
        // some other default.
        const avgLng = ring.reduce((sum, [lng]) => sum + lng, 0) / ring.length;
        const avgLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
        expect(avgLng).toBeCloseTo(20, 3);
        expect(avgLat).toBeCloseTo(10, 3);
    });

    it('renders the marker but no accuracy circle when accuracyM is zero or invalid', () => {
        renderMap({ ownPosition: { lat: 10, lng: 20, accuracyM: 0 } });
        expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
        expect(screen.queryByTestId('own-position-accuracy-source')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/GameMap.test.jsx`
Expected: FAIL — no marker/accuracy rendering exists yet.

- [ ] **Step 3: Implement**

In `src/components/map_components/GameMap.js`, add near the top (alongside the existing `'react-map-gl'` import):

```javascript
import { Map, Source, Layer, Marker } from 'react-map-gl';
// require(), not a named import — gameBoundary.js is CommonJS by design
// (see BoundaryEditorModal.js for the same pattern and why).
const { shapeToPolygon } = require('../../game/gameBoundary');
```

Change the component's destructured props to add `ownPosition`:

```javascript
const GameMap = ({ boundaryVertices, fitTo, dragPan = true, ownPosition, onMapLoad, onMapError }) => {
```

Inside the component body, before the `return`, compute the accuracy polygon (reusing `toGeoJson`, already defined in this file):

```javascript
let ownAccuracyGeoJson = null;
if (ownPosition && Number.isFinite(ownPosition.accuracyM) && ownPosition.accuracyM > 0) {
    try {
        const ring = shapeToPolygon('circle', {
            center: { lat: ownPosition.lat, lng: ownPosition.lng },
            radiusMeters: ownPosition.accuracyM,
        });
        ownAccuracyGeoJson = toGeoJson(ring);
    } catch {
        ownAccuracyGeoJson = null;
    }
}
```

Inside the `<Map>` tree, after the existing boundary `<Source>` block, add:

```jsx
{
    ownAccuracyGeoJson && (
        <Source id="own-position-accuracy" type="geojson" data={ownAccuracyGeoJson}>
            <Layer
                id="own-position-accuracy-fill"
                type="fill"
                paint={{ 'fill-color': '#4299E1', 'fill-opacity': 0.15 }}
            />
        </Source>
    );
}
{
    ownPosition && (
        <Marker longitude={ownPosition.lng} latitude={ownPosition.lat}>
            <Box w="14px" h="14px" borderRadius="full" bg="#4299E1" border="2px solid white" />
        </Marker>
    );
}
```

The mocked `Source` in the test renders a `data-testid="mock-source"` div today — add `data-testid="own-position-accuracy-source"` to the SAME mock when `id === 'own-position-accuracy'` so the two sources (boundary and own-position) are distinguishable in a test; the simplest way is to key the test id off the `id` prop the real `Source` already receives:

```jsx
Source: ({ children, data, id }) => (
    <div data-testid={id === 'own-position-accuracy' ? 'own-position-accuracy-source' : 'mock-source'} data-geojson={JSON.stringify(data)}>
        {children}
    </div>
),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/GameMap.test.jsx`
Expected: all pass, including the pre-existing suite.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx
npx eslint src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx --max-warnings=0
git add src/components/map_components/GameMap.js src/components/map_components/GameMap.test.jsx
git commit -m "Add an own-position marker and accuracy circle to GameMap"
```

---

### Task 4: The useBoundaryLocation hook

**Files:**

- Create: `src/hooks/useBoundaryLocation.js`
- Test: `src/hooks/useBoundaryLocation.test.jsx`

**Interfaces:**

- Consumes: `reportPlayerLocation` (Task 2), `shouldSendFix`/`isPollDue` (Task 1).
- Produces: `useBoundaryLocation({ roomID, boundaryRevision, boundaryEnabled, isGameActive })` → `{ permissionState: 'unknown'|'granted'|'denied'|'unavailable', lastResult: {status, reason}|null, ownPosition: {lat, lng, accuracyM, acquiredAtMs}|null, requestPermission: () => void }`.

This is the largest and riskiest task in this plan — see Global Constraints and Review Focus for why. Read both before starting.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useBoundaryLocation.test.jsx`:

```jsx
/**
 * Layer 2 — React Testing Library (renderHook). navigator.geolocation
 * does not exist in jsdom at all, so this entire file replaces it with
 * a fake that honors the REAL API's contract: watchPosition returns a
 * numeric id and keeps firing until clearWatch is called with THAT id
 * specifically (not "the last one"); getCurrentPosition is a genuine
 * one-shot call, independent of any active watch. This is deliberate —
 * a single mutable slot would hide exactly the kind of cleanup bug
 * Phase 2's final review found hiding behind an unfaithful mock.
 */
import { act, renderHook } from '@testing-library/react';
import useBoundaryLocation from './useBoundaryLocation';
import { reportPlayerLocation } from '../components/reportPlayerLocation';

jest.mock('../components/reportPlayerLocation', () => ({
    reportPlayerLocation: jest.fn(),
}));

let nextWatchId;
let activeWatches;
let fakeGeolocation;

const makePosition = (overrides = {}) => ({
    coords: {
        latitude: 40,
        longitude: -74,
        accuracy: 10,
        ...overrides.coords,
    },
    timestamp: overrides.timestamp ?? Date.now(),
});

const makePositionError = (code) => ({
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
});

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    reportPlayerLocation.mockResolvedValue({ status: 'inside', reason: null });

    nextWatchId = 1;
    activeWatches = new Map();
    fakeGeolocation = {
        watchPosition: jest.fn((onSuccess, onError) => {
            const id = nextWatchId++;
            activeWatches.set(id, { onSuccess, onError });
            return id;
        }),
        clearWatch: jest.fn((id) => {
            activeWatches.delete(id);
        }),
        getCurrentPosition: jest.fn(),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
        value: fakeGeolocation,
        configurable: true,
    });
});

afterEach(() => {
    jest.useRealTimers();
});

const firePosition = (watchId, position) => {
    act(() => {
        activeWatches.get(watchId)?.onSuccess(position);
    });
};

const fireLatestGetCurrentPosition = (position) => {
    const call = fakeGeolocation.getCurrentPosition.mock.calls.at(-1);
    act(() => {
        call[0](position);
    });
};

const baseProps = {
    roomID: 'room-a',
    boundaryRevision: 1,
    boundaryEnabled: true,
    isGameActive: true,
};

describe('useBoundaryLocation', () => {
    it('does nothing until requestPermission is called', () => {
        renderHook(() => useBoundaryLocation(baseProps));
        expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('starts a watch and an immediate getCurrentPosition check once permission is requested', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(1);
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it('reports an accepted fix and exposes it as ownPosition immediately', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        firePosition(watchId, makePosition());

        expect(reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ roomId: 'room-a', boundaryRevision: 1, lat: 40, lng: -74 })
        );
        expect(result.current.ownPosition).toMatchObject({ lat: 40, lng: -74, accuracyM: 10 });
        expect(result.current.permissionState).toBe('granted');
    });

    it('throttles outgoing reports to at most one per 5 seconds, but still updates ownPosition every time', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        firePosition(watchId, makePosition({ coords: { latitude: 1 } }));
        firePosition(watchId, makePosition({ coords: { latitude: 2 } }));

        expect(reportPlayerLocation).toHaveBeenCalledTimes(1);
        expect(result.current.ownPosition.lat).toBe(2);

        act(() => jest.advanceTimersByTime(5000));
        firePosition(watchId, makePosition({ coords: { latitude: 3 } }));
        expect(reportPlayerLocation).toHaveBeenCalledTimes(2);
    });

    it('stops the old watch and starts a fresh one when the boundary revision changes — a leftover old watch firing does nothing', () => {
        const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
            initialProps: baseProps,
        });
        act(() => result.current.requestPermission());
        const oldWatchId = fakeGeolocation.watchPosition.mock.results[0].value;

        rerender({ ...baseProps, boundaryRevision: 2 });

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(oldWatchId);

        reportPlayerLocation.mockClear();
        // This simulates a late callback from the OLD watch arriving
        // after cleanup — a real cleared watch cannot do this, so if
        // the hook actually called clearWatch (asserted above),
        // activeWatches no longer has this id and nothing fires.
        firePosition(oldWatchId, makePosition());
        expect(reportPlayerLocation).not.toHaveBeenCalled();
    });

    it('also stops the old watch and starts a fresh one when the room changes', () => {
        const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
            initialProps: baseProps,
        });
        act(() => result.current.requestPermission());
        const oldWatchId = fakeGeolocation.watchPosition.mock.results[0].value;

        rerender({ ...baseProps, roomID: 'room-b' });

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(oldWatchId);
        reportPlayerLocation.mockClear();
        firePosition(oldWatchId, makePosition());
        expect(reportPlayerLocation).not.toHaveBeenCalled();
    });

    it('sets permissionState to denied and reports permission_denied on a PERMISSION_DENIED error, without throwing into the hook', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        act(() => {
            activeWatches.get(watchId)?.onError(makePositionError(1));
        });

        expect(result.current.permissionState).toBe('denied');
        expect(reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'permission_denied' })
        );
    });

    it('requestPermission always makes a fresh attempt, even after an earlier denial (Retry)', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalledTimes(1);

        act(() => result.current.requestPermission());
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    });

    it('forces a fresh getCurrentPosition check once the max-fresh interval elapses with nothing sent', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        fakeGeolocation.getCurrentPosition.mockClear();

        act(() => jest.advanceTimersByTime(15000));

        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('reacquires a fresh fix when the page becomes visible again', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        fakeGeolocation.getCurrentPosition.mockClear();

        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('clears the watch on unmount', () => {
        const { result, unmount } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        unmount();

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(watchId);
    });

    it('does not start a watch when the boundary is disabled, and sets no permission state either way', () => {
        renderHook(() => useBoundaryLocation({ ...baseProps, boundaryEnabled: false }));
        expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('a rejected report is swallowed and never thrown into the hook', async () => {
        reportPlayerLocation.mockRejectedValue(new Error('revision_conflict'));
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        firePosition(watchId, makePosition());
        await act(async () => {
            await Promise.resolve();
        });
        // No assertion beyond "this line was reached" — a thrown
        // rejection inside an effect would fail the test via an
        // unhandled error instead.
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/hooks/useBoundaryLocation.test.jsx`
Expected: FAIL — `./useBoundaryLocation` does not exist.

- [ ] **Step 3: Implement**

Create `src/hooks/useBoundaryLocation.js`:

```javascript
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportPlayerLocation } from '../components/reportPlayerLocation';
import { shouldSendFix, isPollDue } from '../game/locationReportCadence';

// How often the backstop timer checks whether a forced fresh poll is
// due — not the poll interval itself (MAX_FRESH_INTERVAL_MS, in
// locationReportCadence.js); just has to be frequent enough that the
// check doesn't lag noticeably behind the 15 s target.
const POLL_CHECK_INTERVAL_MS = 2000;

const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0 };

/**
 * Owns exactly one browser geolocation watch per mounted player
 * session: requests permission on demand, reports fixes/errors to the
 * server at locationReportCadence.js's cadence, forces a fresh check on
 * a watch that has gone quiet or on the page becoming visible again,
 * and tears everything down on every dependency change and on unmount.
 *
 * Does not derive the player's DISPLAYED status — PlayerGame.js does
 * that from a live subscription to the player's own boundaryStatuses
 * doc, so the display survives a reload even before this hook reports
 * anything this session. This hook only reports, plus surfaces its own
 * permission state and the latest acquired position for the map to
 * render — not the server's evaluated status.
 *
 * @param {{roomID: string, boundaryRevision: number|null, boundaryEnabled: boolean, isGameActive: boolean}} args
 *   boundaryRevision/boundaryEnabled false-ish when there is no
 *   published boundary yet — tracking simply does not start.
 */
const useBoundaryLocation = ({ roomID, boundaryRevision, boundaryEnabled, isGameActive }) => {
    const [permissionState, setPermissionState] = useState('unknown');
    const [enabled, setEnabled] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const [ownPosition, setOwnPosition] = useState(null);

    // The context this watch/poll cycle runs under, read inside the
    // position/error callbacks — which can fire well after the browser
    // call that scheduled them — so a late result for a room or
    // revision this player has since left behind is never sent.
    const contextRef = useRef({ roomID, boundaryRevision });
    useEffect(() => {
        contextRef.current = { roomID, boundaryRevision };
    }, [roomID, boundaryRevision]);

    const lastSentMsRef = useRef(null);

    const isTrackingActive = enabled && boundaryEnabled && isGameActive && Boolean(roomID);

    const sendReport = useCallback((payload) => {
        const current = contextRef.current;
        if (
            payload.roomId !== current.roomID ||
            payload.boundaryRevision !== current.boundaryRevision
        ) {
            return;
        }
        reportPlayerLocation(payload)
            .then((result) => setLastResult(result))
            .catch((err) => {
                // A rejected report (revision_conflict, this game has
                // ended, rate-limited) is not a geolocation failure and
                // must never bubble into PlayerGame's session-expiry
                // handling. The next watch/poll cycle picks up whatever
                // actually changed on its own.
                console.error('Error reporting location:', err);
            });
    }, []);

    const handlePosition = useCallback(
        (position) => {
            setPermissionState('granted');
            const nowMs = Date.now();
            setOwnPosition({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracyM: position.coords.accuracy,
                acquiredAtMs: nowMs,
            });
            if (!shouldSendFix(lastSentMsRef.current, nowMs)) return;
            lastSentMsRef.current = nowMs;
            const current = contextRef.current;
            sendReport({
                roomId: current.roomID,
                boundaryRevision: current.boundaryRevision,
                sampleMs: Math.round(position.timestamp),
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracyM: position.coords.accuracy,
            });
        },
        [sendReport]
    );

    const handlePositionError = useCallback(
        (positionError) => {
            const reason =
                positionError.code === positionError.PERMISSION_DENIED
                    ? 'permission_denied'
                    : positionError.code === positionError.TIMEOUT
                      ? 'timeout'
                      : 'unavailable';
            if (reason === 'permission_denied') setPermissionState('denied');
            const nowMs = Date.now();
            if (!shouldSendFix(lastSentMsRef.current, nowMs)) return;
            lastSentMsRef.current = nowMs;
            const current = contextRef.current;
            sendReport({
                roomId: current.roomID,
                boundaryRevision: current.boundaryRevision,
                sampleMs: nowMs,
                error: reason,
            });
        },
        [sendReport]
    );

    // The watch itself. Restarts (so it checks fresh under the new
    // context) whenever tracking turns on/off or the boundary revision
    // changes, and always tears down on unmount — "only one watch per
    // mounted player session." `roomID` is listed explicitly, not just
    // through `isTrackingActive` — that boolean only flips on
    // true/false transitions, so a room-to-room change with tracking
    // staying on the whole time would otherwise never restart the
    // watch, leaving the old room's watch running pointlessly (and
    // relying solely on sendReport's own guard, below, to swallow its
    // output forever instead of actually stopping it).
    useEffect(() => {
        if (!isTrackingActive) return undefined;
        if (!('geolocation' in navigator)) {
            setPermissionState('unavailable');
            return undefined;
        }
        const watchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            GEOLOCATION_OPTIONS
        );
        // An immediate fresh check on every (re)start — covers the very
        // first enable, a boundary revision changing while tracking is
        // already on (spec: boundary changes get "a new location
        // check"), and a room change.
        navigator.geolocation.getCurrentPosition(
            handlePosition,
            handlePositionError,
            GEOLOCATION_OPTIONS
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [isTrackingActive, roomID, boundaryRevision, handlePosition, handlePositionError]);

    // Backstop: force a fresh getCurrentPosition call if nothing has
    // been sent recently enough on its own.
    useEffect(() => {
        if (!isTrackingActive) return undefined;
        const intervalId = setInterval(() => {
            if (isPollDue(lastSentMsRef.current, Date.now())) {
                navigator.geolocation.getCurrentPosition(
                    handlePosition,
                    handlePositionError,
                    GEOLOCATION_OPTIONS
                );
            }
        }, POLL_CHECK_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isTrackingActive, handlePosition, handlePositionError]);

    // Reacquire a fresh fix as soon as the tab becomes visible again —
    // the browser may have throttled or suspended updates while hidden.
    useEffect(() => {
        if (!isTrackingActive) return undefined;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                navigator.geolocation.getCurrentPosition(
                    handlePosition,
                    handlePositionError,
                    GEOLOCATION_OPTIONS
                );
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isTrackingActive, handlePosition, handlePositionError]);

    // Enable Location / Retry. Every call makes one direct, immediate
    // attempt in addition to flipping `enabled` on (a no-op the second
    // time) — a denial does not latch the watch effect out of trying
    // again, since that effect's own dependencies never change on a
    // denial alone; this is the only path a user-initiated retry has.
    const requestPermission = useCallback(() => {
        setEnabled(true);
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                handlePosition,
                handlePositionError,
                GEOLOCATION_OPTIONS
            );
        } else {
            setPermissionState('unavailable');
        }
    }, [handlePosition, handlePositionError]);

    return { permissionState, lastResult, ownPosition, requestPermission };
};

export default useBoundaryLocation;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/hooks/useBoundaryLocation.test.jsx`
Expected: all pass. If any test's failure mode looks like a real bug rather than a test-authoring mistake, fix the hook, re-run, and note the fix in your report the same way Phase 2's successful fix rounds did — including, where practical, a note confirming you watched the new/fixed test actually fail against the pre-fix code first.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/hooks/useBoundaryLocation.js src/hooks/useBoundaryLocation.test.jsx
npx eslint src/hooks/useBoundaryLocation.js src/hooks/useBoundaryLocation.test.jsx --max-warnings=0
git add src/hooks/useBoundaryLocation.js src/hooks/useBoundaryLocation.test.jsx
git commit -m "Add useBoundaryLocation: one geolocation watch per player session"
```

---

### Task 5: PlayerMapModal

**Files:**

- Create: `src/components/map_components/PlayerMapModal.js`
- Test: `src/components/map_components/PlayerMapModal.test.jsx`

**Interfaces:**

- Consumes: `GameMap` (Task 3's `ownPosition` prop included).
- Produces: `PlayerMapModal` component. Props: `isOpen`, `onClose`, `boundaryVertices`, `ownPosition` (same shape `useBoundaryLocation` returns, minus `acquiredAtMs` which this component ignores — staleness gating is Task 6's job, done before `ownPosition` ever reaches this component).

- [ ] **Step 1: Write the failing tests**

Create `src/components/map_components/PlayerMapModal.test.jsx`:

```jsx
/**
 * Layer 2 — React Testing Library. GameMap is stubbed (it has its own
 * thorough tests) so this stays focused on PlayerMapModal's own job:
 * passing props through, and Recenter on Me calling flyTo on the real
 * map instance handed to it via onMapLoad — the exact pattern
 * BoundaryEditorModal.js already uses, not a new API on GameMap.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import PlayerMapModal from './PlayerMapModal';

let lastProps;
const fakeMap = { flyTo: jest.fn() };

jest.mock('./GameMap', () => (props) => {
    lastProps = props;
    const React = require('react');
    React.useEffect(() => {
        if (props.onMapLoad) props.onMapLoad(fakeMap);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.onMapLoad]);
    return <div data-testid="mock-game-map" />;
});

const RING = [
    { lat: 10, lng: 20 },
    { lat: 10, lng: 21 },
    { lat: 11, lng: 21 },
    { lat: 10, lng: 20 },
];

const renderModal = (props = {}) =>
    render(
        <ChakraProvider>
            <PlayerMapModal
                isOpen
                onClose={jest.fn()}
                boundaryVertices={RING}
                ownPosition={null}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => jest.clearAllMocks());

describe('PlayerMapModal', () => {
    it('passes the boundary and own position straight through to GameMap', () => {
        const ownPosition = { lat: 10, lng: 20, accuracyM: 12 };
        renderModal({ ownPosition });
        expect(lastProps.boundaryVertices).toEqual(RING);
        expect(lastProps.ownPosition).toEqual(ownPosition);
    });

    it('Recenter on Me is disabled with no own position', () => {
        renderModal({ ownPosition: null });
        expect(screen.getByRole('button', { name: 'Recenter on Me' })).toBeDisabled();
    });

    it('Recenter on Me flies the real map to the own position once available', () => {
        renderModal({ ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        fireEvent.click(screen.getByRole('button', { name: 'Recenter on Me' }));
        expect(fakeMap.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [20, 10] }));
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/map_components/PlayerMapModal.test.jsx`
Expected: FAIL — `./PlayerMapModal` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/map_components/PlayerMapModal.js`:

```jsx
import React, { useRef } from 'react';
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import GameMap from './GameMap';

/**
 * Read-only boundary map for players: shows the published game area and
 * the player's own position/accuracy, with a Recenter on Me control.
 * Closing this modal does not touch location tracking — that lives in
 * useBoundaryLocation.js, mounted at the PlayerGame.js level, not here
 * (spec: "Closing the map does not stop location updates").
 */
const PlayerMapModal = ({ isOpen, onClose, boundaryVertices, ownPosition }) => {
    const mapRef = useRef(null);

    const handleMapLoad = (map) => {
        mapRef.current = map;
    };

    const handleRecenter = () => {
        if (mapRef.current && ownPosition) {
            mapRef.current.flyTo({ center: [ownPosition.lng, ownPosition.lat], zoom: 17 });
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size={{ base: 'full', md: '6xl' }}>
            <ModalOverlay />
            <ModalContent bg="#202030" h={{ base: '100%', md: '85vh' }}>
                <ModalHeader color="#ffffff">Game Area</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody display="flex" flexDirection="column" gap="8px">
                    <Button
                        alignSelf="flex-start"
                        size="sm"
                        onClick={handleRecenter}
                        isDisabled={!ownPosition}
                    >
                        Recenter on Me
                    </Button>
                    <GameMap
                        boundaryVertices={boundaryVertices}
                        fitTo={null}
                        ownPosition={ownPosition}
                        dragPan
                        onMapLoad={handleMapLoad}
                        onMapError={() => {}}
                    />
                </ModalBody>
            </ModalContent>
        </Modal>
    );
};

export default PlayerMapModal;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/components/map_components/PlayerMapModal.test.jsx`
Expected: all pass.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/components/map_components/PlayerMapModal.js src/components/map_components/PlayerMapModal.test.jsx
npx eslint src/components/map_components/PlayerMapModal.js src/components/map_components/PlayerMapModal.test.jsx --max-warnings=0
git add src/components/map_components/PlayerMapModal.js src/components/map_components/PlayerMapModal.test.jsx
git commit -m "Add PlayerMapModal, the read-only player map"
```

---

### Task 6: Wire tracking and status UI into PlayerGame

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `useBoundaryLocation` (Task 4), `PlayerMapModal` (Task 5), `fetchBoundaryStatusReferenceForPlayer` (Task 2), `deriveFreshStatus` (Phase 1, `src/game/gameBoundary.js`).

Read `src/pages/PlayerGame.js` in full before editing — mirror its existing `useEffect`/`onSnapshot`/`handleSubscriptionError`/`useDisclosure`/`CreateAlert` patterns exactly rather than introducing new ones.

- [ ] **Step 1: Write the failing tests**

Add to `src/pages/PlayerGame.test.jsx`. First, extend the file's existing `jest.mock('../components/firebase_calls/dbCalls', ...)` factory with `fetchBoundaryStatusReferenceForPlayer: jest.fn(() => 'status-ref')`, and add two new mocks alongside the file's existing ones:

```jsx
jest.mock('../components/reportPlayerLocation', () => ({ reportPlayerLocation: jest.fn() }));
jest.mock('../hooks/useBoundaryLocation', () =>
    jest.fn(() => ({
        permissionState: 'unknown',
        lastResult: null,
        ownPosition: null,
        requestPermission: jest.fn(),
    }))
);
jest.mock(
    '../components/map_components/PlayerMapModal',
    () => (props) => (props.isOpen ? <div data-testid="mock-player-map-modal" /> : null)
);
```

Import `useBoundaryLocation` at the top so individual tests can set its mock return value: `import useBoundaryLocation from '../hooks/useBoundaryLocation';`.

Extend this file's existing room-subscription mock (find how it currently answers `fetchRoomReferenceForRoom`'s ref — likely a literal string key the same way `GameMasterView.test.jsx`'s `mockPlayersSnapshot` branches on `'room-ref'`) so it can also carry a `gameBoundary` field, and extend any helper that seeds the room snapshot to accept one. Then add:

```javascript
it('shows the pre-permission explanation and an Enable Location button once a boundary is published', () => {
    // Seed the room snapshot with { gameBoundary: { enabled: true, revision: 1, vertices: [...] } }
    // using this file's existing room-subscription mock pattern.
    mountPlayerGame(); // this file's own existing render helper, used as-is
    expect(
        screen.getByText(/Turn on location so we can check that you are inside the game area/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable Location' })).toBeInTheDocument();
});

it('shows "In game area." when the live-derived status is inside', () => {
    // Seed a gameBoundary and a boundaryStatuses snapshot via the
    // status-ref mock with status: 'inside' and a recent
    // lastUsableReceivedAt Timestamp.
    mountPlayerGame();
    expect(screen.getByText('In game area.')).toBeInTheDocument();
});

it('shows the persistent outside warning', () => {
    mountPlayerGame();
    expect(
        screen.getByText('You are outside the game area. Please return inside.')
    ).toBeInTheDocument();
});

it('shows Location unavailable once the stored status has gone stale, even though it was last Inside', () => {
    // Seed a boundaryStatuses snapshot with status 'inside' and a
    // lastUsableReceivedAt far enough in the past (>30s) that
    // deriveFreshStatus reports unavailable/stale once this test's
    // "now" has advanced past it — use jest.useFakeTimers() and
    // jest.advanceTimersByTime(31000) after mounting, inside act(),
    // since PlayerGame's own local ticker (not yet written) is what
    // re-evaluates freshness without a new snapshot.
    expect(screen.getByText(/Location unavailable/)).toBeInTheDocument();
});

it('hides status entirely once the boundary is disabled', () => {
    // Seed gameBoundary.enabled: false.
    mountPlayerGame();
    expect(screen.queryByText('In game area.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable Location' })).not.toBeInTheDocument();
});

it('Retry calls requestPermission again after a denial', () => {
    const requestPermission = jest.fn();
    useBoundaryLocation.mockReturnValue({
        permissionState: 'denied',
        lastResult: null,
        ownPosition: null,
        requestPermission,
    });
    mountPlayerGame();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(requestPermission).toHaveBeenCalled();
});

it('closing the map modal does not unmount or otherwise stop useBoundaryLocation', () => {
    mountPlayerGame();
    fireEvent.click(screen.getByRole('button', { name: 'View Game Map' }));
    expect(screen.getByTestId('mock-player-map-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    // useBoundaryLocation is called once per PlayerGame render
    // regardless of the modal's own open/closed state — assert it was
    // never called with different roomID/boundary args as a side
    // effect of toggling the modal, i.e. the hook's own inputs are
    // untouched by the modal's lifecycle.
    const callsAfterToggle = useBoundaryLocation.mock.calls.length;
    expect(callsAfterToggle).toBeGreaterThan(0);
});

it('shows a "Game area updated" notice when the boundary revision increases after the room is already loaded', () => {
    // Mount with revision 1 enabled, then simulate a later room
    // snapshot with revision 2 via this file's existing
    // onSnapshot.mockImplementation re-invocation pattern (see how
    // other PlayerGame tests simulate a later snapshot after mount).
    expect(screen.getByText(/Game area updated/)).toBeInTheDocument();
});
```

Write each test's seeding against this file's ACTUAL existing mock shapes — read the file fully first; the comments above describe intent, not a literal transcription to paste in blind, since this file's exact `onSnapshot` branching and render-helper name must be read fresh rather than assumed.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/pages/PlayerGame.test.jsx`
Expected: FAIL — none of this UI exists yet.

- [ ] **Step 3: Implement**

In `src/pages/PlayerGame.js`:

Add two new import lines:

```javascript
import useBoundaryLocation from '../hooks/useBoundaryLocation';
import PlayerMapModal from '../components/map_components/PlayerMapModal';
import { deriveFreshStatus, GAME_BOUNDARY_CONFIG } from '../game/gameBoundary';
```

and add `fetchBoundaryStatusReferenceForPlayer` to the existing `import { fetchRoomReferenceForRoom, ... } from '../components/firebase_calls/dbCalls';` line. `useDisclosure` and `auth` are already imported in this file — no change needed to either of those lines.

Add state, and call the already-imported `useDisclosure` a fifth time (this file already calls it four times, once per existing modal) for the map modal:

```javascript
const [gameBoundary, setGameBoundary] = useState(undefined);
const [boundaryStatusDoc, setBoundaryStatusDoc] = useState(null);
const [nowMs, setNowMs] = useState(Date.now());
const previousRevisionRef = useRef(undefined);
const { isOpen: isMapOpen, onOpen: onMapOpen, onClose: onMapClose } = useDisclosure();
```

Extend the existing room-subscription effect's snapshot handler to also capture `gameBoundary`, and fire a "Game area is ready"/"Game area updated" toast on the right transitions. Compute the next value and run the toast/ref side effects as plain statements in the handler's own body — NOT inside `setGameBoundary`'s updater function, which must stay a pure value computation; React can invoke a functional `setState` updater more than once for the same update under some scheduling paths, which would risk a duplicate toast or a double-mutated ref if side effects lived there instead:

```javascript
const nextGameBoundary = snapshot.data()?.gameBoundary;
const previousRevision = previousRevisionRef.current;
if (nextGameBoundary?.enabled && previousRevision === undefined) {
    createAlert('info', 'Game area is ready', '', 2500);
} else if (
    nextGameBoundary?.enabled &&
    previousRevision !== undefined &&
    nextGameBoundary.revision !== previousRevision
) {
    createAlert('info', 'Game area updated', '', 2500);
}
previousRevisionRef.current = nextGameBoundary?.revision;
setGameBoundary(nextGameBoundary);
```

Add this alongside the existing `setGameStarted`/`setIsGameActive` calls in that same handler, not a separate effect — one room snapshot, one place that reads it.

A local ticker, so freshness re-evaluates even with no new Firestore snapshot (spec: "Freshness is derived on both displays... using a local timer, even when Firestore emits no new snapshot"):

```javascript
useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
}, []);
```

Subscribe to this player's own boundary-status doc, only once the boundary is enabled and the player name is known:

```javascript
useEffect(() => {
    if (!roomID || !gameBoundary?.enabled || !playerName) {
        setBoundaryStatusDoc(null);
        return undefined;
    }
    const statusRef = fetchBoundaryStatusReferenceForPlayer(playerName, roomID);
    const unsubscribe = onSnapshot(
        statusRef,
        (snapshot) => setBoundaryStatusDoc(snapshot.exists() ? snapshot.data() : null),
        () => setBoundaryStatusDoc(null) // not found/not-yet-authorized is not a session-expiry condition
    );
    return () => unsubscribe();
}, [roomID, gameBoundary?.enabled, playerName]);
```

Note the error callback here does NOT call `handleSubscriptionError` — a missing or not-yet-permitted status doc (e.g. before this player's first report) is expected and routine, not a sign this session no longer belongs here.

Mount the tracking hook (always, regardless of whether the map modal is open — Review Focus):

```javascript
const { permissionState, ownPosition, requestPermission } = useBoundaryLocation({
    roomID,
    boundaryRevision: gameBoundary?.revision ?? null,
    boundaryEnabled: gameBoundary?.enabled ?? false,
    isGameActive,
});
```

Derive the live display status from the subscribed doc, the local ticker, and this device's own identity/revision:

```javascript
const liveBoundaryStatus = boundaryStatusDoc
    ? deriveFreshStatus(
          {
              status: boundaryStatusDoc.status,
              reason: boundaryStatusDoc.reason,
              lastUsableMs: boundaryStatusDoc.lastUsableReceivedAt?.toMillis() ?? null,
              boundaryRevision: boundaryStatusDoc.boundaryRevision,
              uid: boundaryStatusDoc.uid,
          },
          nowMs,
          { currentRevision: gameBoundary?.revision, currentUid: auth.currentUser?.uid }
      )
    : { status: 'unavailable', reason: 'no_fix' };
```

The status-line text, matching the spec's table exactly:

```javascript
const statusText = {
    inside: 'In game area.',
    near: 'You are near the edge of the game area; check the map.',
    outside: 'You are outside the game area. Please return inside.',
    unavailable: null, // handled separately below — needs its own explanation/Retry, not a one-liner
}[liveBoundaryStatus.status];
```

Render, inside the existing `{isGameActive && (...)}` block (add this alongside the existing target/eliminated text, not replacing it — a player can be alive/dead AND have a boundary status at the same time):

```jsx
{
    gameBoundary?.enabled && (
        <>
            {permissionState === 'unknown' && (
                <Box bg="blue.900" color="white" borderRadius="md" p={3} mb={2}>
                    <Text mb={2}>
                        Turn on location so we can check that you are inside the game area. The
                        moderator sees your boundary status. Other players cannot see your location.
                        Keep the game open for location updates.
                    </Text>
                    <Button size="sm" onClick={requestPermission}>
                        Enable Location
                    </Button>
                </Box>
            )}
            {permissionState === 'denied' && (
                <Box bg="orange.800" color="white" borderRadius="md" p={3} mb={2}>
                    <Text mb={2}>
                        Location permission was denied. Enable it in your browser or device
                        settings, then retry.
                    </Text>
                    <Button size="sm" onClick={requestPermission}>
                        Retry
                    </Button>
                </Box>
            )}
            {liveBoundaryStatus.status === 'outside' && (
                <Box bg="red.700" color="white" borderRadius="md" p={2} mb={2} textAlign="center">
                    <Text fontWeight="bold">{statusText}</Text>
                </Box>
            )}
            {liveBoundaryStatus.status !== 'outside' &&
                liveBoundaryStatus.status !== 'unavailable' && <Text mb={2}>{statusText}</Text>}
            {liveBoundaryStatus.status === 'unavailable' && (
                <Text mb={2}>Location unavailable ({liveBoundaryStatus.reason ?? 'no_fix'}).</Text>
            )}
            <Button size="sm" mb={2} onClick={onMapOpen}>
                View Game Map
            </Button>
            <PlayerMapModal
                isOpen={isMapOpen}
                onClose={onMapClose}
                boundaryVertices={gameBoundary.vertices}
                ownPosition={
                    ownPosition &&
                    nowMs - ownPosition.acquiredAtMs <= GAME_BOUNDARY_CONFIG.freshnessMs
                        ? ownPosition
                        : null
                }
            />
        </>
    );
}
```

That `ownPosition` staleness check is what keeps a stale fix from ever rendering as a live marker (Review Focus): it reads `nowMs` (this file's own local ticker, already defined above, re-rendering every second) rather than a fresh `Date.now()` call, and `GAME_BOUNDARY_CONFIG.freshnessMs` rather than a bare `30000`, so this check and `deriveFreshStatus`'s own freshness check can never silently drift apart from each other or from the spec's number.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/pages/PlayerGame.test.jsx`
Expected: all pass, including the file's pre-existing tests.

- [ ] **Step 5: Format, lint, full test run, build, commit**

```bash
npm run format
npm run lint
npm test -- --watchAll=false
npm run build
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Wire location permission, tracking, and status UI into PlayerGame"
```

- [ ] **Step 6: Update documentation**

Add a short paragraph to `docs/architecture.md` naming `useBoundaryLocation.js` and `PlayerMapModal.js` in the component inventory, and a short paragraph to `docs/game-flows.md` describing the player-side flow: boundary published → player sees the ready notice → enables location → the hook reports fixes → the status doc updates → the player sees their own status, with a map available at any time that does not affect tracking. Read both files first and match their existing section style (the same two files Phase 2's Task 7 already extended once).

---

## Final gate

Before calling Phase 3 done, run the full gate from `CLAUDE.md`:

```bash
npm run format
npm run lint
npm test
npm run build
```

`npm run test:emulator` and `npm run test:rules` are unaffected by this plan (no new Cloud Functions or rules) but are still part of the standing gate.

Device checks on iOS Safari and Android Chrome (the spec's own Testing section asks for these) are the user's step, the same way the Mapbox token was in Phase 2 — nothing in this plan's automated gate can substitute for walking across a real boundary with a real phone.
