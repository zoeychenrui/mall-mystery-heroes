/**
 * Game boundary geometry: canonical polygon conversion and shape
 * validation. Pure — no Firebase, no React, no clock. CommonJS, matching
 * killPhotoUrl.js and rateLimit.js, so Cloud Functions can load the same
 * file through functions/vendor/game/.
 *
 * Distances use a local equirectangular projection around a chosen origin.
 * Against haversine, the error on an east-west edge 10 km north of the origin
 * latitude is about 13 m at 40 degrees latitude and about 27 m at 60 degrees.
 * The error grows with north-south distance from the origin, so the 15 m edge
 * tolerance in later tasks must allow for this projection error.
 */
const EARTH_RADIUS_M = 6371008.8;
const MAX_VERTICES = 500;
const MAX_SPAN_METERS = 10000;
const CIRCLE_SAMPLES = 64;
const MIN_AREA_M2 = 1;
// Orientation values below this (in square meters) count as collinear. Only
// rounding noise falls under it, so exact touches are still detected.
const ORIENTATION_EPSILON = 1e-9;
const SHAPE_TYPES = ['freehand', 'rectangle', 'circle', 'oval'];

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const toRadians = (deg) => (deg * Math.PI) / 180;
const toDegrees = (rad) => (rad * 180) / Math.PI;

// Equirectangular projection around `origin`, in meters.
const projectToMeters = (point, origin) => ({
    x: toRadians(point.lng - origin.lng) * Math.cos(toRadians(origin.lat)) * EARTH_RADIUS_M,
    y: toRadians(point.lat - origin.lat) * EARTH_RADIUS_M,
});

const offsetPoint = (center, eastMeters, northMeters) => ({
    lat: center.lat + toDegrees(northMeters / EARTH_RADIUS_M),
    lng: center.lng + toDegrees(eastMeters / (EARTH_RADIUS_M * Math.cos(toRadians(center.lat)))),
});

// Rotates `point` clockwise by `degrees` around `center`. `degrees` may be
// 0, null, or undefined, all treated as "no rotation" — the single
// rotation primitive shapeToPolygon's Rectangle/Oval branches use, and
// the only one the client-side editor uses too (BoundaryEditorModal.js),
// so the shape the moderator sees while dragging and the shape the
// server re-derives to validate a publish can never disagree about what
// "rotated 30 degrees" means.
const rotatePoint = (point, center, degrees) => {
    if (!degrees) return point;
    const radians = toRadians(degrees);
    const { x, y } = projectToMeters(point, center);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return offsetPoint(center, x * cos + y * sin, -x * sin + y * cos);
};

const requirePoint = (point, label) => {
    if (!point || !isFiniteNumber(point.lat) || !isFiniteNumber(point.lng)) {
        throw new Error(`${label} must be {lat, lng} with finite numbers`);
    }
};

const requirePositive = (value, label) => {
    if (!isFiniteNumber(value) || value <= 0) {
        throw new Error(`${label} must be a positive finite number`);
    }
};

const sampleEllipse = (center, radiusXMeters, radiusYMeters) => {
    const ring = [];
    for (let i = 0; i < CIRCLE_SAMPLES; i += 1) {
        const theta = (2 * Math.PI * i) / CIRCLE_SAMPLES;
        ring.push(
            offsetPoint(center, radiusXMeters * Math.cos(theta), radiusYMeters * Math.sin(theta))
        );
    }
    ring.push(Object.assign({}, ring[0]));
    return ring;
};

const closeRing = (points) => {
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last && first.lat === last.lat && first.lng === last.lng) {
        return points;
    }
    return [...points, Object.assign({}, first)];
};

/**
 * @throws {Error} when the shape type is unknown or its parameters are malformed
 */
const requireOptionalRotation = (rotationDegrees, label) => {
    if (rotationDegrees != null && !isFiniteNumber(rotationDegrees)) {
        throw new Error(`${label} must be a finite number`);
    }
};

const shapeToPolygon = (shapeType, shapeParameters) => {
    if (shapeType === 'rectangle') {
        const { corners, rotationDegrees } = shapeParameters || {};
        if (!Array.isArray(corners) || corners.length !== 2) {
            throw new Error('rectangle corners must be exactly two points');
        }
        corners.forEach((corner) => requirePoint(corner, 'rectangle corner'));
        requireOptionalRotation(rotationDegrees, 'rectangle rotationDegrees');
        const [a, b] = corners;
        const minLat = Math.min(a.lat, b.lat);
        const maxLat = Math.max(a.lat, b.lat);
        const minLng = Math.min(a.lng, b.lng);
        const maxLng = Math.max(a.lng, b.lng);
        const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
        const unrotated = [
            { lat: minLat, lng: minLng },
            { lat: minLat, lng: maxLng },
            { lat: maxLat, lng: maxLng },
            { lat: maxLat, lng: minLng },
        ];
        return closeRing(unrotated.map((corner) => rotatePoint(corner, center, rotationDegrees)));
    }
    if (shapeType === 'circle') {
        const { center, radiusMeters } = shapeParameters || {};
        requirePoint(center, 'circle center');
        requirePositive(radiusMeters, 'circle radiusMeters');
        return sampleEllipse(center, radiusMeters, radiusMeters);
    }
    if (shapeType === 'oval') {
        const { center, radiusXMeters, radiusYMeters, rotationDegrees } = shapeParameters || {};
        requirePoint(center, 'oval center');
        requirePositive(radiusXMeters, 'oval radiusXMeters');
        requirePositive(radiusYMeters, 'oval radiusYMeters');
        requireOptionalRotation(rotationDegrees, 'oval rotationDegrees');
        const ring = sampleEllipse(center, radiusXMeters, radiusYMeters);
        if (!rotationDegrees) return ring;
        return closeRing(
            ring.slice(0, -1).map((point) => rotatePoint(point, center, rotationDegrees))
        );
    }
    if (shapeType === 'freehand') {
        throw new Error('freehand shapes are supplied as vertices, not converted');
    }
    throw new Error(`unknown shape type: ${shapeType}`);
};

// Sign of the cross product (a - o) x (b - o), with 0 meaning collinear.
const orientation = (o, a, b) => {
    const value = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    if (Math.abs(value) < ORIENTATION_EPSILON) return 0;
    return value > 0 ? 1 : -1;
};

// Whether point p lies within the bounding box of segment a-b. Only meaningful
// for a point already known to be collinear with a-b.
const inBoundingBox = (p, a, b) =>
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y);

// True for a proper crossing and for any touch: an endpoint lying on the other
// segment, or collinear overlap.
const segmentsIntersect = (p1, p2, p3, p4) => {
    const d1 = orientation(p3, p4, p1);
    const d2 = orientation(p3, p4, p2);
    const d3 = orientation(p1, p2, p3);
    const d4 = orientation(p1, p2, p4);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    if (d1 === 0 && inBoundingBox(p1, p3, p4)) return true;
    if (d2 === 0 && inBoundingBox(p2, p3, p4)) return true;
    if (d3 === 0 && inBoundingBox(p3, p1, p2)) return true;
    if (d4 === 0 && inBoundingBox(p4, p1, p2)) return true;
    return false;
};

/**
 * @param {string} shapeType
 * @param {Array<{lat: number, lng: number}>} vertices closed ring
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
const validateBoundaryShape = (shapeType, vertices) => {
    if (!SHAPE_TYPES.includes(shapeType)) {
        return { ok: false, reason: `Unknown shape type: ${shapeType}` };
    }
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
            return {
                ok: false,
                reason: 'Coordinates are outside the valid latitude/longitude range.',
            };
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

    const origin = { lat: Math.min(...lats), lng: Math.min(...lngs) };
    const projected = vertices.map((p) => projectToMeters(p, origin));

    const edgeCount = projected.length - 1;
    for (let i = 0; i < edgeCount; i += 1) {
        for (let j = i + 2; j < edgeCount; j += 1) {
            if (i === 0 && j === edgeCount - 1) continue;
            if (segmentsIntersect(projected[i], projected[i + 1], projected[j], projected[j + 1])) {
                return { ok: false, reason: 'The boundary must not self-intersect.' };
            }
        }
    }

    let twiceArea = 0;
    for (let i = 0; i < projected.length - 1; i += 1) {
        const a = projected[i];
        const b = projected[i + 1];
        twiceArea += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(twiceArea) / 2 < MIN_AREA_M2) {
        return { ok: false, reason: 'The boundary must enclose a nonzero area.' };
    }

    let maxSpan = 0;
    for (let i = 0; i < projected.length; i += 1) {
        for (let j = i + 1; j < projected.length; j += 1) {
            const dx = projected[i].x - projected[j].x;
            const dy = projected[i].y - projected[j].y;
            maxSpan = Math.max(maxSpan, Math.hypot(dx, dy));
        }
    }
    if (maxSpan > MAX_SPAN_METERS) {
        return { ok: false, reason: 'A boundary may span at most 10 km.' };
    }
    return { ok: true };
};

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
    const t =
        lengthSq === 0
            ? 0
            : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
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
    if (
        !fix ||
        !isFiniteNumber(fix.lat) ||
        !isFiniteNumber(fix.lng) ||
        !isFiniteNumber(fix.accuracyM)
    ) {
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

// Pure transition. All timing uses `receivedMs` (server receipt time), so device
// clock skew cannot affect confirmation. `sampleMs` is only recorded in
// lastSampleMs for the callable's out-of-order check. This transition does not
// reject out-of-order samples; the callable does.
const nextBoundaryState = (prev, classification, times) => {
    const { confirmMinSpanMs, confirmMaxGapMs } = GAME_BOUNDARY_CONFIG;
    const t = times.receivedMs;

    if (classification.kind === 'unusable') {
        return Object.assign({}, prev, {
            status: 'unavailable',
            reason: classification.reason,
            outsideSinceMs: null,
            outsideSampleCount: 0,
            lastSampleMs: times.sampleMs,
        });
    }

    const usable = Object.assign({}, prev, { lastUsableMs: t, lastSampleMs: times.sampleMs });

    if (classification.kind === 'inside') {
        return Object.assign({}, usable, {
            status: 'inside',
            reason: null,
            outsideSinceMs: null,
            lastOutsideSampleMs: null,
            outsideSampleCount: 0,
            outsideConfirmedAt: null,
        });
    }
    if (classification.kind === 'near') {
        // Near the edge ends exposure. Keeping status 'outside' through the
        // edge buffer left returning players visible to everyone (and their
        // coordinates readable under the outside-only Firestore rule) until
        // a clearly-inside fix arrived — often a long wait with phone GPS.
        // Only a later clearly-outside run can expose them again.
        return Object.assign({}, usable, {
            status: 'near',
            reason: null,
            outsideSinceMs: null,
            outsideSampleCount: 0,
            outsideConfirmedAt: null,
        });
    }

    // outside candidate
    const gapTooLarge =
        prev.lastOutsideSampleMs !== null && t - prev.lastOutsideSampleMs > confirmMaxGapMs;
    const restart = prev.outsideSinceMs === null || gapTooLarge;
    const outsideSinceMs = restart ? t : prev.outsideSinceMs;
    const outsideSampleCount = restart ? 1 : prev.outsideSampleCount + 1;
    const confirmed = outsideSampleCount >= 2 && t - outsideSinceMs >= confirmMinSpanMs;

    if (confirmed) {
        const outsideConfirmedAt = prev.outsideConfirmedAt !== null ? prev.outsideConfirmedAt : t;
        return Object.assign({}, usable, {
            status: 'outside',
            reason: null,
            outsideSinceMs,
            lastOutsideSampleMs: t,
            outsideSampleCount,
            outsideConfirmedAt,
        });
    }
    return Object.assign({}, usable, {
        status: prev.outsideConfirmedAt !== null ? 'outside' : 'near',
        reason: null,
        outsideSinceMs,
        lastOutsideSampleMs: t,
        outsideSampleCount,
    });
};

// Previous state to feed `nextBoundaryState` after the GM publishes a new
// boundary revision. A stored run was measured against the old ring, so it
// is not carried forward — except when the player is already confirmed
// outside and this fix is still outside the new ring. That player keeps
// the exposure clock they already have (`outsideSinceMs`,
// `outsideConfirmedAt`). Anyone who is only now outside starts clean, and
// `nextBoundaryState` opens a new cooldown for them. `lastSampleMs` always
// survives so an out-of-order sample is still rejected across the change.
const stateAfterBoundaryRevision = (prev, classification) => {
    const alreadyExposed = prev.outsideConfirmedAt !== null;
    const stillOutside = classification.kind === 'outside';
    if (alreadyExposed && stillOutside) return Object.assign({}, prev);
    return Object.assign({}, initialBoundaryState(), {
        lastSampleMs: prev.lastSampleMs,
    });
};

// Whether `player` is clearly outside `ring`. One predicate for both roles
// in `canSee`: a viewer and a target are classified by this same call, so
// the answer cannot depend on which argument was passed first.
const isOutsideBounds = (player, ring) => {
    if (!player || !isFiniteNumber(player.lat) || !isFiniteNumber(player.lng)) return false;
    const accuracyM = isFiniteNumber(player.accuracyM) ? player.accuracyM : 0;
    return classifyFix(ring, { lat: player.lat, lng: player.lng, accuracyM }).kind === 'outside';
};

// Whether `viewer` can see `target`'s live location. A target is visible
// exactly when their current position is clearly outside `ring` — the same
// `isOutsideBounds` check for every caller, so two outside players always
// agree (`canSee(A,B) === canSee(B,A)`), and a player who has walked back
// to the edge or inside is hidden from peers even if a stale status doc
// still says 'outside'. With no ring, fall back to confirmed exposure.
const canSee = (viewer, target, ring) => {
    if (!viewer || !target) return false;
    if (viewer.id != null && target.id != null && viewer.id === target.id) return false;
    if (Array.isArray(ring) && ring.length >= 4) {
        return isOutsideBounds(target, ring);
    }
    return target.status === 'outside';
};

// `current` is optional. When both currentRevision and currentUid are given, a
// stored state from another revision or another device is reported as
// unavailable rather than as the stored status.
const deriveFreshStatus = (state, nowMs, current = {}) => {
    if (
        state.lastUsableMs === null ||
        nowMs - state.lastUsableMs > GAME_BOUNDARY_CONFIG.freshnessMs
    ) {
        return { status: 'unavailable', reason: 'stale' };
    }
    if (current.currentRevision !== undefined && current.currentUid !== undefined) {
        if (state.boundaryRevision != null && state.boundaryRevision !== current.currentRevision) {
            return { status: 'unavailable', reason: 'wrong_revision' };
        }
        if (state.uid != null && state.uid !== current.currentUid) {
            return { status: 'unavailable', reason: 'wrong_uid' };
        }
    }
    // A reason only explains an unavailable status; other statuses carry none.
    const reason = state.status === 'unavailable' ? (state.reason ?? null) : null;
    return { status: state.status, reason };
};

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

// Object.assign, not `{ ...spread }`, throughout this file: object-spread
// syntax makes Babel inject an `import` for its `_objectSpread2` runtime
// helper, which flips webpack's view of this file to "ES module" even
// though it never uses import/export itself — and that in turn makes the
// `module.exports` reassignment below throw "ES Modules may not assign
// module.exports" at runtime, in the client bundle only (this file stays
// CommonJS for the Cloud Functions vendoring, but also gets pulled into the
// client bundle via the `require()` calls in boundaryDraft.js and
// BoundaryEditorModal.js). Array spread (`[...arr]`) does not trigger this.
module.exports = {
    EARTH_RADIUS_M,
    MAX_VERTICES,
    MAX_SPAN_METERS,
    shapeToPolygon,
    validateBoundaryShape,
    projectToMeters,
    offsetPoint,
    rotatePoint,
    GAME_BOUNDARY_CONFIG,
    isPointInPolygon,
    distanceToRingMeters,
    classifyFix,
    initialBoundaryState,
    nextBoundaryState,
    stateAfterBoundaryRevision,
    isOutsideBounds,
    canSee,
    deriveFreshStatus,
    isPositionFresh,
};
