const {
    emptyDraft,
    draftFromPublished,
    draftFromFreehand,
    draftFromParameters,
    isDraftPublishable,
} = require('./boundaryDraft');

const RECTANGLE_CORNERS = [
    { lat: 40, lng: -74 },
    { lat: 40.01, lng: -73.99 },
];

describe('emptyDraft', () => {
    it('has no shape and is not publishable', () => {
        const draft = emptyDraft();
        expect(draft.shapeType).toBeNull();
        expect(draft.vertices).toBeNull();
        expect(draft.validation).toEqual({ ok: false, reason: 'Draw a shape to begin.' });
        expect(isDraftPublishable(draft)).toBe(false);
    });
});

describe('draftFromPublished', () => {
    it('returns an empty draft when there is nothing published', () => {
        expect(draftFromPublished(null)).toEqual(emptyDraft());
        expect(draftFromPublished(undefined)).toEqual(emptyDraft());
    });

    it('carries over the exact shapeType and shapeParameters of a published boundary', () => {
        const published = {
            shapeType: 'circle',
            shapeParameters: { center: { lat: 40, lng: -74 }, radiusMeters: 500 },
            vertices: [{ lat: 40.001, lng: -74 }],
        };
        const draft = draftFromPublished(published);
        expect(draft.shapeType).toBe('circle');
        expect(draft.shapeParameters).toEqual(published.shapeParameters);
        expect(draft.vertices).toBe(published.vertices);
        expect(isDraftPublishable(draft)).toBe(true);
    });
});

describe('draftFromFreehand', () => {
    it('is not publishable for an empty stroke', () => {
        const draft = draftFromFreehand([]);
        expect(draft.vertices).toBeNull();
        expect(isDraftPublishable(draft)).toBe(false);
    });

    it('closes an open stroke into a ring', () => {
        const open = [
            { lat: 40, lng: -74 },
            { lat: 40.001, lng: -74 },
            { lat: 40.001, lng: -73.999 },
            { lat: 40, lng: -73.999 },
        ];
        const draft = draftFromFreehand(open);
        expect(draft.shapeType).toBe('freehand');
        expect(draft.shapeParameters).toBeNull();
        expect(draft.vertices).toHaveLength(5);
        expect(draft.vertices[4]).toEqual(open[0]);
        expect(isDraftPublishable(draft)).toBe(true);
    });

    it('does not double-close an already-closed stroke', () => {
        const closed = [
            { lat: 40, lng: -74 },
            { lat: 40.001, lng: -74 },
            { lat: 40.001, lng: -73.999 },
            { lat: 40, lng: -74 },
        ];
        const draft = draftFromFreehand(closed);
        expect(draft.vertices).toHaveLength(4);
    });

    it('still returns the drawn vertices even when they are invalid, so the UI can show what is wrong', () => {
        // Three distinct points plus closure — below the 4-distinct-corner
        // minimum validateBoundaryShape enforces.
        const tooFew = [
            { lat: 40, lng: -74 },
            { lat: 40.001, lng: -74 },
            { lat: 40, lng: -74 },
        ];
        const draft = draftFromFreehand(tooFew);
        expect(draft.vertices).not.toBeNull();
        expect(isDraftPublishable(draft)).toBe(false);
    });
});

describe('draftFromParameters', () => {
    it('derives vertices and validation for a valid rectangle', () => {
        const draft = draftFromParameters('rectangle', { corners: RECTANGLE_CORNERS });
        expect(draft.shapeType).toBe('rectangle');
        expect(draft.shapeParameters).toEqual({ corners: RECTANGLE_CORNERS });
        expect(draft.vertices.length).toBeGreaterThan(0);
        expect(isDraftPublishable(draft)).toBe(true);
    });

    it('derives vertices and validation for a valid circle', () => {
        const draft = draftFromParameters('circle', {
            center: { lat: 40, lng: -74 },
            radiusMeters: 200,
        });
        expect(isDraftPublishable(draft)).toBe(true);
    });

    it('is not publishable, with no thrown error, for a shape mid-gesture (e.g. zero radius)', () => {
        const draft = draftFromParameters('circle', {
            center: { lat: 40, lng: -74 },
            radiusMeters: 0,
        });
        expect(draft.vertices).toBeNull();
        expect(isDraftPublishable(draft)).toBe(false);
    });

    it("surfaces the geometry validator's own reason for a degenerate shape", () => {
        const draft = draftFromParameters('rectangle', {
            corners: [
                { lat: 40, lng: -74 },
                { lat: 40, lng: -74 },
            ],
        });
        expect(draft.validation.ok).toBe(false);
        expect(typeof draft.validation.reason).toBe('string');
        expect(draft.validation.reason.length).toBeGreaterThan(0);
    });
});
