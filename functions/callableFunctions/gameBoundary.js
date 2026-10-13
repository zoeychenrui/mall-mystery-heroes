const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Subpath import, same reason as submitKillPhoto.js: the emulator strips
// static properties off the top-level admin.firestore binding.
const { FieldValue } = require('firebase-admin/firestore');
const {
    shapeToPolygon,
    validateBoundaryShape,
    projectToMeters,
} = require('../vendor/game/gameBoundary');
const { clearExposureForRoom } = require('./clearBoundaryExposure');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// How far a vertex may sit from the point shapeToPolygon derives from the
// shape parameters, in meters. Absorbs client-side float rounding only.
const SHAPE_MATCH_TOLERANCE_M = 1;

/**
 * Checks that the client-supplied vertices are the polygon the shape
 * parameters describe, so the stored boundary cannot disagree with the
 * parameters it claims to come from. Freehand shapes carry no parameters.
 */
const assertShapeParametersMatch = (shapeType, shapeParameters, vertices) => {
    if (shapeType === 'freehand') {
        if (shapeParameters != null) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Freehand boundaries take no shape parameters.'
            );
        }
        return;
    }
    let polygon;
    try {
        polygon = shapeToPolygon(shapeType, shapeParameters);
    } catch (error) {
        throw new functions.https.HttpsError('invalid-argument', error.message);
    }
    const mismatch = () =>
        new functions.https.HttpsError(
            'invalid-argument',
            'Shape parameters do not match the vertices.'
        );
    if (polygon.length !== vertices.length) {
        throw mismatch();
    }
    const origin = vertices[0];
    for (let i = 0; i < polygon.length; i++) {
        const expected = projectToMeters(polygon[i], origin);
        const actual = projectToMeters(vertices[i], origin);
        const distance = Math.hypot(expected.x - actual.x, expected.y - actual.y);
        if (distance > SHAPE_MATCH_TOLERANCE_M) {
            throw mismatch();
        }
    }
};

const readRoomForHost = (snapshot, uid) => {
    if (!snapshot.exists) {
        throw new functions.https.HttpsError('not-found', 'Room not found.');
    }
    if (snapshot.data().hostId !== uid) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Only the room host can change the game area.'
        );
    }
    if (!snapshot.data().isGameActive) {
        throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
    }
    return snapshot.data();
};

const currentRevision = (room) => (room.gameBoundary && room.gameBoundary.revision) || 0;

exports.publishGameBoundary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }
    const { roomId, expectedRevision, shapeType, vertices, shapeParameters } = data || {};
    if (!roomId || typeof expectedRevision !== 'number') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and expectedRevision are required.'
        );
    }
    const shape = validateBoundaryShape(shapeType, vertices);
    if (!shape.ok) {
        throw new functions.https.HttpsError('invalid-argument', shape.reason);
    }
    assertShapeParametersMatch(shapeType, shapeParameters, vertices);

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
                vertices: vertices.map(({ lat, lng }) => ({ lat, lng })),
                shapeParameters: shapeParameters ?? null,
                updatedAt: FieldValue.serverTimestamp(),
            },
        });
        return { revision: nextRevision };
    });
});

exports.disableGameBoundary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }
    const { roomId, expectedRevision } = data || {};
    if (!roomId || typeof expectedRevision !== 'number') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and expectedRevision are required.'
        );
    }

    const roomRef = db.collection('rooms').doc(roomId);
    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        const room = readRoomForHost(roomSnapshot, context.auth.uid);
        if (!room.gameBoundary) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'There is no game area to disable.'
            );
        }
        const revision = currentRevision(room);
        if (expectedRevision !== revision) {
            throw new functions.https.HttpsError('failed-precondition', 'revision_conflict');
        }
        const nextRevision = revision + 1;
        // Must run before the transaction.update below: this function's own
        // internal transaction.get (reading boundaryStatuses) has to happen
        // before any write on this transaction, including the room update
        // that follows — Firestore transactions require all reads before
        // any writes.
        await clearExposureForRoom(transaction, roomRef, 'boundary_disabled');
        transaction.update(roomRef, {
            'gameBoundary.enabled': false,
            'gameBoundary.revision': nextRevision,
            'gameBoundary.updatedAt': FieldValue.serverTimestamp(),
        });
        return { revision: nextRevision };
    });
});
