# Kill Photo URL Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `firestore.rules`'s `photos/{photoId}` `allow create` rule
currently lets a player submit a kill-photo claim with any `url` at all —
close that gap so a submitted photo must actually point at this room's own
Firebase Storage path.

**Architecture:** One new clause added to the existing `allow create`
condition, matched against the URL's Storage path structure (not its
host), so it works identically against production and emulator Storage
URLs. The existing `test/firestore.rules.test.js` photos block gains a
denial test for a forged URL, plus its existing passing-case fixtures get
updated to a realistic URL shape so they keep passing under the new check.

**Tech Stack:** Firestore Security Rules, `@firebase/rules-unit-testing`
against the Firestore emulator (`npm run test:rules`).

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`,
  `npm test`, `npm run build`) must pass before this task is considered
  done.
- This task's REAL correctness gate is `npm run test:rules` — it starts
  the Firestore emulator and runs `test/**/*.rules.test.js`. `npm test`
  does not run rules tests at all, so a green `npm test` proves nothing
  about this change.
- No changes to any file other than `firestore.rules` and
  `test/firestore.rules.test.js`.
- No client-side code changes — `MessageComposer.js`'s real upload flow
  (`uploadKillPhoto` → `getDownloadURL` → `addPhotoForRoom`) already
  produces a URL matching the new check.
- Investigated at plan-writing time whether any other emulator-integration
  test (`dbCalls.integration.test.js`, `undoKill.integration.test.js`)
  would break: both call `addPhotoForRoom(...,
'https://example.com/photo.jpg')` while signed in as the room's own
  host identity (the shared default identity every `seedRoom()` call in
  this suite signs in as via `hostUid()`, with no identity switch before
  these calls) — so those writes go through `allow write: if
isHostOfExistingRoom(roomId)`, which has no field-shape restrictions at
  all, not through the narrower `allow create` this task modifies. They
  are unaffected and need no changes. Only `test/firestore.rules.test.js`'s
  tests that explicitly authenticate as `PLAYER_UID` exercise `allow
create`'s field checks.

---

### Task 1: Add the URL check to `firestore.rules` and its test coverage

**Files:**

- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Consumes: nothing from other tasks — this is the only task in this plan.
- Produces: nothing consumed elsewhere.

Current `photos/{photoId}` match block in `firestore.rules` (find it by
searching for `match /photos/{photoId}`):

```
match /photos/{photoId} {
    allow read: if isHostOrPlayerOfRoom(roomId);
    allow write: if isHostOfExistingRoom(roomId);
    // Lets a player submit a kill-photo claim without general write
    // access to this collection — scoped narrowly so a player can't
    // self-approve a kill (status must start pending) or forge the
    // pre-kill snapshot the Undo flow relies on (originalPlayerData
    // must be null)
    // (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
    allow create: if isPlayerOfRoom(roomId) &&
      request.resource.data.status == 'pending' &&
      request.resource.data.originalPlayerData == null;
}
```

Current photos-related tests in `test/firestore.rules.test.js`, inside
`describe('rooms/{roomId}/photos/{photoId}', ...)` (find it by that exact
describe string):

```js
    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });

    it('allows a player to create a photo with pending status and no originalPlayerData', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
                url: 'https://example.com/photo.jpg',
                assassin: 'bob',
                target: 'alice',
                status: 'pending',
                originalPlayerData: null,
            })
        );
    });

    it('denies a player creating a photo with a non-pending status', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
                url: 'https://example.com/photo.jpg',
                assassin: 'bob',
                target: 'alice',
                status: 'approved',
                originalPlayerData: null,
            })
        );
    });

    it('denies a player creating a photo with a non-null originalPlayerData', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
                url: 'https://example.com/photo.jpg',
                assassin: 'bob',
                target: 'alice',
                status: 'pending',
                originalPlayerData: { score: 10, targets: [], assassins: [] },
            })
        );
    });
});
```

The `'denies a non-host write'` and `'allows the host to write'` tests use
`url: 'x'` and go through `allow write` (host has unrestricted access) —
these do NOT exercise `allow create` and need no changes. Every other test
in this block authenticates as `PLAYER_UID` and does exercise `allow
create` — three of these use `url: 'https://example.com/photo.jpg'`,
which will NOT match the new check (no `/o/rooms%2Froom-a%2Fphotos%2F`
segment), so they need a realistic URL fixture.

- [ ] **Step 1: Write the failing test**

In `test/firestore.rules.test.js`, replace the entire
`describe('rooms/{roomId}/photos/{photoId}', ...)` block's contents
(everything between its opening `{` and closing `});`) with:

```js
it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
});

it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();
    await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
});

it('allows a player who has joined this room to read photos', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
});

it('denies a non-host write', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
    );
});

it('allows the host to write', async () => {
    const db = testEnv.authenticatedContext(HOST_UID).firestore();
    await assertSucceeds(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
    );
});

// A URL shaped like a real getDownloadURL result for this room's own
// Storage path — uploadKillPhoto (storageCalls.js) uploads to
// rooms/{roomID}/photos/{photoID}.jpg, and Firebase Storage encodes
// the path's slashes as %2F in the returned download URL.
const REALISTIC_ROOM_A_PHOTO_URL =
    'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.appspot.com/o/rooms%2Froom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';

it("allows a player to create a photo with pending status, no originalPlayerData, and a url under this room's own Storage path", async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: REALISTIC_ROOM_A_PHOTO_URL,
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
        })
    );
});

it('denies a player creating a photo with a non-pending status', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: REALISTIC_ROOM_A_PHOTO_URL,
            assassin: 'bob',
            target: 'alice',
            status: 'approved',
            originalPlayerData: null,
        })
    );
});

it('denies a player creating a photo with a non-null originalPlayerData', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: REALISTIC_ROOM_A_PHOTO_URL,
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: { score: 10, targets: [], assassins: [] },
        })
    );
});

it('denies a player creating a photo whose url does not point at Firebase Storage at all', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: 'https://evil.example.com/x.jpg',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
        })
    );
});

it("denies a player creating a photo whose url points at a different room's Storage path", async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: 'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.appspot.com/o/rooms%2Fsome-other-room%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
        })
    );
});
```

(Keep the surrounding `describe('rooms/{roomId}/photos/{photoId}', () =>
{ ... });` wrapper — only replace what's inside it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:rules`
Expected: the three tests using `REALISTIC_ROOM_A_PHOTO_URL` for a
currently-passing case still PASS (that URL shape doesn't matter yet,
since the rule doesn't check it), but the two new denial tests
(`'denies a player creating a photo whose url does not point at Firebase
Storage at all'` and `'...points at a different room's Storage path'`)
FAIL — `assertFails` fails because the write currently SUCCEEDS (the rule
has no URL check yet).

- [ ] **Step 3: Write the implementation**

In `firestore.rules`, change the `photos/{photoId}` match block's `allow
create` from:

```
allow create: if isPlayerOfRoom(roomId) &&
  request.resource.data.status == 'pending' &&
  request.resource.data.originalPlayerData == null;
```

to:

```
allow create: if isPlayerOfRoom(roomId) &&
  request.resource.data.status == 'pending' &&
  request.resource.data.originalPlayerData == null &&
  request.resource.data.url.matches('.*/o/rooms%2F' + roomId + '%2Fphotos%2F.*');
```

Update the doc comment right above `allow create` (currently ending
"...forge the pre-kill snapshot the Undo flow relies on (originalPlayerData
must be null)") to also mention the new check:

```
// Lets a player submit a kill-photo claim without general write
// access to this collection — scoped narrowly so a player can't
// self-approve a kill (status must start pending), forge the
// pre-kill snapshot the Undo flow relies on (originalPlayerData
// must be null), or point the claim at an external URL or a
// different room's Storage path (url must reference this room's own
// rooms/{roomId}/photos/ path, matching what uploadKillPhoto
// actually produces)
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
// docs/superpowers/specs/2026-08-18-kill-photo-url-validation-design.md).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS — every test in the `rooms/{roomId}/photos/{photoId}`
block, including the two new denial tests. Paste the full, real emulator
output in your report (per this task's real correctness gate) — not a
bare summary.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

All four must pass, in addition to `npm run test:rules` above.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules test/firestore.rules.test.js
git commit -m "Require a submitted kill-photo url to reference this room's own Storage path"
```

---

## Self-Review Notes

- **Spec coverage:** "Validation lives in firestore.rules" → Task 1's
  `allow create` clause. "Host-agnostic, path-segment match" → the
  `.matches('.*/o/rooms%2F' + roomId + '%2Fphotos%2F.*')` clause, which
  contains no host/scheme, only the Storage object-path segment. "No
  client-side change" → confirmed, no `src/` file touched. "Existing
  legitimate-submission tests keep passing" → the three player-authenticated
  passing/failing-for-other-reasons tests get the realistic URL fixture so
  they remain correctly isolated to testing only what their name claims.
  "Rejects a different room's photos" → the new
  `'...points at a different room's Storage path'` test.
- **Placeholder scan:** none found — every step has complete code or an
  explicit run command with an expected result.
- **Type consistency:** N/A — this plan has no shared function signatures
  or cross-task interfaces (single task, rules-language only).
