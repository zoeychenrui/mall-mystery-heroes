const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue —
// see joinRoom.js's/removePlayer.js's identical comment for why (the
// Functions emulator strips static properties off the top-level
// admin.firestore binding).
const { FieldValue } = require('firebase-admin/firestore');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Creates a pending reconnect request for a player who already exists in
 * this room but whose current uid isn't the one that joined — mirrors
 * submitKillPhoto.js's "create a pending item for GM judgment" shape
 * (read-then-create inside one transaction), not the plain read+write
 * originally sketched in docs/superpowers/specs/
 * 2026-08-30-player-reconnect-design.md — every other "create a pending
 * item" Cloud Function in this codebase already transacts this, so this
 * does too, for consistency.
 *
 * No host check — callable by anyone signed in, since this is exactly
 * the case where the caller has just lost whatever identity they had
 * before and cannot prove anything about themselves yet.
 * joinRoom.js is what already rejected this join attempt (gameStarted is
 * true); this function doesn't trust that and re-checks independently.
 */
exports.requestReconnect = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, playerName } = data;
    if (!roomId || !playerName) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and playerName are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (!roomSnapshot.data().gameStarted) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This room has not started a game yet — just join normally.'
            );
        }
        if (roomSnapshot.data().isGameActive === false || roomSnapshot.data().endedAt) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This room is no longer active.'
            );
        }
        // Mirrors joinRoom.js's identical joinedUids check (docs/improvements.md
        // item 66) — without it, an already-joined device (or the host,
        // mis-tapping "Join Game") submitting the join form under someone
        // else's name after the game has started falls straight through
        // joinRoom.js's own "already started" rejection into this reconnect
        // fallback, and approveReconnectRequest would otherwise be willing to
        // link this uid onto a second player doc.
        if ((roomSnapshot.data().joinedUids || []).includes(context.auth.uid)) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This device is already signed in as a player in this room.'
            );
        }

        const trimmedLowercaseName = normalizePlayerName(playerName);
        const playerSnapshot = await transaction.get(playersRef.doc(trimmedLowercaseName));
        if (!playerSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                `No player named ${playerName} in this room.`
            );
        }

        // Blocks the common accidental case (a flaky network causing a
        // retry, a double-tapped button, re-submitting the join form) —
        // not a defense against a determined multi-identity flood, which
        // this game's small, in-person, GM-supervised setting doesn't
        // need to defend against. A single `where` clause plus an
        // in-memory filter, not a compound query, so this needs no
        // composite index.
        const existingRequestsSnapshot = await transaction.get(
            roomRef
                .collection('reconnectRequests')
                .where('trimmedNameLowerCase', '==', trimmedLowercaseName)
        );
        const hasPendingRequestFromThisDevice = existingRequestsSnapshot.docs.some(
            (doc) => doc.data().requestingUid === context.auth.uid && doc.data().status === 'pending'
        );
        if (hasPendingRequestFromThisDevice) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'You already have a pending reconnect request for this player — wait for the host to respond.'
            );
        }

        const requestRef = roomRef.collection('reconnectRequests').doc();
        transaction.create(requestRef, {
            playerName: playerSnapshot.data().name,
            trimmedNameLowerCase: trimmedLowercaseName,
            requestingUid: context.auth.uid,
            status: 'pending',
            timestamp: FieldValue.serverTimestamp(),
        });

        return { requestId: requestRef.id };
    });
});

/**
 * Re-links an existing player document to a new uid and marks the
 * request approved — one transaction, so the player's uid, the room's
 * joinedUids, and the request's status all land together or not at all.
 * Host-only, mirrors killPlayer.js's/removePlayer.js's host check
 * exactly.
 */
exports.approveReconnectRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, requestId } = data;
    if (!roomId || !requestId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and requestId are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can approve a reconnect request.'
            );
        }

        const requestRef = roomRef.collection('reconnectRequests').doc(requestId);
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                `Reconnect request not found: ${requestId}`
            );
        }
        const requestData = requestSnapshot.data();
        if (requestData.status !== 'pending') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `This request has already been ${requestData.status}.`
            );
        }

        const playerRef = roomRef.collection('players').doc(requestData.trimmedNameLowerCase);
        const playerSnapshot = await transaction.get(playerRef);
        if (!playerSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                'The player this request was for no longer exists.'
            );
        }

        // Belt-and-braces version of requestReconnect's own joinedUids check:
        // a request can sit pending while its requester joins this room by
        // some other route in the meantime, so re-check right before writing
        // rather than trusting that nothing changed since the request was
        // created (docs/improvements.md item 66). Mirrors removePlayer.js's
        // precedent for running a `.where(...)` query inside a transaction.
        // Excludes the target player doc itself — re-linking a request to
        // the SAME player it already targets (e.g. re-approving) must not be
        // blocked by this guard.
        const playersAlreadyLinkedToThisUidSnapshot = await transaction.get(
            roomRef.collection('players').where('uid', '==', requestData.requestingUid)
        );
        const linkedToADifferentPlayer = playersAlreadyLinkedToThisUidSnapshot.docs.some(
            (doc) => doc.id !== playerRef.id
        );
        if (linkedToADifferentPlayer) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This device is already linked to a different player in this room.'
            );
        }

        transaction.update(playerRef, { uid: requestData.requestingUid });
        transaction.delete(roomRef.collection('boundaryStatuses').doc(playerRef.id));
        transaction.update(roomRef, {
            joinedUids: FieldValue.arrayUnion(requestData.requestingUid),
        });
        transaction.update(requestRef, { status: 'approved' });
    });
});

/**
 * Marks a reconnect request denied. Host-only, same host check as
 * approveReconnectRequest. Touches no player data — mirrors how denying
 * a kill photo never touches player data either.
 */
exports.denyReconnectRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, requestId } = data;
    if (!roomId || !requestId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and requestId are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can deny a reconnect request.'
            );
        }

        const requestRef = roomRef.collection('reconnectRequests').doc(requestId);
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                `Reconnect request not found: ${requestId}`
            );
        }
        if (requestSnapshot.data().status !== 'pending') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `This request has already been ${requestSnapshot.data().status}.`
            );
        }

        transaction.update(requestRef, { status: 'denied' });
    });
});
