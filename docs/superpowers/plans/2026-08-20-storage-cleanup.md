# Storage Cleanup on Room Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `cleanupEndedRooms.js` (the scheduled Cloud Function that deletes
an ended room's Firestore data 24 hours after `endedAt`) currently never
touches Firebase Storage — every kill photo a room ever had is orphaned
forever. Delete each room's Storage photos as part of the same cleanup
pass.

**Architecture:** One `try`/`catch`-wrapped bucket-prefix delete added
inside the existing per-room loop, before the existing
`db.recursiveDelete()` call. A Storage-delete failure for one room skips
only that room (its Firestore data stays in place, so the next scheduled
run retries both operations) — it never blocks cleanup of the other
expired rooms in the same invocation.

**Tech Stack:** Firebase Admin SDK (`admin.storage()`), Firestore emulator
and Storage emulator via `firebase-functions-test`'s `wrap()`, run with
`npm run test:emulator`.

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`,
  `npm test`, `npm run build`) must pass before this task is considered
  done.
- This task's REAL correctness gate is `npm run test:emulator` — it starts
  the Firestore, Auth, Functions, AND Storage emulators together and runs
  `*.integration.test.js`. `npm test` does not run `.integration.test.js`
  files at all, so it proves nothing about this change.
- This task touches `functions/`, which `npm run lint`/`npm run format`
  do NOT cover (confirmed repo convention — see CLAUDE.md and every prior
  `functions/`-touching plan this session). Also run
  `npx prettier --check "functions/**/*.js"` and
  `(cd functions && npm run lint)`.
- TDD: write the failing tests first, per CLAUDE.md.
- No changes to `storage.rules`, `functions/scheduledFunctions/selectExpiredRooms.js`,
  or `cleanupEndedRooms`'s public exports/signature (`{ cleanupEndedRooms,
setRetentionDaysForTesting }`).
- No changes to the retention window or any manually-triggered deletion
  path — this task is the scheduled cleanup function only.

---

### Task 1: Delete a room's Storage photos before deleting its Firestore data

**Files:**

- Modify: `functions/scheduledFunctions/cleanupEndedRooms.js`
- Modify: `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`

**Interfaces:**

- Consumes: nothing from other tasks — this is the only task in this plan.
- Produces: nothing consumed elsewhere. `cleanupEndedRooms`'s exports are
  unchanged (`{ cleanupEndedRooms, setRetentionDaysForTesting }`).

Current full content of `functions/scheduledFunctions/cleanupEndedRooms.js`:

```js
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
        await db.recursiveDelete(db.collection('rooms').doc(roomId));
    }

    return null;
});

module.exports = { cleanupEndedRooms, setRetentionDaysForTesting };
```

Current full content of
`functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`:

```js
/**
 * Layer 1b — the scheduled room-cleanup function, against the real
 * Firestore emulator. Run with `npm run test:emulator`.
 *
 * Unlike killPlayer/joinRoom, there is no client-facing httpsCallable to
 * go through — a scheduled function's only real caller is Cloud
 * Scheduler. firebase-functions-test's wrap() invokes the .onRun()
 * handler directly instead, which is as close to "the real interface" as
 * a cron job has
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 */
const admin = require('firebase-admin');
// cleanupEndedRooms must be required before firebase-functions-test() runs:
// calling firebase-functions-test() with no config overwrites
// process.env.GCLOUD_PROJECT with a mock "not-a-project" value (see
// node_modules/firebase-functions-test/lib/lifecycle.js). cleanupEndedRooms.js
// calls admin.initializeApp() at module load with no explicit config, so it
// picks up GCLOUD_PROJECT at require-time — if firebase-functions-test() ran
// first, the Admin SDK would initialize against "not-a-project" instead of
// this suite's actual demo project, and every read/write would silently miss
// the data seedRoom (client SDK, correctly targeted) just wrote.
const { cleanupEndedRooms, setRetentionDaysForTesting } = require('./cleanupEndedRooms');
const functionsTest = require('firebase-functions-test')();
const { clearFirestore, seedRoom, shutdown } = require('../../test/emulatorHelpers');

beforeEach(clearFirestore);
afterAll(async () => {
    functionsTest.cleanup();
    await shutdown();
});

const db = admin.firestore();

describe('cleanupEndedRooms', () => {
    it('does nothing when the retention window is unset (feature off)', async () => {
        setRetentionDaysForTesting(null);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(true);
    });

    it('deletes a room and its player subcollection once past the retention window', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(false);
        const players = await db.collection('rooms').doc('old-room').collection('players').get();
        expect(players.empty).toBe(true);
    });

    it('leaves a recently-ended room alone', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('recent-room', ['Alice'], {
            endedAt: new Date(),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('recent-room').get();
        expect(room.exists).toBe(true);
    });

    it('leaves a room that never ended alone', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('lobby-room', ['Alice']); // no endedAt override — never ended

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('lobby-room').get();
        expect(room.exists).toBe(true);
    });
});
```

`npm run test:emulator`'s script already starts the Storage emulator
alongside Firestore/Auth/Functions (confirmed via
`src/components/firebase_calls/storageCalls.integration.test.js`'s own
header comment and `package.json`'s `test:emulator` script) — no new
emulator setup needed for this task.

- [ ] **Step 1: Write the failing tests**

Add these three tests to the existing `describe('cleanupEndedRooms', ...)`
block in `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`,
after the existing four:

```js
it('deletes a rooms Storage photos along with its Firestore data', async () => {
    setRetentionDaysForTesting(3);
    await seedRoom('old-room', ['Alice'], {
        endedAt: new Date('2020-01-01'),
    });
    await admin
        .storage()
        .bucket()
        .file('rooms/old-room/photos/test.jpg')
        .save(Buffer.from('fake-image-data'));

    await functionsTest.wrap(cleanupEndedRooms)();

    const room = await db.collection('rooms').doc('old-room').get();
    expect(room.exists).toBe(false);
    const [photoExists] = await admin
        .storage()
        .bucket()
        .file('rooms/old-room/photos/test.jpg')
        .exists();
    expect(photoExists).toBe(false);
});

it('skips only the failing room when its Storage delete fails, leaving other expired rooms unaffected', async () => {
    setRetentionDaysForTesting(3);
    await seedRoom('failing-room', ['Alice'], {
        endedAt: new Date('2020-01-01'),
    });
    await seedRoom('other-room', ['Bob'], {
        endedAt: new Date('2020-01-01'),
    });
    const bucket = admin.storage().bucket();
    const realDeleteFiles = bucket.deleteFiles.bind(bucket);
    const deleteFilesSpy = jest.spyOn(bucket, 'deleteFiles').mockImplementation((options) => {
        if (options.prefix === 'rooms/failing-room/photos/') {
            return Promise.reject(new Error('Simulated Storage failure'));
        }
        return realDeleteFiles(options);
    });

    try {
        await functionsTest.wrap(cleanupEndedRooms)();

        const failingRoom = await db.collection('rooms').doc('failing-room').get();
        expect(failingRoom.exists).toBe(true);
        const otherRoom = await db.collection('rooms').doc('other-room').get();
        expect(otherRoom.exists).toBe(false);
    } finally {
        deleteFilesSpy.mockRestore();
    }
});

it('does nothing to Storage when a room has no photos (existing tests keep passing)', async () => {
    setRetentionDaysForTesting(3);
    await seedRoom('photoless-room', ['Alice'], {
        endedAt: new Date('2020-01-01'),
    });

    await functionsTest.wrap(cleanupEndedRooms)();

    const room = await db.collection('rooms').doc('photoless-room').get();
    expect(room.exists).toBe(false);
});
```

(The spy in the second test is scoped to that one test only — `jest.spyOn`
with `mockImplementation` overrides the method, and this repo's
`jest.config.js` sets `clearMocks: true` on the `integration` project,
which resets mock _call data_ between tests but does NOT restore an
overridden implementation, so the explicit `deleteFilesSpy.mockRestore()`
in the `finally` block is required — without it, the mocked rejection for
`'rooms/failing-room/photos/'` would leak into later tests in this file.
The `try`/`finally` ensures restoration happens even if an assertion
throws.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:emulator`
Expected: the third new test (`'does nothing to Storage when a room has
no photos'`) passes already (no Storage interaction happens either way
yet), but the first two FAIL — the first because the Storage object at
`rooms/old-room/photos/test.jpg` still exists after cleanup (nothing
deletes it yet), the second because `deleteFilesSpy` was never actually
called by `cleanupEndedRooms.js` (it doesn't call `deleteFiles` at all
yet), so both rooms get deleted from Firestore identically and the
"`failing-room` still exists" assertion fails.

- [ ] **Step 3: Write the implementation**

In `functions/scheduledFunctions/cleanupEndedRooms.js`, change:

```js
for (const roomId of expiredRoomIds) {
    await db.recursiveDelete(db.collection('rooms').doc(roomId));
}
```

to:

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:emulator`
Expected: PASS — all 7 tests in this file (4 existing + 3 new). Paste the
full, real emulator output in your report (per this task's real
correctness gate) — not a bare summary. Confirm specifically that the 4
pre-existing tests (which seed no Storage photo) still pass unmodified,
proving a prefix delete matching zero files is a no-op, not an error.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
npx prettier --check "functions/**/*.js"
(cd functions && npm run lint)
```

All six must pass, in addition to `npm run test:emulator` above.

- [ ] **Step 6: Commit**

```bash
git add functions/scheduledFunctions/cleanupEndedRooms.js functions/scheduledFunctions/cleanupEndedRooms.integration.test.js
git commit -m "Delete a rooms Storage photos when its scheduled Firestore cleanup runs"
```

---

## Self-Review Notes

- **Spec coverage:** "Bucket-prefix bulk delete" → Task 1's implementation
  step, using `bucket.deleteFiles({ prefix })`. "Storage delete first,
  abort-and-skip only that room on failure" → the `try`/`catch` with
  `continue`, verified by the second new test proving per-room isolation.
  "No `storage.rules` change" → no such file touched. Testing section's
  three scenarios (photo genuinely deleted, failure isolation, no-op on
  empty prefix) → the three new tests, in the same order.
- **Placeholder scan:** none found — every step has complete code or an
  explicit run command with an expected result.
- **Type consistency:** N/A — single task, no cross-task interfaces. The
  function's existing exports (`{ cleanupEndedRooms,
setRetentionDaysForTesting }`) are unchanged, confirmed against the
  reproduced current file content above.
