# Storage Cleanup on Room Deletion Design

**Date:** 2026-08-20
**Status:** Approved

## Problem

A security/hygiene audit this session found that `cleanupEndedRooms.js`
(the scheduled Cloud Function that deletes a room's Firestore data 24
hours after `endedAt`) only calls `db.recursiveDelete()` — it never
touches Firebase Storage. Every kill photo a room ever had lives forever
under `rooms/{roomId}/photos/**`, orphaned and untrackable once the
Firestore `photos` docs pointing at them are gone, since nothing else in
the app records or exposes those object paths. Re-verified this session:
still exactly as found — `functions/scheduledFunctions/cleanupEndedRooms.js`
has no `admin.storage()` reference anywhere, and `storage.rules` grants no
delete permission to anyone via the client SDK (irrelevant here regardless,
since Admin SDK calls — which is what a scheduled Cloud Function always
uses — bypass Storage rules entirely). For a game meant to be run
repeatedly, this is unbounded, silently compounding Storage cost.

## Decisions

- **Bucket-prefix bulk delete**, not per-photo deletion from each photo
  doc's `url` field. This app's Storage layout is a fixed
  `rooms/{roomId}/photos/**` per room (`storageCalls.js`'s
  `uploadKillPhoto` uploads to `rooms/${roomID}/photos/${photoID}.jpg`),
  so `bucket.deleteFiles({ prefix })` is simpler than parsing download
  URLs back into object paths, and as a side benefit also catches any
  file under that prefix with no Firestore doc reference at all (not just
  the ones the photos collection still knows about).
- **Storage delete runs first; a failure aborts only that room's cleanup
  for this run, not the whole scheduled invocation.** If the Storage
  delete throws, log and skip to the next room in the loop — the failed
  room's Firestore data stays in place (its `endedAt` is unchanged), so
  the next scheduled run (24 hours later) naturally retries both
  operations with no custom retry logic needed. One room's Storage
  failure never blocks cleanup of the other expired rooms in the same
  run.

## Components

### `functions/scheduledFunctions/cleanupEndedRooms.js` (modified)

Inside the existing `for (const roomId of expiredRoomIds)` loop, before
the current `await db.recursiveDelete(db.collection('rooms').doc(roomId));`:

```js
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
```

No change to `selectExpiredRooms.js` (the pure room-selection logic) or
to the function's public signature/exports — this only touches the I/O
loop that acts on `selectExpiredRooms`'s output.

### No `storage.rules` change

Admin SDK calls bypass Storage rules entirely, the same reason
`killPlayer.js` bypasses `firestore.rules`. Nothing to grant.

## Testing

Extend `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`
(real Firestore _and_ Storage emulator — both already started by
`npm run test:emulator`):

- A room with an actual uploaded photo, past retention: after running the
  function, the Storage object no longer exists
  (`bucket.file(path).exists()` resolves `[false]`), same as the Firestore
  doc already being gone.
- A room with no photos at all (the shape every existing test in this file
  already uses): a prefix delete matching zero files is a no-op, not an
  error — existing tests keep passing unmodified, proving this.
- A simulated Storage-delete failure, via a one-off `jest.spyOn` on
  `deleteFiles` for just that test (a real emulator has no on-demand way
  to fail): that room's Firestore data is NOT deleted, and — if the test
  seeds a second, otherwise-expired room alongside it — the second room's
  data IS deleted, proving per-room failure isolation.

## Error handling

The `try`/`catch` around the Storage delete is the only new error path —
already covered above. No new error surfaced to any user-facing UI; this
is a background scheduled function with no caller to report to, matching
its existing behavior (errors already only went to `console.error`/Cloud
Functions logs before this change too, e.g. no existing error handling
around `recursiveDelete` either).

## Out of scope

- Changing the retention window (`RETENTION_DAYS`) itself.
- Any manually-triggered (GM-initiated) deletion path — this is purely the
  scheduled cleanup function.
- Cleaning up Storage objects for rooms that predate this fix and have
  already had their Firestore docs deleted (already-orphaned files stay
  orphaned; there's no Firestore record left to find them by).
