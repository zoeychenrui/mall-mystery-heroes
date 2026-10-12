const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Reverses everything killPlayer.js did for one approved kill — not just
 * the target, but every player its transaction touched (the killer, any
 * co-assassins, and anyone the remap reassigned) — in one Firestore
 * transaction, mirroring killPlayer.js's own atomicity
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here.
 */
exports.undoKillPlayer = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, photoId } = data;
    if (!roomId || !photoId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and photoId are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');
        const photoRef = roomRef.collection('photos').doc(photoId);

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can undo a kill.'
            );
        }

        const photoSnapshot = await transaction.get(photoRef);
        if (!photoSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Photo not found: ${photoId}`);
        }
        const photoData = photoSnapshot.data();
        if (photoData.status !== 'approved') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Photo is not approved (status: ${photoData.status}); nothing to undo.`
            );
        }

        const snapshotEntries = Object.entries(photoData.originalPlayerData || {});
        const playerRefsByKey = new Map();
        for (const [key] of snapshotEntries) {
            const playerSnapshot = await transaction.get(
                playersRef.where('trimmedNameLowerCase', '==', key)
            );
            if (playerSnapshot.empty) {
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    `Cannot undo: a player from this kill (${key}) no longer exists.`
                );
            }
            playerRefsByKey.set(key, playerSnapshot.docs[0].ref);
        }

        for (const [key, snapshot] of snapshotEntries) {
            transaction.update(playerRefsByKey.get(key), {
                score: snapshot.score,
                targets: snapshot.targets,
                assassins: snapshot.assassins,
                isAlive: snapshot.isAlive,
                openSeason: snapshot.openSeason,
            });
        }

        transaction.update(photoRef, { status: 'pending' });
    });
});
