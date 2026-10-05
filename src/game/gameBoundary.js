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

/**
 * @throws {Error} when the shape type is unknown or its parameters are malformed
 */
const shapeToPolygon = (shapeType, shapeParameters) => {
    if (shapeType === 'rectangle') {
        const { corners } = shapeParameters || {};
        if (!Array.isArray(corners) || corners.length !== 2) {
            throw new Error('rectangle corners must be exactly two points');
        }
        corners.forEach((corner) => requirePoint(corner, 'rectangle corner'));
        const [a, b] = corners;
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
        const { center, radiusMeters } = shapeParameters || {};
        requirePoint(center, 'circle center');
        requirePositive(radiusMeters, 'circle radiusMeters');
        return sampleEllipse(center, radiusMeters, radiusMeters);
    }
    if (shapeType === 'oval') {
        const { center, radiusXMeters, radiusYMeters } = shapeParameters || {};
        requirePoint(center, 'oval center');
        requirePositive(radiusXMeters, 'oval radiusXMeters');
        requirePositive(radiusYMeters, 'oval radiusYMeters');
        return sampleEllipse(center, radiusXMeters, radiusYMeters);
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

module.exports = {
    EARTH_RADIUS_M,
    MAX_VERTICES,
    MAX_SPAN_METERS,
    shapeToPolygon,
    validateBoundaryShape,
    projectToMeters,
};
