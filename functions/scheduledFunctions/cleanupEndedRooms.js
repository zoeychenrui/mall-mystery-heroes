const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { selectExpiredRooms } = require('./selectExpiredRooms');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// 24 hours — enough time to review standings, kill photos, and flag any
// last-minute mistake before a room's data disappears
// (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
let RETENTION_DAYS = 1;

// Test-only seam — the alternative (injecting retentionDays as a
// parameter to cleanupEndedRooms) would change this function's signature
// away from what functions.pubsub.schedule(...).onRun(handler) expects
// (no arguments), so the emulator test flips this module-level value
// directly instead.
const setRetentionDaysForTesting = (days) => {
    RETENTION_DAYS = days;
};

const cleanupEndedRooms = functions.pubsub.schedule('every 24 hours').onRun(async () => {
    if (RETENTION_DAYS === null) return null;

    const now = new Date();
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const roomsSnapshot = await db.collection('rooms').where('endedAt', '<=', cutoff).get();
    const rooms = roomsSnapshot.docs.map((doc) => ({
        id: doc.id,
        endedAt: doc.data().endedAt ? doc.data().endedAt.toDate() : null,
    }));

    const expiredRoomIds = selectExpiredRooms(rooms, now, RETENTION_DAYS);

    for (const roomId of expiredRoomIds) {
        try {
            await admin
                .storage()
                .bucket()
                .deleteFiles({ prefix: `rooms/${roomId}/photos/` });
        } catch (error) {
            console.error(`Error deleting Storage photos for room ${roomId}:`, error);
            continue;
        }
        await db.recursiveDelete(db.collection('rooms').doc(roomId));
    }

    return null;
});

module.exports = { cleanupEndedRooms, setRetentionDaysForTesting };
