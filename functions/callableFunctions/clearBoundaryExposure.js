const { FieldValue } = require('firebase-admin/firestore');

/**
 * The field set every "clear this exposure" write uses, regardless of
 * whether it's clearing one document (killPlayer.js, a single elimination)
 * or a whole room's worth (clearExposureForRoom, below). Pulled out as its
 * own function so there is exactly one place that lists these 10 fields —
 * two independent object literals with the same fields is exactly the kind
 * of thing where a future field gets added to one write path and silently
 * missed in the other.
 *
 * @param {string} reason written as the cleared reason, e.g.
 *   'boundary_disabled', 'game_ended', or 'eliminated'
 */
const buildClearedExposureFields = (reason) => ({
    status: 'unavailable',
    reason,
    lat: null,
    lng: null,
    accuracyMeters: null,
    outsideSince: null,
    lastOutsideSampleAt: null,
    outsideSampleCount: 0,
    outsideConfirmedAt: null,
    statusChangedAt: FieldValue.serverTimestamp(),
});

/**
 * Clears every currently-exposed (or being-confirmed) status in a room,
 * inside the caller's own open transaction — used when there is no
 * meaningful boundary to be outside of anymore (it was just disabled) or
 * no one will report again (the game just ended). Does NOT delete the
 * documents — a player's own next report (if any) should still be able to
 * read a clean slate back, the same shape reportPlayerLocation.js's own
 * stateFromDoc already expects for a player with no outside history.
 *
 * A player with no boundaryStatuses document at all, or one that's
 * already fully inside/unavailable, is left alone — this only touches
 * documents that are actually exposed or approaching exposure.
 *
 * @param {FirebaseFirestore.Transaction} transaction already open; this
 *   function only reads/writes through it, never commits
 * @param {FirebaseFirestore.DocumentReference} roomRef
 * @param {string} reason written as the cleared reason, e.g.
 *   'boundary_disabled' or 'game_ended'
 */
const clearExposureForRoom = async (transaction, roomRef, reason) => {
    const statusesSnapshot = await transaction.get(roomRef.collection('boundaryStatuses'));
    statusesSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'outside' && data.status !== 'near') return;
        transaction.update(doc.ref, buildClearedExposureFields(reason));
    });
};

module.exports = { clearExposureForRoom, buildClearedExposureFields };
