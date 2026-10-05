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
