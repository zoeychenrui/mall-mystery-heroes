/**
 * Given a list of rooms and a retention window in days, returns the
 * roomIds old enough to be swept up by cleanupEndedRooms
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 * Pure — no Firebase, no Admin SDK, so this is unit-testable without an
 * emulator. `now` is a parameter rather than `new Date()` internally so
 * tests are deterministic.
 *
 * @param rooms Array<{ id: string, endedAt: Date | null }>
 * @param now Date
 * @param retentionDays number | null — null means nothing is ever selected
 *   (the feature is off until a duration is chosen)
 * @returns string[] — roomIds to delete
 */
const selectExpiredRooms = (rooms, now, retentionDays) => {
    if (retentionDays === null) return [];
    const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    return rooms
        .filter((room) => room.endedAt !== null && room.endedAt.getTime() <= cutoffMs)
        .map((room) => room.id);
};

module.exports = { selectExpiredRooms };
