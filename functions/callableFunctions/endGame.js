const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Subpath import, same reason as gameBoundary.js and reportPlayerLocation.js:
// the emulator strips static properties off the top-level admin.firestore
// binding.
const { FieldValue } = require('firebase-admin/firestore');
const { clearExposureForRoom } = require('./clearBoundaryExposure');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The atomic replacement for the old client-side `endGame` (formerly a
 * plain updateDoc in dbCalls.js): marks the room's game as over AND clears
 * every player's exposed boundary status in the same transaction, since
 * boundaryStatuses can only ever be written under the Admin SDK — there
 * was no way for the old client-only write to do this at all.
 */
exports.endGame = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }
    const { roomId } = data || {};
    if (!roomId) {
        throw new functions.https.HttpsError('invalid-argument', 'roomId is required.');
    }

    const roomRef = db.collection('rooms').doc(roomId);
    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', 'Room not found.');
        }
        const room = roomSnapshot.data();
        if (room.hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can end the game.'
            );
        }
        if (!room.isGameActive) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This game has already ended.'
            );
        }

        // Must run before the transaction.update below: this function's own
        // internal transaction.get (reading boundaryStatuses) has to happen
        // before any write on this transaction, including the room update
        // that follows — Firestore transactions require all reads before
        // any writes.
        await clearExposureForRoom(transaction, roomRef, 'game_ended');

        transaction.update(roomRef, {
            isGameActive: false,
            endedAt: FieldValue.serverTimestamp(),
        });
    });
});
