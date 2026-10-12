const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue — see
// joinRoom.js's identical comment for why (the Functions emulator strips
// static properties off the top-level admin.firestore binding).
const { FieldValue } = require('firebase-admin/firestore');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The one shared reversal step both mission-undo entry points call — given
 * a reversalSnapshot (the exact shape completeMission.js returns), writes
 * every player entry back verbatim and removes the completion from the
 * task, inside the caller's own transaction. Mirrors undoKillPlayer.js's
 * replay logic exactly, plus the task-level (completedBy/isComplete)
 * reversal a kill has no equivalent of
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 */
const applyReversal = async (transaction, roomRef, reversalSnapshot) => {
    const playersRef = roomRef.collection('players');
    const tasksRef = roomRef.collection('tasks');

    const playerEntries = Object.entries(reversalSnapshot.players);
    const playerRefsByKey = new Map();
    for (const [key] of playerEntries) {
        const playerSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', key)
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Cannot undo: a player from this mission completion (${key}) no longer exists.`
            );
        }
        playerRefsByKey.set(key, playerSnapshot.docs[0].ref);
    }

    const taskSnapshot = await transaction.get(
        tasksRef.where('taskIndex', '==', reversalSnapshot.missionIndex)
    );
    if (taskSnapshot.empty) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `Cannot undo: mission ${reversalSnapshot.missionIndex} no longer exists.`
        );
    }
    const taskRef = taskSnapshot.docs[0].ref;

    for (const [key, snapshot] of playerEntries) {
        transaction.update(playerRefsByKey.get(key), {
            score: snapshot.score,
            targets: snapshot.targets,
            assassins: snapshot.assassins,
            isAlive: snapshot.isAlive,
            openSeason: snapshot.openSeason,
        });
    }

    const taskUpdates = { completedBy: FieldValue.arrayRemove(reversalSnapshot.playerName) };
    if (reversalSnapshot.wasAutoEnded) {
        taskUpdates.isComplete = false;
    }
    transaction.update(taskRef, taskUpdates);
};

const requireHost = async (transaction, roomRef, roomId, uid) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
    }
    if (roomSnapshot.data().hostId !== uid) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Only the room host can undo a mission completion.'
        );
    }
    return roomSnapshot;
};

/**
 * Undoes a mission completion approved from a photo — the photo-anchored
 * undo stack, extending PhotosDisplay.js's existing Undo button the same
 * way undoKillPlayer.js already does for kills.
 */
exports.undoMissionPhotoApproval = functions.https.onCall(async (data, context) => {
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
        const photoRef = roomRef.collection('photos').doc(photoId);

        await requireHost(transaction, roomRef, roomId, context.auth.uid);

        const photoSnapshot = await transaction.get(photoRef);
        if (!photoSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Photo not found: ${photoId}`);
        }
        const photoData = photoSnapshot.data();
        if (photoData.status !== 'approved' || photoData.mission == null) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Photo is not an approved mission completion (status: ${photoData.status}); nothing to undo.`
            );
        }
        if (!photoData.missionUndoSnapshot) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This mission completion predates undo support and cannot be reverted.'
            );
        }

        await applyReversal(transaction, roomRef, photoData.missionUndoSnapshot);

        transaction.update(photoRef, {
            status: 'pending',
            mission: null,
            missionUndoSnapshot: null,
        });
    });
});

/**
 * Undoes the most recent mission completion made via /mission done — the
 * room-anchored undo stack, independent from the photo-approval one
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md's "two
 * separate stacks" decision).
 */
exports.undoMissionCommand = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId } = data;
    if (!roomId) {
        throw new functions.https.HttpsError('invalid-argument', 'roomId is required.');
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);

        const roomSnapshot = await requireHost(transaction, roomRef, roomId, context.auth.uid);
        const reversalSnapshot = roomSnapshot.data().lastMissionCommandCompletion;
        if (!reversalSnapshot) {
            throw new functions.https.HttpsError('failed-precondition', 'Nothing to undo.');
        }

        await applyReversal(transaction, roomRef, reversalSnapshot);

        transaction.update(roomRef, { lastMissionCommandCompletion: null });
    });
});
