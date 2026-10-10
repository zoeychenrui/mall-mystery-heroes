/**
 * Pure helper that turns a drawing gesture's raw geometry into a
 * publishable draft: the canonical polygon plus validation, reusing the
 * shape math gameBoundary.js already has. No Firebase, no React, no map
 * library — BoundaryEditorModal.js owns *how* a shape got drawn (one
 * shared drag gesture per tool); this module only knows the shapeType
 * and shapeParameters that come out of that.
 *
 * `vertices` is populated whenever geometry could be computed at all,
 * even when `validation.ok` is false, so the editor can still show the
 * moderator the invalid shape they drew instead of nothing.
 */
const { shapeToPolygon, validateBoundaryShape } = require('./gameBoundary');

const NO_SHAPE_REASON = 'Draw a shape to begin.';

const emptyDraft = () => ({
    shapeType: null,
    shapeParameters: null,
    vertices: null,
    validation: { ok: false, reason: NO_SHAPE_REASON },
});

/**
 * @param {{shapeType: string, vertices: Array<{lat:number,lng:number}>, shapeParameters: object|null}|null|undefined} published
 */
const draftFromPublished = (published) => {
    if (!published) return emptyDraft();
    return {
        shapeType: published.shapeType,
        shapeParameters: published.shapeParameters ?? null,
        vertices: published.vertices,
        validation: { ok: true },
    };
};

/**
 * Freehand carries no reopenable shapeParameters — the vertices
 * themselves are the only record (publishGameBoundary requires
 * shapeParameters to be null for a freehand shape).
 *
 * @param {Array<{lat:number,lng:number}>} points raw stroke points, open or closed
 */
const draftFromFreehand = (points) => {
    if (!Array.isArray(points) || points.length === 0) {
        return {
            shapeType: 'freehand',
            shapeParameters: null,
            vertices: null,
            validation: { ok: false, reason: NO_SHAPE_REASON },
        };
    }
    const first = points[0];
    const last = points[points.length - 1];
    const closed =
        first.lat === last.lat && first.lng === last.lng ? points : [...points, { ...first }];
    return {
        shapeType: 'freehand',
        shapeParameters: null,
        vertices: closed,
        validation: validateBoundaryShape('freehand', closed),
    };
};

/**
 * Rectangle/circle/oval: shapeParameters describes the shape, vertices
 * are derived via shapeToPolygon. A gesture still in progress (e.g. a
 * circle with radiusMeters 0 right after the first click) throws out of
 * shapeToPolygon — that is "nothing to show yet," not a validation
 * error, so it is caught here rather than surfaced as one.
 *
 * @param {'rectangle'|'circle'|'oval'} shapeType
 * @param {object} shapeParameters
 */
const draftFromParameters = (shapeType, shapeParameters) => {
    let vertices = null;
    let validation = { ok: false, reason: NO_SHAPE_REASON };
    try {
        vertices = shapeToPolygon(shapeType, shapeParameters);
        validation = validateBoundaryShape(shapeType, vertices);
    } catch {
        // Mid-gesture; leave vertices null and validation as the default.
    }
    return { shapeType, shapeParameters, vertices, validation };
};

const isDraftPublishable = (draft) => Boolean(draft && draft.validation && draft.validation.ok);

module.exports = {
    emptyDraft,
    draftFromPublished,
    draftFromFreehand,
    draftFromParameters,
    isDraftPublishable,
};
