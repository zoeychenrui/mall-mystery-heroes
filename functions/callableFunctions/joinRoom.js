const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue: the
// Functions emulator wraps the top-level admin.firestore property in a
// Function.prototype.bind() (see firebase-tools'
// functionsEmulatorRuntime.js Proxied.getOriginal), and a bound function
// carries none of the original's static properties — admin.firestore.FieldValue
// is undefined under `npm run test:emulator` even though it resolves fine
// outside the emulator. This subpath import isn't proxied the same way.
const { FieldValue } = require('firebase-admin/firestore');
// Vendored copy, not '../../src/game/...' — see killPlayer.js's comment on
// the same import for why (Cloud Functions deploy uploads functions/ in
// isolation; kept in sync by functions/scripts/sync-shared-game-logic.js).
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Lets a player join a room from their own device, callable by anyone
 * signed in (Google or anonymous/guest), not just the room's host
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely —
 * unlike killPlayer, there is deliberately no host-only check: any
 * signed-in caller may join any room still in its Lobby phase.
 */
exports.joinRoom = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, playerName } = data;
    if (
        typeof roomId !== 'string' ||
        typeof playerName !== 'string' ||
        !roomId.trim() ||
        !playerName.trim()
    ) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and playerName are both required.'
        );
    }
    if (roomId.includes('/')) {
        throw new functions.https.HttpsError('invalid-argument', 'roomId must not contain "/".');
    }

    const trimmedLowercaseName = normalizePlayerName(playerName);
    if (!trimmedLowercaseName) {
        throw new functions.https.HttpsError('invalid-argument', 'playerName must not be blank.');
    }

    const roomRef = db.collection('rooms').doc(roomId);
    const playerRef = roomRef.collection('players').doc(trimmedLowercaseName);

    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().gameStarted) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This game has already started.'
            );
        }
        if (roomSnapshot.data().isGameActive === false || roomSnapshot.data().endedAt) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This room is no longer active.'
            );
        }

        // Checked before the name-taken check below: a stale
        // localStorage session, a shared link tapped again, or plain
        // curiosity could otherwise let one uid end up owning two player
        // docs in this room, which several things quietly assume can't
        // happen (docs/improvements.md item 66). joinedUids is already
        // maintained purely for this check — reading it first avoids the
        // extra player-lookup query below in the common, non-duplicate
        // case.
        if ((roomSnapshot.data().joinedUids || []).includes(context.auth.uid)) {
            const playerCollectionRef = roomRef.collection('players');
            const existingPlayerQuery = playerCollectionRef.where('uid', '==', context.auth.uid);
            const existingPlayerSnapshot = await transaction.get(existingPlayerQuery);
            const existingName = existingPlayerSnapshot.empty
                ? 'another name'
                : existingPlayerSnapshot.docs[0].data().name;
            throw new functions.https.HttpsError(
                'already-exists',
                `You have already joined this room as ${existingName}.`
            );
        }

        const existing = await transaction.get(playerRef);
        if (existing.exists) {
            throw new functions.https.HttpsError(
                'already-exists',
                `${playerName} is already taken in this room.`
            );
        }

        transaction.set(playerRef, {
            name: playerName,
            trimmedNameLowerCase: trimmedLowercaseName,
            uid: context.auth.uid,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
        transaction.update(roomRef, {
            joinedUids: FieldValue.arrayUnion(context.auth.uid),
        });
    });
});
