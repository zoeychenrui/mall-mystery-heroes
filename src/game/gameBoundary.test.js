const {
    MAX_VERTICES,
    shapeToPolygon,
    validateBoundaryShape,
    projectToMeters,
    rotatePoint,
} = require('./gameBoundary');

const square = [
    { lat: 40.0, lng: -74.0 },
    { lat: 40.0, lng: -73.999 },
    { lat: 40.001, lng: -73.999 },
    { lat: 40.001, lng: -74.0 },
    { lat: 40.0, lng: -74.0 },
];

const center = { lat: 40.0, lng: -74.0 };

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

    it('a rectangle with no rotationDegrees, or exactly 0, is identical to the unrotated one', () => {
        const params = {
            corners: [
                { lat: 40.0, lng: -74.0 },
                { lat: 40.001, lng: -73.999 },
            ],
        };
        const unrotated = shapeToPolygon('rectangle', params);
        expect(shapeToPolygon('rectangle', { ...params, rotationDegrees: 0 })).toEqual(unrotated);
        expect(shapeToPolygon('rectangle', { ...params, rotationDegrees: null })).toEqual(
            unrotated
        );
    });

    it('rotating a rectangle 90 degrees keeps its center and side lengths, but swaps which sides are long/short', () => {
        const params = {
            corners: [
                { lat: 40.0, lng: -74.0 },
                { lat: 40.001, lng: -73.998 }, // taller east-west than north-south
            ],
        };
        const unrotated = shapeToPolygon('rectangle', params);
        const rotated = shapeToPolygon('rectangle', { ...params, rotationDegrees: 90 });

        const spanMeters = (ring, axis) => {
            const origin = ring[0];
            const projected = ring.map((p) => projectToMeters(p, origin));
            const values = projected.map((p) => p[axis]);
            return Math.max(...values) - Math.min(...values);
        };
        // A 90-degree turn swaps which axis is the long one.
        expect(spanMeters(rotated, 'x')).toBeCloseTo(spanMeters(unrotated, 'y'), 0);
        expect(spanMeters(rotated, 'y')).toBeCloseTo(spanMeters(unrotated, 'x'), 0);
    });

    it('a rotated rectangle is still rejected as a rectangle by its own validation rules (self-intersection, area) exactly like an unrotated one', () => {
        const params = {
            corners: [
                { lat: 40.0, lng: -74.0 },
                { lat: 40.001, lng: -73.999 },
            ],
            rotationDegrees: 37,
        };
        const ring = shapeToPolygon('rectangle', params);
        expect(validateBoundaryShape('rectangle', ring)).toEqual({ ok: true });
    });

    it('rotating an oval keeps it centered, and rejects a non-finite rotationDegrees', () => {
        const params = { center: { lat: 40.0, lng: -74.0 }, radiusXMeters: 200, radiusYMeters: 50 };
        const rotated = shapeToPolygon('oval', { ...params, rotationDegrees: 45 });
        expect(rotated).toHaveLength(65);

        expect(() => shapeToPolygon('oval', { ...params, rotationDegrees: NaN })).toThrow(
            /rotationDegrees/
        );
        expect(() =>
            shapeToPolygon('rectangle', {
                corners: [
                    { lat: 40.0, lng: -74.0 },
                    { lat: 40.001, lng: -73.999 },
                ],
                rotationDegrees: 'forty-five',
            })
        ).toThrow(/rotationDegrees/);
    });

    it('rejects an unknown shape type', () => {
        expect(() => shapeToPolygon('triangle', {})).toThrow(/unknown shape type/i);
    });

    it('rejects a non-positive or non-finite radius', () => {
        expect(() => shapeToPolygon('circle', { center, radiusMeters: 0 })).toThrow(/radiusMeters/);
        expect(() => shapeToPolygon('circle', { center, radiusMeters: -5 })).toThrow(
            /radiusMeters/
        );
        expect(() => shapeToPolygon('circle', { center, radiusMeters: NaN })).toThrow(
            /radiusMeters/
        );
        expect(() =>
            shapeToPolygon('oval', { center, radiusXMeters: NaN, radiusYMeters: 50 })
        ).toThrow(/radiusXMeters/);
        expect(() =>
            shapeToPolygon('oval', { center, radiusXMeters: 200, radiusYMeters: -1 })
        ).toThrow(/radiusYMeters/);
    });

    it('rejects a missing or malformed center', () => {
        expect(() => shapeToPolygon('circle', { radiusMeters: 100 })).toThrow(/center/);
        expect(() =>
            shapeToPolygon('circle', { center: { lat: NaN, lng: -74.0 }, radiusMeters: 100 })
        ).toThrow(/center/);
        expect(() =>
            shapeToPolygon('oval', {
                center: { lat: 40.0 },
                radiusXMeters: 200,
                radiusYMeters: 50,
            })
        ).toThrow(/center/);
    });

    it('rejects a rectangle without exactly two finite corners', () => {
        expect(() => shapeToPolygon('rectangle', { corners: [{ lat: 40.0, lng: -74.0 }] })).toThrow(
            /corners/
        );
        expect(() =>
            shapeToPolygon('rectangle', {
                corners: [
                    { lat: 40.0, lng: -74.0 },
                    { lat: 40.001, lng: -73.999 },
                    { lat: 40.002, lng: -73.998 },
                ],
            })
        ).toThrow(/corners/);
        expect(() =>
            shapeToPolygon('rectangle', {
                corners: [
                    { lat: 40.0, lng: -74.0 },
                    { lat: Infinity, lng: -73.999 },
                ],
            })
        ).toThrow(/corner/);
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
            { lat: 40.002, lng: -74.0 },
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

    it('rejects a vertex that touches a non-adjacent edge (T-junction)', () => {
        const tJunction = [
            { lat: 0, lng: 0 },
            { lat: 4, lng: 0 },
            { lat: 4, lng: 4 },
            { lat: 2, lng: 0 },
            { lat: 0, lng: 4 },
            { lat: 0, lng: 0 },
        ];
        const result = validateBoundaryShape('freehand', tJunction);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/intersect/i);
    });

    it('rejects a spike that doubles back over itself', () => {
        const spike = [
            { lat: 0, lng: 0 },
            { lat: 4, lng: 0 },
            { lat: 2, lng: 0 },
            { lat: 2, lng: 3 },
            { lat: 0, lng: 0 },
        ];
        expect(validateBoundaryShape('freehand', spike).reason).toMatch(/intersect/i);
    });

    it('rejects a pinched ring that revisits a vertex', () => {
        const pinched = [
            { lat: 0, lng: 0 },
            { lat: 2, lng: 0 },
            { lat: 2, lng: 2 },
            { lat: 0, lng: 0 },
            { lat: -2, lng: 0 },
            { lat: -2, lng: -2 },
            { lat: 0, lng: 0 },
        ];
        expect(validateBoundaryShape('freehand', pinched).reason).toMatch(/intersect/i);
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

    it('accepts a circle of 4 km radius (8 km extent)', () => {
        const ring = shapeToPolygon('circle', { center, radiusMeters: 4000 });
        expect(validateBoundaryShape('circle', ring)).toEqual({ ok: true });
    });

    it('rejects a circle whose extent is over 10 km', () => {
        const ring = shapeToPolygon('circle', { center, radiusMeters: 6000 });
        expect(validateBoundaryShape('circle', ring).reason).toMatch(/10 km/);
    });

    it('rejects a rectangle whose extent is over 10 km', () => {
        const ring = shapeToPolygon('rectangle', {
            corners: [
                { lat: 40.0, lng: -74.0 },
                { lat: 40.1, lng: -73.0 },
            ],
        });
        expect(validateBoundaryShape('rectangle', ring).reason).toMatch(/10 km/);
    });

    it('rejects an unknown shape type before checking geometry', () => {
        const result = validateBoundaryShape('triangle', square);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/unknown shape type/i);
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

const {
    GAME_BOUNDARY_CONFIG,
    classifyFix,
    initialBoundaryState,
    nextBoundaryState,
    stateAfterBoundaryRevision,
    canSee,
    deriveFreshStatus,
    isPositionFresh,
    offsetPoint,
} = require('./gameBoundary');

describe('offsetPoint', () => {
    it('round-trips with projectToMeters', () => {
        const center = { lat: 40, lng: -74 };
        const offset = offsetPoint(center, 500, -300);
        const projected = projectToMeters(offset, center);
        expect(projected.x).toBeCloseTo(500, 0);
        expect(projected.y).toBeCloseTo(-300, 0);
    });

    it('east/north of zero is the center itself', () => {
        const center = { lat: 40, lng: -74 };
        expect(offsetPoint(center, 0, 0)).toEqual(center);
    });
});

describe('rotatePoint', () => {
    const center = { lat: 40, lng: -74 };

    it('is a no-op for 0, null, or undefined degrees', () => {
        const point = offsetPoint(center, 500, 0);
        expect(rotatePoint(point, center, 0)).toEqual(point);
        expect(rotatePoint(point, center, null)).toEqual(point);
        expect(rotatePoint(point, center, undefined)).toEqual(point);
    });

    it('rotating a point 90 degrees clockwise turns "due east" into "due south"', () => {
        const east = offsetPoint(center, 500, 0);
        const rotated = rotatePoint(east, center, 90);
        const { x, y } = projectToMeters(rotated, center);
        expect(x).toBeCloseTo(0, 0);
        expect(y).toBeCloseTo(-500, 0);
    });

    it('rotating by 360 degrees returns to very close to the original point', () => {
        const point = offsetPoint(center, 300, 400);
        const rotated = rotatePoint(point, center, 360);
        expect(rotated.lat).toBeCloseTo(point.lat, 9);
        expect(rotated.lng).toBeCloseTo(point.lng, 9);
    });

    it('never changes the distance from center, only the direction', () => {
        const point = offsetPoint(center, 300, -400);
        const before = projectToMeters(point, center);
        const rotated = rotatePoint(point, center, 53);
        const after = projectToMeters(rotated, center);
        expect(Math.hypot(after.x, after.y)).toBeCloseTo(Math.hypot(before.x, before.y), 3);
    });
});

// A roughly 100 m north-south by 77 m east-west rectangle, around 40N.
const plot = shapeToPolygon('rectangle', {
    corners: [
        { lat: 40.0, lng: -74.0 },
        { lat: 40.0009, lng: -73.9991 },
    ],
});
const plotCenter = { lat: 40.00045, lng: -73.99955 };
const fix = (overrides) => ({
    lat: plotCenter.lat,
    lng: plotCenter.lng,
    accuracyM: 5,
    ...overrides,
});
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

    it('accepts accuracy exactly at the cap and rejects anything above it', () => {
        expect(classifyFix(plot, fix({ accuracyM: 50 })).kind).not.toBe('unusable');
        expect(classifyFix(plot, fix({ accuracyM: 50.5 }))).toEqual({
            kind: 'unusable',
            reason: 'poor_accuracy',
        });
    });

    it('marks non-finite fixes as unusable', () => {
        expect(classifyFix(plot, fix({ lat: NaN }))).toEqual({
            kind: 'unusable',
            reason: 'invalid_fix',
        });
    });
});

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

    it('ends exposure on a near reading so a returning player is no longer visible to peers', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'outside' }, at(20000));
        expect(s.status).toBe('outside');
        expect(s.outsideConfirmedAt).toBe(20000);
        s = nextBoundaryState(s, { kind: 'near' }, at(25000));
        expect(s.status).toBe('near');
        expect(s.outsideConfirmedAt).toBeNull();
        s = nextBoundaryState(s, { kind: 'inside' }, at(30000));
        expect(s.status).toBe('inside');
        expect(s.outsideConfirmedAt).toBeNull();
    });

    it('ignores unusable readings for outside confirmation', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'unusable' }, at(10000));
        expect(s.outsideSampleCount).toBe(0);
    });

    it('an unusable reading records its sample time as lastSampleMs', () => {
        const s = nextBoundaryState(
            initialBoundaryState(),
            { kind: 'unusable', reason: 'poor_accuracy' },
            { sampleMs: 7000, receivedMs: 9000 }
        );
        expect(s.lastSampleMs).toBe(7000);
    });

    it('keeps a confirmed outside flag through unusable readings until the next usable near/inside', () => {
        let s = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, at(0));
        s = nextBoundaryState(s, { kind: 'outside' }, at(20000));
        s = nextBoundaryState(s, { kind: 'unusable', reason: 'poor_accuracy' }, at(25000));
        expect(s.status).toBe('unavailable');
        expect(s.outsideConfirmedAt).toBe(20000);
        s = nextBoundaryState(s, { kind: 'outside' }, at(30000));
        expect(s.status).toBe('outside');
        expect(s.outsideConfirmedAt).toBe(20000);
        s = nextBoundaryState(s, { kind: 'near' }, at(35000));
        expect(s.status).toBe('near');
        expect(s.outsideConfirmedAt).toBeNull();
    });

    it('confirms on server receipt spacing, ignoring device sample times', () => {
        // Same receipt spacing (0 then 20 s), but device clocks disagree wildly.
        const onTime = { sampleMs: 0, receivedMs: 0 };
        const onTime2 = { sampleMs: 20000, receivedMs: 20000 };
        const skewed = { sampleMs: 9000000, receivedMs: 0 };
        const skewed2 = { sampleMs: 5, receivedMs: 20000 };

        let a = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, onTime);
        a = nextBoundaryState(a, { kind: 'outside' }, onTime2);
        let b = nextBoundaryState(initialBoundaryState(), { kind: 'outside' }, skewed);
        b = nextBoundaryState(b, { kind: 'outside' }, skewed2);

        expect(b.status).toBe(a.status);
        expect(b.status).toBe('outside');
        expect(b.outsideConfirmedAt).toBe(a.outsideConfirmedAt);
        expect(b.outsideConfirmedAt).toBe(20000);
    });
});

describe('stateAfterBoundaryRevision', () => {
    const at = (ms) => ({ sampleMs: ms, receivedMs: ms });

    const exposed = (extra) => ({
        ...initialBoundaryState(),
        status: 'outside',
        outsideSinceMs: 5000,
        lastOutsideSampleMs: 25000,
        outsideSampleCount: 2,
        lastUsableMs: 25000,
        lastSampleMs: 25000,
        outsideConfirmedAt: 25000,
        ...extra,
    });

    it('keeps an already-exposed player exposed, with the same cooldown, when the new boundary still leaves them outside', () => {
        const position = { ...metersNorthOfPlot(60), accuracyM: 5 };
        const revisedRing = shapeToPolygon('rectangle', {
            corners: [
                { lat: 40.0, lng: -74.0 },
                { lat: 40.0004, lng: -73.9994 },
            ],
        });
        const classification = classifyFix(revisedRing, position);
        expect(classification.kind).toBe('outside');

        const carried = stateAfterBoundaryRevision(exposed(), classification);
        const next = nextBoundaryState(carried, classification, at(30000));

        expect(next.status).toBe('outside');
        expect(next.outsideSinceMs).toBe(5000);
        expect(next.outsideConfirmedAt).toBe(25000);
    });

    it('starts a new cooldown when a player who was not exposed is outside the revised boundary', () => {
        const prev = {
            ...initialBoundaryState(),
            status: 'inside',
            lastSampleMs: 1000,
        };
        const position = { ...metersNorthOfPlot(60), accuracyM: 5 };
        const classification = classifyFix(plot, position);
        expect(classification.kind).toBe('outside');

        const carried = stateAfterBoundaryRevision(prev, classification);
        const next = nextBoundaryState(carried, classification, at(40000));

        expect(next.status).toBe('near');
        expect(next.outsideConfirmedAt).toBeNull();
        expect(next.outsideSinceMs).toBe(40000);
    });

    it('clears exposure when the revised boundary now contains the player', () => {
        const classification = classifyFix(plot, fix());
        expect(classification.kind).toBe('inside');

        const carried = stateAfterBoundaryRevision(exposed(), classification);
        const next = nextBoundaryState(carried, classification, at(30000));

        expect(next.status).toBe('inside');
        expect(next.outsideSinceMs).toBeNull();
        expect(next.outsideConfirmedAt).toBeNull();
    });
});

describe('canSee', () => {
    it('is symmetric when both players are outside the boundary', () => {
        const dbo = {
            id: 'dbo',
            ...metersNorthOfPlot(80),
            accuracyM: 5,
            status: 'outside',
        };
        const allen = {
            id: 'allen',
            lat: metersNorthOfPlot(140).lat,
            lng: -73.9992,
            accuracyM: 5,
            status: 'outside',
        };

        expect(classifyFix(plot, dbo).kind).toBe('outside');
        expect(classifyFix(plot, allen).kind).toBe('outside');
        expect(canSee(dbo, allen, plot)).toBe(true);
        expect(canSee(allen, dbo, plot)).toBe(true);
    });

    it('hides a target whose position is back near or inside the boundary, even if status still says outside', () => {
        const viewer = {
            id: 'viewer',
            ...metersNorthOfPlot(80),
            accuracyM: 5,
            status: 'outside',
        };
        const returned = {
            id: 'returned',
            ...fix(),
            accuracyM: 5,
            status: 'outside',
        };
        expect(classifyFix(plot, returned).kind).toBe('inside');
        expect(canSee(viewer, returned, plot)).toBe(false);
    });
});

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

    it('returns the stored reason for an unavailable status', () => {
        const s = {
            ...initialBoundaryState(),
            status: 'unavailable',
            reason: 'poor_accuracy',
            lastUsableMs: 0,
        };
        expect(deriveFreshStatus(s, 1000)).toEqual({
            status: 'unavailable',
            reason: 'poor_accuracy',
        });
    });

    it('treats exactly the freshness window as fresh and one millisecond more as stale', () => {
        const s = { ...initialBoundaryState(), status: 'inside', lastUsableMs: 0 };
        expect(GAME_BOUNDARY_CONFIG.freshnessMs).toBe(30000);
        expect(deriveFreshStatus(s, 30000)).toEqual({ status: 'inside', reason: null });
        expect(deriveFreshStatus(s, 30001)).toEqual({ status: 'unavailable', reason: 'stale' });
    });

    describe('with the current revision and uid', () => {
        const fresh = (extra) => ({
            ...initialBoundaryState(),
            status: 'inside',
            lastUsableMs: 0,
            ...extra,
        });

        it('reports wrong_revision when the stored revision differs from the current one', () => {
            const s = fresh({ boundaryRevision: 1, uid: 'device-a' });
            expect(
                deriveFreshStatus(s, 1000, { currentRevision: 2, currentUid: 'device-a' })
            ).toEqual({ status: 'unavailable', reason: 'wrong_revision' });
        });

        it('reports wrong_uid when the stored uid differs from the current one', () => {
            const s = fresh({ boundaryRevision: 2, uid: 'device-a' });
            expect(
                deriveFreshStatus(s, 1000, { currentRevision: 2, currentUid: 'device-b' })
            ).toEqual({ status: 'unavailable', reason: 'wrong_uid' });
        });

        it('keeps the stored status when both the revision and the uid match', () => {
            const s = fresh({ boundaryRevision: 2, uid: 'device-a' });
            expect(
                deriveFreshStatus(s, 1000, { currentRevision: 2, currentUid: 'device-a' })
            ).toEqual({ status: 'inside', reason: null });
        });

        it('ignores the match when the stored state carries no revision or uid', () => {
            const s = fresh({});
            expect(
                deriveFreshStatus(s, 1000, { currentRevision: 2, currentUid: 'device-a' })
            ).toEqual({ status: 'inside', reason: null });
        });
    });
});
