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
