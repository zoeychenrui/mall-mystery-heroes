const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Subpath import, same reason as submitKillPhoto.js and gameBoundary.js: the
// emulator strips static properties off the top-level admin.firestore binding.
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
// Vendored copies, same reason as submitKillPhoto.js: Cloud Functions deploys
// only functions/ in isolation. Kept in sync by
// functions/scripts/sync-shared-game-logic.js.
const {
    classifyFix,
    nextBoundaryState,
    initialBoundaryState,
    stateAfterBoundaryRevision,
    GAME_BOUNDARY_CONFIG,
    isPositionFresh,
} = require('../vendor/game/gameBoundary');
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const ERROR_REASONS = ['permission_denied', 'unavailable', 'timeout'];

const toMs = (timestamp) => (timestamp ? timestamp.toMillis() : null);
const toTimestamp = (ms) => (ms === null || ms === undefined ? null : Timestamp.fromMillis(ms));

// Rebuilds the state machine's input from a stored status doc. The doc holds
// the same fields as the state, with times as Timestamps.
const stateFromDoc = (data) => ({
    ...initialBoundaryState(),
    status: data.status,
    reason: data.reason ?? null,
    outsideSinceMs: toMs(data.outsideSince),
    lastOutsideSampleMs: toMs(data.lastOutsideSampleAt),
    outsideSampleCount: data.outsideSampleCount ?? 0,
    lastUsableMs: toMs(data.lastUsableReceivedAt),
    lastSampleMs: toMs(data.lastSampleAt),
    outsideConfirmedAt: toMs(data.outsideConfirmedAt),
});

/**
 * Accepts one location report from a player and records their boundary
 * status. lat/lng are written to the status doc on every report (carried
 * forward unchanged on an error report) — see
 * docs/superpowers/specs/2026-10-12-live-location-visibility-design.md for
 * why, and firestore.rules for how read access is controlled instead. A
 * boundaryEvents doc fires only on the confirmation edge: outsideConfirmedAt
 * moving from null to set, or from set to cleared by an inside status.
 *
 * Fix report: { roomId, boundaryRevision, sampleMs, lat, lng, accuracyM }.
 * Error report: { roomId, boundaryRevision, sampleMs, error } with no
 * coordinates. Returns { status, reason } as stored.
 *
 * Identity comes from context.auth.uid, same as submitKillPhoto.js.
 */
exports.reportPlayerLocation = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, boundaryRevision, sampleMs, lat, lng, accuracyM, error } = data || {};
    if (!roomId || typeof boundaryRevision !== 'number' || !Number.isFinite(sampleMs)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId, boundaryRevision and sampleMs are required.'
        );
    }
    const isErrorReport = error !== undefined && error !== null;
    if (isErrorReport && !ERROR_REASONS.includes(error)) {
        throw new functions.https.HttpsError('invalid-argument', 'Unknown location error.');
    }

    const receivedMs = Date.now();
    const { sampleMaxAgeMs, sampleMaxFutureMs, reportRateLimit } = GAME_BOUNDARY_CONFIG;
    const isClockSkewed =
        receivedMs - sampleMs > sampleMaxAgeMs || sampleMs - receivedMs > sampleMaxFutureMs;

    const roomRef = db.collection('rooms').doc(roomId);
    return db.runTransaction(async (transaction) => {
        // --- read phase ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        const room = roomSnapshot.data();
        if (!room.isGameActive) {
            throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
        }

        const playerSnapshot = await transaction.get(
            roomRef.collection('players').where('uid', '==', context.auth.uid)
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'You are not a player of this room.');
        }
        // Same rule as submitKillPhoto.js: one uid with two player docs is
        // ambiguous, so fail loudly rather than attribute the report to one.
        if (playerSnapshot.size > 1) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Multiple player identities are linked to your account in this room — ask your GM for help.'
            );
        }
        const playerDoc = playerSnapshot.docs[0];
        const playerData = playerDoc.data();

        if (playerData.isAlive === false) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Eliminated players cannot report their location.'
            );
        }

        const boundary = room.gameBoundary;
        if (!boundary || boundary.enabled !== true) {
            throw new functions.https.HttpsError('failed-precondition', 'Game area is not active.');
        }
        if (boundaryRevision !== boundary.revision) {
            throw new functions.https.HttpsError('failed-precondition', 'revision_conflict');
        }

        const rateLimits = playerData.rateLimits || {};
        const currentWindow = rateLimits.boundaryReport
            ? {
                  windowStartMs: rateLimits.boundaryReport.windowStart.toMillis(),
                  count: rateLimits.boundaryReport.count,
              }
            : null;
        const nextWindow = nextRateLimitWindow(currentWindow, receivedMs, reportRateLimit);
        if (!nextWindow) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many location reports — slow down and try again in a moment.'
            );
        }

        const statusRef = roomRef.collection('boundaryStatuses').doc(playerDoc.id);
        const statusSnapshot = await transaction.get(statusRef);
        const storedData = statusSnapshot.exists ? statusSnapshot.data() : null;
        // Read the stored run whole. A revision change does not discard it
        // here — stateAfterBoundaryRevision decides that once this report
        // has been classified against the new ring. lastSampleMs is what
        // the out-of-order check below compares, and it is meaningful
        // either way.
        const stored = storedData === null ? initialBoundaryState() : stateFromDoc(storedData);
        const revisionChanged =
            storedData !== null && storedData.boundaryRevision !== boundary.revision;
        // A revision change does not reset these. A player's last known
        // position is still their last known position; only the boundary
        // math changes. Exposure state is decided separately, once this
        // report is classified against the new ring.
        const prevLat = storedData === null ? null : (storedData.lat ?? null);
        const prevLng = storedData === null ? null : (storedData.lng ?? null);

        // --- decide phase ---

        // A clock-skewed sample can't be ordered against lastSampleMs (the
        // device clock produced it, not the server), so it is accepted —
        // the rate limit above already counted it — but written as
        // unavailable/clock_skew without touching lastSampleAt or evaluating
        // the fix, and compared against nothing for ordering.
        if (isClockSkewed) {
            transaction.update(playerDoc.ref, {
                rateLimits: {
                    ...rateLimits,
                    boundaryReport: {
                        windowStart: Timestamp.fromMillis(nextWindow.windowStartMs),
                        count: nextWindow.count,
                    },
                },
            });
            transaction.set(
                statusRef,
                {
                    status: 'unavailable',
                    reason: 'clock_skew',
                    lat: prevLat,
                    lng: prevLng,
                    boundaryRevision,
                    lastSampleAt: toTimestamp(stored.lastSampleMs),
                },
                { merge: true }
            );
            return { status: 'unavailable', reason: 'clock_skew' };
        }

        // Applies to every report, error reports included, so a late error
        // cannot overwrite a newer sample's status.
        if (stored.lastSampleMs !== null && sampleMs <= stored.lastSampleMs) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Location sample is out of order.'
            );
        }

        let next;
        let accuracyMeters = null;
        let nextLat = prevLat;
        let nextLng = prevLng;
        // An error report is an unusable fix: same transition, reason is the error code.
        // A revision change keeps an already-exposed player's clock only when
        // this fix is still outside the new ring; every other classification
        // starts clean. Same revision: the stored run is the previous state.
        const classification = isErrorReport
            ? { kind: 'unusable', reason: error }
            : classifyFix(boundary.vertices, { lat, lng, accuracyM });
        const prev = revisionChanged ? stateAfterBoundaryRevision(stored, classification) : stored;
        next = nextBoundaryState(prev, classification, { sampleMs, receivedMs });
        if (!isErrorReport) {
            if (Number.isFinite(accuracyM)) {
                accuracyMeters = accuracyM;
            }
            nextLat = lat;
            nextLng = lng;
        }

        // --- write phase ---

        const statusChanged = next.status !== prev.status || !statusSnapshot.exists;
        const statusChangedAt = statusChanged
            ? FieldValue.serverTimestamp()
            : statusSnapshot.data().statusChangedAt;

        transaction.update(playerDoc.ref, {
            rateLimits: {
                ...rateLimits,
                boundaryReport: {
                    windowStart: Timestamp.fromMillis(nextWindow.windowStartMs),
                    count: nextWindow.count,
                },
            },
        });

        transaction.set(statusRef, {
            status: next.status,
            reason: next.reason,
            lat: nextLat,
            lng: nextLng,
            boundaryRevision,
            uid: context.auth.uid,
            accuracyMeters,
            lastSampleAt: Timestamp.fromMillis(sampleMs),
            receivedAt: FieldValue.serverTimestamp(),
            lastUsableReceivedAt: toTimestamp(next.lastUsableMs),
            outsideSince: toTimestamp(next.outsideSinceMs),
            lastOutsideSampleAt: toTimestamp(next.lastOutsideSampleMs),
            outsideSampleCount: next.outsideSampleCount,
            outsideConfirmedAt: toTimestamp(next.outsideConfirmedAt),
            statusChangedAt,
        });

        // Events fire on the confirmation edge, not on status: an error report
        // keeps a confirmed outside (ruling g), so a later outside fix must not
        // write a second 'outside' event for the same episode.
        if (prev.outsideConfirmedAt === null && next.outsideConfirmedAt !== null) {
            transaction.create(roomRef.collection('boundaryEvents').doc(), {
                type: 'outside',
                playerId: playerDoc.id,
                playerName: playerData.name,
                boundaryRevision,
                timestamp: FieldValue.serverTimestamp(),
            });
            // Announce the same confirmation edge in room chat. Keeping the
            // message in this transaction makes the announcement exactly
            // once per outside episode, alongside the boundary event. The
            // position snapshot gives everyone a View on map action even if
            // the player moves back inside before they open the message.
            transaction.create(roomRef.collection('playerMessages').doc(), {
                type: 'powerUpPing',
                source: 'boundaryExposure',
                recipient: null,
                text: `📍 ${playerData.name} is outside the game area and their location is now visible to everyone.`,
                pingedPlayer: playerData.name,
                pings: [
                    {
                        name: playerData.name,
                        lat: nextLat,
                        lng: nextLng,
                        accuracyMeters,
                        capturedAtMs: next.lastUsableMs,
                        isStale: !isPositionFresh(next.lastUsableMs, receivedMs),
                    },
                ],
                timestamp: FieldValue.serverTimestamp(),
            });
        }
        // Exposure ends on a clear inside fix or on a near-edge fix (returning
        // toward the area). Both clear outsideConfirmedAt.
        if (prev.outsideConfirmedAt !== null && next.outsideConfirmedAt === null) {
            transaction.create(roomRef.collection('boundaryEvents').doc(), {
                type: 'returnedInside',
                playerId: playerDoc.id,
                playerName: playerData.name,
                boundaryRevision,
                timestamp: FieldValue.serverTimestamp(),
            });
        }

        return { status: next.status, reason: next.reason };
    });
});
