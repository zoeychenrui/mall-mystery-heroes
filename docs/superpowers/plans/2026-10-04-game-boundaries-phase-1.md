# Game Boundaries — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side and pure-logic foundation of the game boundary feature: geometry validation, boundary publish/disable, server-decided player location status with outside-confirmation, moderator-only status and event records, lifecycle cleanup, and security rules. No UI in this phase.

**Architecture:** Pure geometry and state-machine logic in `src/game/gameBoundary.js`, shared with Cloud Functions through the existing vendoring script. Two new callables: a host-only publish/disable pair, and a player-only location report that resolves identity from `context.auth.uid`, evaluates the submitted fix against the current boundary on the server, and writes status plus any transition event in one transaction. Security rules keep statuses and events private and stop ordinary room writes from altering the boundary.

**Tech Stack:** Node 20 Cloud Functions (1st gen `functions.https.onCall`, matching the existing callables), Firestore Admin SDK transactions, Jest (node project for pure logic, emulator integration for callables, rules project for `firestore.rules`).

**Spec:** `docs/superpowers/specs/2026-09-30-game-boundaries-design.md` (Approved; map provider: Mapbox)
**Status:** Approved

**Phase scope:** This is Phase 1 of 4. Map rendering, the drawing editor, player tracking hook, and moderator status UI are separate later plans. Map provider selection is a prerequisite for those plans, not for this one.

## Global Constraints

- **Server decides status.** `reportPlayerLocation` never accepts a client-supplied inside/outside result. It accepts coordinates, accuracy, and a device sample time, or a location-error code with no coordinates.
- **Player identity comes only from `context.auth.uid`.** Resolve exactly one player doc by `uid`. More than one match is rejected, following `submitKillPhoto.js`'s existing guard.
- **No latitude/longitude or movement history is ever persisted or logged.** Only the derived status fields listed in the spec. Do not put coordinates in `functions.logger` calls or error messages.
- **Thresholds are shared constants**, defined once in `src/game/gameBoundary.js` and exported: edge tolerance 15 m (expanded to reported accuracy when larger), max usable accuracy 50 m, outside confirmation needs at least 2 usable outside readings spanning at least 20 s with no gap over 30 s between accepted readings, freshness window 30 s, sample timestamp allowance 30 s old / 5 s future, reports rate-limited to 20 per minute per player.
- **Shape limits:** at most 500 vertices including the closing vertex, span no larger than 10 km (bounding-box diagonal), no antimeridian crossing (longitude range under 180°), finite coordinates in valid ranges, nonzero area, no self-intersections.
- **Revision discipline:** every publish or disable increments `gameBoundary.revision`. Publish and disable require the caller's `expectedRevision` to match, else `failed-precondition` with message `revision_conflict`.
- **Rules:** client code can never write `boundaryStatuses` or `boundaryEvents`. Host clients can never change `gameBoundary` directly; only the Admin SDK callables change it.
- **Gate:** `npm run format`, `npm run lint`, `npm test`, `npm run build`, plus `npm run test:emulator` and `npm run test:rules` (this phase touches Cloud Functions and rules).
- **Tooling note:** when invoking emulator tests manually outside the npm scripts, pass `--project demo-mall-mystery-heroes`, or every callable fails with a generic "not-found".

## Task dependency order

1 (geometry) → 2 (classification and state) → 3 (vendoring) → 4 (publish/disable) and 5 (report) → 6 (lifecycle) and 7 (rules) → 8 (registration, docs, gate). Tasks 6 and 7 are independent of each other.

---

### Task 1: Shape validation and polygon conversion (pure geometry)

**Files:**
- Create: `src/game/gameBoundary.js`
- Test: `src/game/gameBoundary.test.js`

**Interfaces:**
- Produces:
  - `MAX_VERTICES = 500`, `MAX_SPAN_METERS = 10000`, `EARTH_RADIUS_M = 6371008.8`
  - `shapeToPolygon(shapeType, shapeParameters)` → `Array<{lat, lng}>` closed ring (first point repeated last), or throws `Error` for an unknown type or malformed parameters
  - `validateBoundaryShape(shapeType, vertices)` → `{ ok: true } | { ok: false, reason: string }`
  - `projectToMeters(point, origin)` → `{x, y}` local equirectangular meters around `origin`
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Create `src/game/gameBoundary.test.js`:

```js
const {
    MAX_VERTICES,
    shapeToPolygon,
    validateBoundaryShape,
} = require('./gameBoundary');

const square = [
    { lat: 40.0, lng: -74.0 },
    { lat: 40.0, lng: -73.999 },
    { lat: 40.001, lng: -73.999 },
    { lat: 40.001, lng: -74.0 },
    { lat: 40.0, lng: -74.0 },
];

describe('shapeToPolygon', () => {
    it('turns a rectangle from opposite corners into a closed ring', () => {
        const ring = shapeToPolygon('rectangle', {
            corners: [
                { lat: 40.0, lng: -74.0 },
                { lat: 40.001, lng: -73.999 },
            ],
        });
        expect(ring).toHaveLength(5);
        expect(ring[0]).toEqual(ring[4]);
    });

    it('samples a circle into 64 vertices plus closure', () => {
        const ring = shapeToPolygon('circle', {
            center: { lat: 40.0, lng: -74.0 },
            radiusMeters: 100,
        });
        expect(ring).toHaveLength(65);
        expect(ring[0]).toEqual(ring[64]);
    });

    it('samples an oval with separate east-west and north-south radii', () => {
        const ring = shapeToPolygon('oval', {
            center: { lat: 40.0, lng: -74.0 },
            radiusXMeters: 200,
            radiusYMeters: 50,
        });
        expect(ring).toHaveLength(65);
    });

    it('rejects an unknown shape type', () => {
        expect(() => shapeToPolygon('triangle', {})).toThrow(/unknown shape type/i);
    });
});

describe('validateBoundaryShape', () => {
    it('accepts a valid closed square', () => {
        expect(validateBoundaryShape('freehand', square)).toEqual({ ok: true });
    });

    it('rejects a ring that is not closed', () => {
        const open = square.slice(0, 4);
        expect(validateBoundaryShape('freehand', open).ok).toBe(false);
    });

    it('rejects non-finite coordinates', () => {
        const bad = [...square];
        bad[1] = { lat: NaN, lng: -73.999 };
        expect(validateBoundaryShape('freehand', bad).reason).toMatch(/finite/i);
    });

    it('rejects out-of-range latitude and longitude', () => {
        const bad = [...square];
        bad[1] = { lat: 91, lng: -73.999 };
        expect(validateBoundaryShape('freehand', bad).reason).toMatch(/range/i);
    });

    it('rejects a zero-area shape', () => {
        const line = [
            { lat: 40.0, lng: -74.0 },
            { lat: 40.001, lng: -74.0 },
            { lat: 40.0, lng: -74.0 },
        ];
        expect(validateBoundaryShape('freehand', line).reason).toMatch(/area/i);
    });

    it('rejects a self-intersecting bow-tie', () => {
        const bowTie = [
            { lat: 40.0, lng: -74.0 },
            { lat: 40.001, lng: -73.999 },
            { lat: 40.0, lng: -73.999 },
            { lat: 40.001, lng: -74.0 },
            { lat: 40.0, lng: -74.0 },
        ];
        expect(validateBoundaryShape('freehand', bowTie).reason).toMatch(/intersect/i);
    });

    it('rejects more than the maximum vertex count', () => {
        const many = [];
        for (let i = 0; i < MAX_VERTICES; i += 1) {
            many.push({ lat: 40 + i * 0.000001, lng: -74 + (i % 2) * 0.0001 });
        }
        many.push(many[0]);
        expect(validateBoundaryShape('freehand', many).reason).toMatch(/vertices/i);
    });

    it('rejects a shape spanning more than 10 km', () => {
        const wide = [
            { lat: 40.0, lng: -74.0 },
            { lat: 40.0, lng: -73.0 },
            { lat: 40.1, lng: -73.0 },
            { lat: 40.1, lng: -74.0 },
            { lat: 40.0, lng: -74.0 },
        ];
        expect(validateBoundaryShape('freehand', wide).reason).toMatch(/span/i);
    });

    it('rejects a shape crossing the antimeridian', () => {
        const crossing = [
            { lat: 0, lng: 179.9 },
            { lat: 0.001, lng: -179.9 },
            { lat: 0.001, lng: 179.95 },
            { lat: 0, lng: 179.9 },
        ];
        expect(validateBoundaryShape('freehand', crossing).ok).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/game/gameBoundary.test.js -v`
Expected: FAIL with `Cannot find module './gameBoundary'`.

- [ ] **Step 3: Implement the geometry module**

Create `src/game/gameBoundary.js`:

```js
/**
 * Game boundary geometry: canonical polygon conversion and shape
 * validation. Pure — no Firebase, no React, no clock. CommonJS, matching
 * killPhotoUrl.js and rateLimit.js, so Cloud Functions can load the same
 * file through functions/vendor/game/.
 *
 * Distances use a local equirectangular projection around a chosen origin.
 * It is accurate to well under a meter across the 10 km areas this feature
 * allows, and far simpler to reason about than full geodesic math.
 */
const EARTH_RADIUS_M = 6371008.8;
const MAX_VERTICES = 500;
const MAX_SPAN_METERS = 10000;
const CIRCLE_SAMPLES = 64;
const MIN_AREA_M2 = 1;

const toRadians = (deg) => (deg * Math.PI) / 180;
const toDegrees = (rad) => (rad * 180) / Math.PI;

// Equirectangular projection around `origin`, in meters.
const projectToMeters = (point, origin) => ({
    x: toRadians(point.lng - origin.lng) * Math.cos(toRadians(origin.lat)) * EARTH_RADIUS_M,
    y: toRadians(point.lat - origin.lat) * EARTH_RADIUS_M,
});

const offsetPoint = (center, eastMeters, northMeters) => ({
    lat: center.lat + toDegrees(northMeters / EARTH_RADIUS_M),
    lng:
        center.lng +
        toDegrees(eastMeters / (EARTH_RADIUS_M * Math.cos(toRadians(center.lat)))),
});

const sampleEllipse = (center, radiusXMeters, radiusYMeters) => {
    const ring = [];
    for (let i = 0; i < CIRCLE_SAMPLES; i += 1) {
        const theta = (2 * Math.PI * i) / CIRCLE_SAMPLES;
        ring.push(
            offsetPoint(
                center,
                radiusXMeters * Math.cos(theta),
                radiusYMeters * Math.sin(theta)
            )
        );
    }
    ring.push({ ...ring[0] });
    return ring;
};

const closeRing = (points) => {
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last && first.lat === last.lat && first.lng === last.lng) {
        return points;
    }
    return [...points, { ...first }];
};

const shapeToPolygon = (shapeType, shapeParameters) => {
    if (shapeType === 'rectangle') {
        const [a, b] = shapeParameters.corners;
        const minLat = Math.min(a.lat, b.lat);
        const maxLat = Math.max(a.lat, b.lat);
        const minLng = Math.min(a.lng, b.lng);
        const maxLng = Math.max(a.lng, b.lng);
        return closeRing([
            { lat: minLat, lng: minLng },
            { lat: minLat, lng: maxLng },
            { lat: maxLat, lng: maxLng },
            { lat: maxLat, lng: minLng },
        ]);
    }
    if (shapeType === 'circle') {
        const { center, radiusMeters } = shapeParameters;
        return sampleEllipse(center, radiusMeters, radiusMeters);
    }
    if (shapeType === 'oval') {
        const { center, radiusXMeters, radiusYMeters } = shapeParameters;
        return sampleEllipse(center, radiusXMeters, radiusYMeters);
    }
    if (shapeType === 'freehand') {
        throw new Error('freehand shapes are supplied as vertices, not converted');
    }
    throw new Error(`unknown shape type: ${shapeType}`);
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const segmentsIntersect = (p1, p2, p3, p4) => {
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    return d1 * d2 < 0 && d3 * d4 < 0;
};

/**
 * @param {string} shapeType
 * @param {Array<{lat: number, lng: number}>} vertices closed ring
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
const validateBoundaryShape = (shapeType, vertices) => {
    if (!Array.isArray(vertices) || vertices.length < 4) {
        return { ok: false, reason: 'A boundary needs at least three distinct corners.' };
    }
    if (vertices.length > MAX_VERTICES) {
        return { ok: false, reason: `A boundary may have at most ${MAX_VERTICES} vertices.` };
    }
    for (const point of vertices) {
        if (!point || !isFiniteNumber(point.lat) || !isFiniteNumber(point.lng)) {
            return { ok: false, reason: 'Coordinates must be finite numbers.' };
        }
        if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) {
            return { ok: false, reason: 'Coordinates are outside the valid latitude/longitude range.' };
        }
    }
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
        return { ok: false, reason: 'The boundary must be a closed ring.' };
    }

    const lats = vertices.map((p) => p.lat);
    const lngs = vertices.map((p) => p.lng);
    if (Math.max(...lngs) - Math.min(...lngs) >= 180) {
        return { ok: false, reason: 'A boundary may not cross the antimeridian.' };
    }
    const diagonal = projectToMeters(
        { lat: Math.max(...lats), lng: Math.max(...lngs) },
        { lat: Math.min(...lats), lng: Math.min(...lngs) }
    );
    if (Math.hypot(diagonal.x, diagonal.y) > MAX_SPAN_METERS) {
        return { ok: false, reason: 'A boundary may span at most 10 km.' };
    }

    const origin = { lat: Math.min(...lats), lng: Math.min(...lngs) };
    const projected = vertices.map((p) => projectToMeters(p, origin));

    let twiceArea = 0;
    for (let i = 0; i < projected.length - 1; i += 1) {
        const a = projected[i];
        const b = projected[i + 1];
        twiceArea += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(twiceArea) / 2 < MIN_AREA_M2) {
        return { ok: false, reason: 'The boundary must enclose a nonzero area.' };
    }

    const edgeCount = projected.length - 1;
    for (let i = 0; i < edgeCount; i += 1) {
        for (let j = i + 2; j < edgeCount; j += 1) {
            if (i === 0 && j === edgeCount - 1) continue;
            if (
                segmentsIntersect(
                    projected[i],
                    projected[i + 1],
                    projected[j],
                    projected[j + 1]
                )
            ) {
                return { ok: false, reason: 'The boundary must not cross itself.' };
            }
        }
    }

    if (!['freehand', 'rectangle', 'circle', 'oval'].includes(shapeType)) {
        return { ok: false, reason: `Unknown shape type: ${shapeType}` };
    }
    return { ok: true };
};

module.exports = {
    EARTH_RADIUS_M,
    MAX_VERTICES,
    MAX_SPAN_METERS,
    shapeToPolygon,
    validateBoundaryShape,
    projectToMeters,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/game/gameBoundary.test.js -v`
Expected: PASS, all tests in the file.

Note for implementers: the `rectangle`/`circle`/`oval` tests above use the shape parameter names from the spec (`corners`, `center`, `radiusMeters`, `radiusXMeters`, `radiusYMeters`). Keep them exactly.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameBoundary.js src/game/gameBoundary.test.js
git commit -m "Add pure game-boundary geometry validation and shape conversion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Location classification and outside-confirmation state (pure)

**Files:**
- Modify: `src/game/gameBoundary.js`
- Test: `src/game/gameBoundary.test.js`

**Interfaces:**
- Produces:
  - `GAME_BOUNDARY_CONFIG = { edgeToleranceM: 15, maxAccuracyM: 50, confirmMinSpanMs: 20000, confirmMaxGapMs: 30000, freshnessMs: 30000, sampleMaxAgeMs: 30000, sampleMaxFutureMs: 5000, reportRateLimit: { max: 20, windowMs: 60000 } }`
  - `isPointInPolygon(point, ring)` → boolean (ray casting in projected meters)
  - `distanceToRingMeters(point, ring)` → number, distance to the nearest edge in meters
  - `classifyFix(ring, fix)` → `{ kind: 'inside' | 'near' | 'outside' | 'unusable', reason }`, where `fix = { lat, lng, accuracyM }`. `unusable` covers accuracy above `maxAccuracyM` (reason `poor_accuracy`) and missing or non-finite values (reason `invalid_fix`).
  - `initialBoundaryState()` → `{ status: 'unavailable', reason: 'no_fix', outsideSinceMs: null, lastOutsideSampleMs: null, outsideSampleCount: 0, lastUsableMs: null, lastSampleMs: null, outsideConfirmedAt: null }`
  - `nextBoundaryState(prevState, classification, { sampleMs, receivedMs })` → new state, pure, time from arguments only
  - `deriveFreshStatus(state, nowMs)` → the state's status, or `unavailable` with reason `stale` when `nowMs - lastUsableMs > freshnessMs`
- Consumes: `projectToMeters` from Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/gameBoundary.test.js`:

```js
const {
    GAME_BOUNDARY_CONFIG,
    classifyFix,
    initialBoundaryState,
    nextBoundaryState,
    deriveFreshStatus,
} = require('./gameBoundary');

// A 100 m x 100 m square, roughly 0 lat/lng-degree aligned, around 40N.
const plot = shapeToPolygon('rectangle', {
    corners: [
        { lat: 40.0, lng: -74.0 },
        { lat: 40.0009, lng: -73.9991 },
    ],
});
const center = { lat: 40.00045, lng: -73.99955 };
const fix = (overrides) => ({ lat: center.lat, lng: center.lng, accuracyM: 5, ...overrides });
// One degree of latitude is about 111,195 m, so 0.0009 deg ≈ 100 m.
const metersNorthOfPlot = (m) => ({ lat: 40.0009 + m / 111195, lng: -73.99955 });

describe('classifyFix', () => {
    it('classifies a point well inside as inside', () => {
        expect(classifyFix(plot, fix()).kind).toBe('inside');
    });

    it('classifies a point within tolerance just inside the edge as near', () => {
        const p = { lat: 40.0009 - 5 / 111195, lng: -73.99955 };
        expect(classifyFix(plot, fix(p)).kind).toBe('near');
    });

    it('classifies a point well beyond tolerance outside as outside', () => {
        expect(classifyFix(plot, fix(metersNorthOfPlot(60))).kind).toBe('outside');
    });

    it('treats a point just outside the edge within tolerance as near, not outside', () => {
        expect(classifyFix(plot, fix(metersNorthOfPlot(5))).kind).toBe('near');
    });

    it('expands tolerance to the reported accuracy when that is larger', () => {
        // 30 m outside with 40 m accuracy: inside the expanded tolerance, so near.
        expect(classifyFix(plot, fix({ ...metersNorthOfPlot(30), accuracyM: 40 })).kind).toBe(
            'near'
        );
    });

    it('marks readings worse than the maximum accuracy as unusable', () => {
        const result = classifyFix(plot, fix({ accuracyM: 80 }));
        expect(result).toEqual({ kind: 'unusable', reason: 'poor_accuracy' });
    });

    it('marks non-finite fixes as unusable', () => {
        expect(classifyFix(plot, fix({ lat: NaN })).kind).toBe('unusable');
    });
});

const outsideFix = (tMs) => ({ kind: 'outside', reason: null, tMs });

describe('nextBoundaryState', () => {
    const at = (ms) => ({ sampleMs: ms, receivedMs: ms });

    it('does not flag outside on a single outside reading', () => {
        const s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        expect(s.status).not.toBe('outside');
        expect(s.status).toBe('near');
    });

    it('confirms outside after two outside readings spanning at least 20 seconds', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'outside' }, at(20000));
        expect(s.status).toBe('outside');
        expect(s.outsideConfirmedAt).toBe(20000);
    });

    it('does not confirm if the second outside reading comes too soon', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'outside' }, at(10000));
        expect(s.status).not.toBe('outside');
    });

    it('restarts the confirmation period after a gap over 30 seconds', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'outside' }, at(40000));
        expect(s.status).not.toBe('outside');
    });

    it('resets pending confirmation on an inside reading', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'inside' }, at(5000));
        expect(s.outsideSampleCount).toBe(0);
        expect(s.outsideSinceMs).toBeNull();
    });

    it('keeps a confirmed outside flag through near readings until clearly inside', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'outside' }, at(20000));
        s = nextBoundaryState(s, { kind: 'near' }, at(25000));
        expect(s.status).toBe('outside');
        s = nextBoundaryState(s, { kind: 'inside' }, at(30000));
        expect(s.status).toBe('inside');
        expect(s.outsideConfirmedAt).toBeNull();
    });

    it('ignores unusable readings for outside confirmation', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'unusable' }, at(10000));
        expect(s.outsideSampleCount).toBe(0);
    });
});

describe('deriveFreshStatus', () => {
    it('reports unavailable once the last usable reading is older than the freshness window', () => {
        const s = { ...initialBoundaryState(), status: 'inside', lastUsableMs: 0 };
        const derived = deriveFreshStatus(s, GAME_BOUNDARY_CONFIG.freshnessMs + 1);
        expect(derived).toEqual({ status: 'unavailable', reason: 'stale' });
    });

    it('keeps the stored status while the last usable reading is fresh', () => {
        const s = { ...initialBoundaryState(), status: 'inside', lastUsableMs: 0 };
        expect(deriveFreshStatus(s, 1000)).toEqual({ status: 'inside', reason: null });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/game/gameBoundary.test.js -v`
Expected: FAIL — the new names are not exported yet.

- [ ] **Step 3: Implement classification and state**

Add to `src/game/gameBoundary.js` before `module.exports`, and extend the exports:

```js
const GAME_BOUNDARY_CONFIG = {
    edgeToleranceM: 15,
    maxAccuracyM: 50,
    confirmMinSpanMs: 20000,
    confirmMaxGapMs: 30000,
    freshnessMs: 30000,
    sampleMaxAgeMs: 30000,
    sampleMaxFutureMs: 5000,
    reportRateLimit: { max: 20, windowMs: 60000 },
};

const ringOrigin = (ring) => ({
    lat: ring.reduce((sum, p) => sum + p.lat, 0) / ring.length,
    lng: ring.reduce((sum, p) => sum + p.lng, 0) / ring.length,
});

// Ray casting in projected meters.
const isPointInPolygon = (point, ring) => {
    const origin = ringOrigin(ring);
    const p = projectToMeters(point, origin);
    const pts = ring.map((v) => projectToMeters(v, origin));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
        const a = pts[i];
        const b = pts[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
};

const pointSegmentDistance = (p, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const distanceToRingMeters = (point, ring) => {
    const origin = ringOrigin(ring);
    const p = projectToMeters(point, origin);
    const pts = ring.map((v) => projectToMeters(v, origin));
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) {
        best = Math.min(best, pointSegmentDistance(p, pts[i], pts[i + 1]));
    }
    return best;
};

const classifyFix = (ring, fix) => {
    if (!fix || !isFiniteNumber(fix.lat) || !isFiniteNumber(fix.lng) || !isFiniteNumber(fix.accuracyM)) {
        return { kind: 'unusable', reason: 'invalid_fix' };
    }
    if (fix.accuracyM > GAME_BOUNDARY_CONFIG.maxAccuracyM) {
        return { kind: 'unusable', reason: 'poor_accuracy' };
    }
    const tolerance = Math.max(GAME_BOUNDARY_CONFIG.edgeToleranceM, fix.accuracyM);
    const point = { lat: fix.lat, lng: fix.lng };
    const distance = distanceToRingMeters(point, ring);
    const inside = isPointInPolygon(point, ring);
    if (distance <= tolerance) return { kind: 'near', reason: null };
    return { kind: inside ? 'inside' : 'outside', reason: null };
};

const initialBoundaryState = () => ({
    status: 'unavailable',
    reason: 'no_fix',
    outsideSinceMs: null,
    lastOutsideSampleMs: null,
    outsideSampleCount: 0,
    lastUsableMs: null,
    lastSampleMs: null,
    outsideConfirmedAt: null,
});

// Pure transition. Time comes only from the `times` argument: `sampleMs`
// is the device's own sample time, `receivedMs` is server receipt time.
const nextBoundaryState = (prev, classification, times) => {
    const { confirmMinSpanMs, confirmMaxGapMs } = GAME_BOUNDARY_CONFIG;
    const t = times.sampleMs;

    if (classification.kind === 'unusable') {
        return { ...prev, status: 'unavailable', reason: classification.reason, outsideSinceMs: null, outsideSampleCount: 0 };
    }

    const usable = { ...prev, lastUsableMs: t, lastSampleMs: t };

    if (classification.kind === 'inside') {
        return { ...usable, status: 'inside', reason: null, outsideSinceMs: null, lastOutsideSampleMs: null, outsideSampleCount: 0, outsideConfirmedAt: null };
    }
    if (classification.kind === 'near') {
        const status = prev.status === 'outside' ? 'outside' : 'near';
        return { ...usable, status, reason: null, outsideSinceMs: null, outsideSampleCount: 0 };
    }

    // outside candidate
    const gapTooLarge = prev.lastOutsideSampleMs !== null && t - prev.lastOutsideSampleMs > confirmMaxGapMs;
    const restart = prev.outsideSinceMs === null || gapTooLarge;
    const outsideSinceMs = restart ? t : prev.outsideSinceMs;
    const outsideSampleCount = restart ? 1 : prev.outsideSampleCount + 1;
    const confirmed = outsideSampleCount >= 2 && t - outsideSinceMs >= confirmMinSpanMs;

    if (confirmed) {
        const outsideConfirmedAt = prev.status === 'outside' ? prev.outsideConfirmedAt : t;
        return { ...usable, status: 'outside', reason: null, outsideSinceMs, lastOutsideSampleMs: t, outsideSampleCount, outsideConfirmedAt };
    }
    return { ...usable, status: prev.status === 'outside' ? 'outside' : 'near', reason: null, outsideSinceMs, lastOutsideSampleMs: t, outsideSampleCount };
};

const deriveFreshStatus = (state, nowMs) => {
    if (state.lastUsableMs === null || nowMs - state.lastUsableMs > GAME_BOUNDARY_CONFIG.freshnessMs) {
        return { status: 'unavailable', reason: 'stale' };
    }
    return { status: state.status, reason: state.reason ?? null };
};
```

Also add `GAME_BOUNDARY_CONFIG, isPointInPolygon, distanceToRingMeters, classifyFix, initialBoundaryState, nextBoundaryState, deriveFreshStatus` to `module.exports`.

Implementation note: the `unusable` path clears `lastUsableMs`? No — it deliberately does not reset `lastUsableMs`, so `deriveFreshStatus` still ages out correctly. Keep it that way.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/game/gameBoundary.test.js -v`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameBoundary.js src/game/gameBoundary.test.js
git commit -m "Add pure location classification and outside-confirmation state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Vendor gameBoundary into Cloud Functions

**Files:**
- Modify: `functions/scripts/sync-shared-game-logic.js` (the `FILES` array)
- Verify: `functions/vendor/game/gameBoundary.js` is generated (vendor directory is gitignored)

- [ ] **Step 1: Add the module to the sync list**

In `functions/scripts/sync-shared-game-logic.js`, add `'gameBoundary.js',` to the `FILES` array after `'missionCompletion.js',`.

- [ ] **Step 2: Run the sync and confirm the file lands**

Run: `node functions/scripts/sync-shared-game-logic.js && ls functions/vendor/game/gameBoundary.js`
Expected: the sync message lists `gameBoundary.js`, and the `ls` prints the path.

- [ ] **Step 3: Commit**

```bash
git add functions/scripts/sync-shared-game-logic.js
git commit -m "Vendor gameBoundary.js into Cloud Functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: publishGameBoundary and disableGameBoundary callables

**Files:**
- Create: `functions/callableFunctions/gameBoundary.js`
- Create: `functions/callableFunctions/gameBoundary.integration.test.js`

**Interfaces:**
- Produces: `exports.publishGameBoundary` and `exports.disableGameBoundary` (`functions.https.onCall`).
  - Publish data: `{ roomId, expectedRevision, shapeType, vertices, shapeParameters }` → `{ revision }`.
  - Disable data: `{ roomId, expectedRevision }` → `{ revision }`.
  - Errors: `unauthenticated`, `invalid-argument` (missing fields or failing `validateBoundaryShape`), `not-found` (room), `permission-denied` (caller is not the host), `failed-precondition` with message `revision_conflict`, `failed-precondition` `This game has ended.` when `isGameActive` is false.
- Consumes: `shapeToPolygon`, `validateBoundaryShape` from the vendored `../vendor/game/gameBoundary`.

- [ ] **Step 1: Write the failing integration tests**

Create `functions/callableFunctions/gameBoundary.integration.test.js`. It follows the same emulator conventions as `src/components/submitKillPhoto.integration.test.js` (`seedRoom`, `callableAsNonHost`, `clearFirestore`, `shutdown` from `test/emulatorHelpers`). Cover, in separate `it` blocks:

1. host publishes a valid rectangle, the room doc gets `gameBoundary` with `enabled: true`, `revision: 1`, the vertices, `shapeType: 'rectangle'`, and `updatedAt` set.
2. a second publish with `expectedRevision: 1` yields `revision: 2`.
3. publish with a stale `expectedRevision` is rejected with `revision_conflict` and the room is unchanged.
4. a non-host caller is rejected with `permission-denied` and the room is unchanged.
5. an invalid shape (bow-tie) is rejected with `invalid-argument` and nothing is written.
6. publish on an ended room is rejected with `This game has ended.`.
7. disable with the correct `expectedRevision` sets `enabled: false` and increments `revision`, keeping the shape.
8. disable with a stale revision is rejected with `revision_conflict`.

Each test asserts on the real Firestore doc after the call, not only on whether the call threw.

- [ ] **Step 2: Run to verify failure**

Run: `node functions/scripts/sync-shared-game-logic.js && firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,auth,functions,storage "npx jest --selectProjects integration --runInBand -t gameBoundary"`
Expected: FAIL — the callables do not exist.

- [ ] **Step 3: Implement the callables**

Create `functions/callableFunctions/gameBoundary.js`:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Subpath import, same reason as submitKillPhoto.js: the emulator strips
// static properties off the top-level admin.firestore binding.
const { FieldValue } = require('firebase-admin/firestore');
const { validateBoundaryShape } = require('../vendor/game/gameBoundary');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const readRoomForHost = (snapshot, uid) => {
    if (!snapshot.exists) {
        throw new functions.https.HttpsError('not-found', 'Room not found.');
    }
    if (snapshot.data().hostId !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Only the room host can change the game area.');
    }
    if (!snapshot.data().isGameActive) {
        throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
    }
    return snapshot.data();
};

const currentRevision = (room) => (room.gameBoundary && room.gameBoundary.revision) || 0;

exports.publishGameBoundary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const { roomId, expectedRevision, shapeType, vertices, shapeParameters } = data || {};
    if (!roomId || typeof expectedRevision !== 'number') {
        throw new functions.https.HttpsError('invalid-argument', 'roomId and expectedRevision are required.');
    }
    const shape = validateBoundaryShape(shapeType, vertices);
    if (!shape.ok) {
        throw new functions.https.HttpsError('invalid-argument', shape.reason);
    }

    const roomRef = db.collection('rooms').doc(roomId);
    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        const room = readRoomForHost(roomSnapshot, context.auth.uid);
        const revision = currentRevision(room);
        if (expectedRevision !== revision) {
            throw new functions.https.HttpsError('failed-precondition', 'revision_conflict');
        }
        const nextRevision = revision + 1;
        transaction.update(roomRef, {
            gameBoundary: {
                enabled: true,
                revision: nextRevision,
                shapeType,
                vertices,
                shapeParameters: shapeParameters ?? null,
                updatedAt: FieldValue.serverTimestamp(),
            },
        });
        return { revision: nextRevision };
    });
});

exports.disableGameBoundary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const { roomId, expectedRevision } = data || {};
    if (!roomId || typeof expectedRevision !== 'number') {
        throw new functions.https.HttpsError('invalid-argument', 'roomId and expectedRevision are required.');
    }

    const roomRef = db.collection('rooms').doc(roomId);
    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        const room = readRoomForHost(roomSnapshot, context.auth.uid);
        const revision = currentRevision(room);
        if (expectedRevision !== revision) {
            throw new functions.https.HttpsError('failed-precondition', 'revision_conflict');
        }
        const nextRevision = revision + 1;
        transaction.update(roomRef, {
            'gameBoundary.enabled': false,
            'gameBoundary.revision': nextRevision,
            'gameBoundary.updatedAt': FieldValue.serverTimestamp(),
        });
        return { revision: nextRevision };
    });
});
```

- [ ] **Step 4: Run to verify pass**

Run the command from Step 2. Expected: all eight tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/callableFunctions/gameBoundary.js functions/callableFunctions/gameBoundary.integration.test.js
git commit -m "Add host-only publish and disable callables for the game boundary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: reportPlayerLocation callable

**Files:**
- Create: `functions/callableFunctions/reportPlayerLocation.js`
- Create: `functions/callableFunctions/reportPlayerLocation.integration.test.js`

**Interfaces:**
- Produces: `exports.reportPlayerLocation` (`functions.https.onCall`).
  - Fix data: `{ roomId, boundaryRevision, sampleMs, lat, lng, accuracyM }` → `{ status, reason }` (the freshly stored status).
  - Error data: `{ roomId, boundaryRevision, sampleMs, error: 'permission_denied' | 'unavailable' | 'timeout' }` → `{ status: 'unavailable', reason: <error> }`. No coordinates are accepted here.
  - Writes: `rooms/{roomId}/boundaryStatuses/{playerKey}` on every accepted report, and `rooms/{roomId}/boundaryEvents/{autoId}` (type `outside` or `returnedInside`) only when the status transitions.
- Consumes: `classifyFix`, `nextBoundaryState`, `initialBoundaryState`, `GAME_BOUNDARY_CONFIG` from the vendored module; `nextRateLimitWindow` from `../vendor/game/rateLimit`.

- [ ] **Step 1: Write the failing integration tests**

Cover, each in its own `it`, asserting on real Firestore state after the call:

1. A valid inside fix from a player whose `uid` matches the caller writes a status doc keyed by the player's normalized id with `status: 'inside'`, `boundaryRevision` matching the room, and `lastUsableReceivedAt` set, and no event doc.
2. The stored status doc contains no `lat` or `lng` fields.
3. A caller whose uid matches no player is rejected with `not-found` and nothing is written.
4. A caller whose uid matches two player docs is rejected with `failed-precondition` (mirrors `submitKillPhoto`).
5. A report for a revision other than the room's current revision is rejected with `failed-precondition` `revision_conflict`.
6. A report with `sampleMs` more than 30 s in the past, or more than 5 s in the future, is rejected with `invalid-argument`.
7. A report whose `sampleMs` is older than the last stored `lastSampleMs` is rejected as out-of-order, and the stored status is unchanged.
8. Two outside fixes 20 s apart (both usable) write status `outside` and exactly one `outside` event; a third outside fix a few seconds later writes no additional event (duplicate-suppression).
9. An inside fix after a confirmed outside writes one `returnedInside` event and status `inside`.
10. A player with a disabled boundary (`gameBoundary.enabled: false`) gets `rejected` `failed-precondition` `Game area is not active.` and nothing is written.
11. An error report (`error: 'permission_denied'`) writes status `unavailable` with reason `permission_denied`, carries no coordinates, and never writes an `outside` event.
12. Rate limiting: a player who sends 21 reports within one minute gets `resource-exhausted` on the 21st.
13. Two players reporting concurrently for different identities each affect only their own status doc.

- [ ] **Step 2: Run to verify failure**

Run the emulator command from Task 4 Step 2 with `-t reportPlayerLocation`. Expected: FAIL.

- [ ] **Step 3: Implement the callable**

Create `functions/callableFunctions/reportPlayerLocation.js` following these exact rules. The transaction structure mirrors `submitKillPhoto.js`:

- Validate `context.auth`, then `roomId`, `boundaryRevision` (number), `sampleMs` (finite number).
- Reject if `sampleMs` is older than `sampleMaxAgeMs` or more than `sampleMaxFutureMs` ahead of `Date.now()`, with `invalid-argument`.
- Inside one transaction:
  1. Read the room. Reject with `not-found` if absent, `failed-precondition` `This game has ended.` if `isGameActive` is false.
  2. Read `playersRef.where('uid', '==', context.auth.uid)`. Reject `not-found` if empty and `failed-precondition` if more than one doc, matching `submitKillPhoto.js`.
  3. Reject `failed-precondition` `Game area is not active.` unless `gameBoundary.enabled === true`.
  4. Reject `failed-precondition` `revision_conflict` unless `boundaryRevision === gameBoundary.revision`.
  5. Read the rate-limit window from the player doc (`rateLimits.boundaryReport`), using `nextRateLimitWindow(current, Date.now(), GAME_BOUNDARY_CONFIG.reportRateLimit)`. Reject `resource-exhausted` when it returns null.
  6. Read `boundaryStatuses/{playerDoc.id}`, default to `initialBoundaryState()` when absent.
  7. If the report is an error report, compute `next` as `{ ...prev, status: 'unavailable', reason: error, lastSampleMs: sampleMs }`.
  8. Otherwise, reject `invalid-argument` if `sampleMs <= prev.lastSampleMs` (out-of-order), then `classification = classifyFix(ring, { lat, lng, accuracyM })`, where `ring` comes from the room's `gameBoundary.vertices`, and `next = nextBoundaryState(prev, classification, { sampleMs, receivedMs: Date.now() })`.
  9. Write the rate-limit window back to the player doc, and write `boundaryStatuses/{playerDoc.id}` with `status`, `reason`, `boundaryRevision`, `uid`, `accuracyMeters` (or `null`), `lastSampleAt`, `receivedAt`, `lastUsableReceivedAt`, `outsideSince`, `lastOutsideSampleAt`, `outsideConfirmedAt`, `statusChangedAt`. Use `FieldValue.serverTimestamp()` for `receivedAt` and `statusChangedAt`. Do not store coordinates.
  10. If `prev.status !== 'outside' && next.status === 'outside'`, write a `boundaryEvents` doc with `type: 'outside'`, `playerName`, `boundaryRevision`, `timestamp: serverTimestamp()`. If `prev.status === 'outside' && next.status === 'inside'`, write one with `type: 'returnedInside'`. Never write coordinates into the event.
- Return `{ status: next.status, reason: next.reason }`.
- Never log lat/lng. Error messages must not include coordinates.

Note: the status doc field for `lastSampleAt` stores the device sample time as a Firestore `Timestamp` via `Timestamp.fromMillis`. Keep the field names exactly as listed above.

- [ ] **Step 4: Run to verify pass**

Expected: all thirteen tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/callableFunctions/reportPlayerLocation.js functions/callableFunctions/reportPlayerLocation.integration.test.js
git commit -m "Add server-evaluated player location reports for the game boundary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Lifecycle cleanup on removal and reconnect

**Files:**
- Modify: `functions/callableFunctions/removePlayer.js` (inside `removeAndRemap`, near the existing `transaction.delete(playerDoc.ref)` at line 137)
- Modify: `functions/callableFunctions/reconnectRequest.js` (inside `approveReconnectRequest`, next to the existing `transaction.update(playerRef, { uid: requestData.requestingUid })` at line 209)
- Modify: the matching integration test files, `functions/callableFunctions/removePlayerCallable.integration.test.js` and `functions/callableFunctions/reconnectRequestCallable.integration.test.js` (the latter may sit under `src/components/` — find it with `grep -rl approveReconnectRequest src functions --include="*.test.js"` before editing)

**Interfaces:**
- Consumes: the `boundaryStatuses/{playerKey}` path from Task 5.

- [ ] **Step 1: Write failing tests**

In the removal test file, add: removing a player who has a boundary status deletes that status doc in the same call.

In the reconnect test file, add: approving a reconnect deletes the old status doc for that player, so the new identity starts with a fresh status and the old uid loses any status trail.

Assert both via a real Firestore read after the call.

- [ ] **Step 2: Run to verify failure**, using the emulator command with `-t` for the test names.

- [ ] **Step 3: Implement**

In `removeAndRemap`, after `transaction.delete(playerDoc.ref);` add:

```js
transaction.delete(roomRef.collection('boundaryStatuses').doc(playerDoc.id));
```

In `approveReconnectRequest`, after `transaction.update(playerRef, { uid: requestData.requestingUid });` add:

```js
transaction.delete(roomRef.collection('boundaryStatuses').doc(playerRef.id));
```

Both deletes are no-ops when the doc is absent, which is correct.

- [ ] **Step 4: Run to verify pass**, including the existing removal and reconnect tests.

- [ ] **Step 5: Commit**

```bash
git add functions/callableFunctions/removePlayer.js functions/callableFunctions/reconnectRequest.js functions/callableFunctions/removePlayerCallable.integration.test.js
git commit -m "Clear boundary status on player removal and reconnect identity transfer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Security rules for statuses, events, and the boundary field

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

- [ ] **Step 1: Write failing rules tests**

Add a `describe` block covering:

1. A host can read all `boundaryStatuses` and `boundaryEvents` in their room.
2. A player can read their own `boundaryStatuses/{theirKey}` doc only, not another player's.
3. A player cannot list `boundaryStatuses`.
4. A signed-in non-member cannot read any boundary status or event in another room.
5. No client (host or player) can write `boundaryStatuses` or `boundaryEvents`.
6. A host client updating the room's `gameBoundary` field directly is denied.
7. A host client updating an ordinary room field (for example `taskIndex`) still succeeds, so existing room writes are unaffected.

Use the existing helpers and seeding conventions in `test/firestore.rules.test.js`.

- [ ] **Step 2: Run to verify failure**

Run: `firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,storage "npx jest --selectProjects rules --runInBand"`
Expected: the new denial and read tests fail, since no rules exist yet.

- [ ] **Step 3: Implement the rules**

In `firestore.rules`, inside `match /rooms/{roomId}`:

Replace the broad update clause with one that blocks changes to the boundary field:

```
      allow update: if isHostOfExistingRoom(roomId) &&
        !request.resource.data.diff(resource.data).affectedKeys().hasAny(['gameBoundary']);
      allow delete: if isHostOfExistingRoom(roomId);
```

Add subcollections next to `match /players/{playerId}`:

```
      match /boundaryStatuses/{playerId} {
        allow read: if isHostOfExistingRoom(roomId) ||
          (isSignedIn() && isOwnBoundaryStatus(roomId, playerId));
        allow write: if false;
      }

      match /boundaryEvents/{eventId} {
        allow read: if isHostOfExistingRoom(roomId);
        allow write: if false;
      }
```

Add the helper next to `isPlayerOfRoom`:

```
    function isOwnBoundaryStatus(roomId, playerId) {
      let playerPath = /databases/$(database)/documents/rooms/$(roomId)/players/$(playerId);
      return exists(playerPath) && get(playerPath).data.uid == request.auth.uid;
    }
```

Keep the existing `isHostOfExistingRoom` and `isPlayerOfRoom` helpers unchanged.

Note: `allow update` and `allow delete` are split on purpose. The old single clause granted both, and delete must stay host-only with no boundary-field restriction.

- [ ] **Step 4: Run to verify pass**, plus the full rules suite to confirm nothing else regressed.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules test/firestore.rules.test.js
git commit -m "Restrict boundary status and event reads, and block direct boundary edits

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Register callables, update docs, run the full gate

**Files:**
- Modify: `functions/index.js`
- Modify: `docs/data-model.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Register the new callables**

In `functions/index.js`, add, following the existing pattern:

```js
const { publishGameBoundary, disableGameBoundary } = require("./callableFunctions/gameBoundary")
exports.publishGameBoundary = publishGameBoundary
exports.disableGameBoundary = disableGameBoundary

const { reportPlayerLocation } = require("./callableFunctions/reportPlayerLocation")
exports.reportPlayerLocation = reportPlayerLocation
```

- [ ] **Step 2: Update the living docs**

In `docs/data-model.md`, add a `gameBoundary` row to the `rooms/{roomID}` table, and sections for `rooms/{roomID}/boundaryStatuses/{playerId}` and `rooms/{roomID}/boundaryEvents/{autoId}`, using the field lists from the spec. State that no coordinates are stored.

In `docs/architecture.md`, add the two callables to the Cloud Functions inventory, and update the callable count.

- [ ] **Step 3: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
npm run test:emulator
npm run test:rules
```

Expected: all pass. Do not claim done before this output is shown.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js docs/data-model.md docs/architecture.md
git commit -m "Register game boundary callables and document the new data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Out of this phase (later plans)

- **Phase 2:** moderator drawing editor (`BoundaryEditorModal.js`), depends on the map provider decision.
- **Phase 3:** player tracking hook (`useBoundaryLocation.js`), map modal (`PlayerMapModal.js`), and player status UI in `PlayerGame.js`.
- **Phase 4:** moderator roster badges, counts, toasts (`PlayersList.js`), and dashboard loading of existing flags.

Phase 1 leaves the feature unreachable from the UI on purpose. It is verified entirely by the emulator and rules suites.
