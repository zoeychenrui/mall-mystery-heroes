# Full Kill Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PhotosDisplay.js's Undo button fully reverse an approved kill — the killer's score/target change and every player the kill's remap touched, not just the target — atomically, mirroring `killPlayer.js`'s own transaction pattern.

**Architecture:** `killPlayer.js` snapshots every player its transaction is about to write to (not just the target) and returns that as a map. A new atomic Cloud Function, `undoKillPlayer`, replays that map to reverse a kill in one transaction. A thin client wrapper (`undoKill.js`, mirroring `executeKill.js`) calls it; `PhotosDisplay.js`'s Undo button calls the wrapper instead of five separate client-side writes.

**Tech Stack:** Firebase Cloud Functions (Admin SDK, `functions.https.onCall`, Firestore transactions), React, Jest (unit/dom/integration Jest projects), `firebase emulators:exec`.

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) must pass before any task is considered done.
- **`npm run lint`/`npm run format` do not cover `functions/`** — their globs are scoped to `src/**`. Any task touching `functions/callableFunctions/*.js` must ALSO run `npx prettier --check "functions/**/*.js"` and `(cd functions && npm run lint)` as part of its gate, in addition to the root four commands.
- **`npm test` does not run Cloud Function code** — `functions/callableFunctions/*.js` only runs against real Firestore/Auth/Functions emulators via `npm run test:emulator`. Any task touching those files must run `npm run test:emulator` as its actual correctness gate, not just `npm test`.
- TDD: write the failing test first, watch it fail, then implement (per CLAUDE.md). For the Cloud Function work, the emulator integration test IS the test — there is no jsdom/node-unit layer for this logic.
- Do not modify `firestore.rules`, `src/game/remapPlan.js`, or `handlePass`/`handleDeny` in `PhotosDisplay.js`.
- Do not delete `src/components/firebase_calls/dbCalls.js`'s `remapPlayerAsTarget` even though it becomes unreferenced — leave it in place; Task 3 adds a tracking note instead.
- No backward compatibility for kill photos approved before this change ships (confirmed with the user — the game has not shipped).

---

### Task 1: Reshape `killPlayer.js`'s snapshot to cover every touched player

**Files:**

- Modify: `functions/callableFunctions/killPlayer.js` (full current content below)
- Modify: `src/components/executeKill.integration.test.js:37-59` (one test's assertion)

**Interfaces:**

- Consumes: nothing new.
- Produces: `killPlayer`'s (and therefore `executeKill`'s) resolved `preKillSnapshot` field changes shape from a flat `{ score, targets, assassins }` object describing only the target, to a map keyed by normalized player name (`normalizePlayerName(name)` — lowercase, whitespace-stripped), each value `{ score, targets, assassins, isAlive }`, covering every player `killPlayer.js`'s transaction wrote to. Task 2's `undoKillPlayer` consumes this shape by reading it off the photo doc's `originalPlayerData` field (which `approvePhotoForRoom` — unchanged — stores verbatim).

**Current content of `functions/callableFunctions/killPlayer.js`:**

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Vendored copies, not '../../src/game/...' — Cloud Functions deploy
// uploads only the functions/ directory in isolation, so a require()
// reaching outside it cannot resolve in the deployed bundle even though it
// works locally and under the emulator. Kept in sync by
// functions/scripts/sync-shared-game-logic.js (predeploy hook + local test
// setup) — src/game/ remains the single source of truth.
const { planRemap } = require('../vendor/game/remapPlan');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The atomic replacement for the client-side kill flow
 * (docs/improvements.md item 4): score transfer, unmapping the victim from
 * every neighbor, the victim's own reset, and the remap that follows, all
 * inside one Firestore transaction. Previously this was ~9-15 separate,
 * unbatched writes from the browser — a dropped connection partway through
 * could leave the game in a state nothing detected or repaired.
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here; rules aren't
 * consulted for anything this function does.
 */
exports.killPlayer = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { target, assassin, roomId } = data;
    if (!target || !assassin || !roomId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'target, assassin, and roomId are all required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        // --- read phase: Firestore transactions require every read to
        // finish before any write starts, so everything the write phase
        // needs is gathered here first. ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            // Re-implements firestore.rules' isHostOfExistingRoom check —
            // rules don't apply to the Admin SDK, so this is the actual
            // enforcement for this function.
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can kill a player.'
            );
        }

        const assassinSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(assassin))
        );
        if (assassinSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${assassin}`);
        }
        const assassinDoc = assassinSnapshot.docs[0];
        const assassinData = assassinDoc.data();

        const targetSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(target))
        );
        if (targetSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${target}`);
        }
        const targetDoc = targetSnapshot.docs[0];
        const targetData = targetDoc.data();
        const targetKey = normalizePlayerName(target);

        // A kill is valid if any of three things is true: the target is on
        // the assassin's own list; the target has open season on
        // themselves (anyone may kill an open-season player, not just
        // their assigned hunter); or the assassin has open season (blanket
        // kill rights on anyone). This is the same three-way rule the
        // now-deleted dbCalls.fetchTargetsForPlayer + checkOpenSzn
        // combination enforced — fetchTargetsForPlayer used to run a
        // separate query merging every open-season player's name into the
        // assassin's own target list before this comparison; that's no
        // longer needed here since targetData was already read above.
        const assassinTargets = (assassinData.targets || []).map((name) =>
            normalizePlayerName(name)
        );
        const isValidTarget =
            assassinTargets.includes(targetKey) || targetData.openSeason || assassinData.openSeason;
        if (!isValidTarget) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${target} is not a valid target for ${assassin}`
            );
        }

        // The target's former hunters and prey — these need unmapping.
        // Deduped by normalized name: a player could in principle appear in
        // both arrays. A name that doesn't resolve to a document is a
        // stale reference (shouldn't happen — item 36's pre-fix bug caused
        // exactly this for months — but an unrelated data anomaly
        // shouldn't block a kill, so it's skipped, not thrown).
        const neighborNames = [...(targetData.assassins || []), ...(targetData.targets || [])];
        const neighborDocsByName = new Map();
        for (const name of neighborNames) {
            const key = normalizePlayerName(name);
            if (neighborDocsByName.has(key)) continue;
            const neighborSnapshot = await transaction.get(
                playersRef.where('trimmedNameLowerCase', '==', key)
            );
            if (neighborSnapshot.empty) {
                console.warn(`killPlayer: neighbor not found, skipping unmap: ${name}`);
                continue;
            }
            neighborDocsByName.set(key, neighborSnapshot.docs[0]);
        }

        // The alive roster for the remap step, as planRemap expects it:
        // the target excluded (their isAlive:false write hasn't landed
        // yet within this transaction, so the query would otherwise still
        // include them) and the target's name scrubbed from every
        // neighbor's own targets/assassins arrays (their unmap write
        // hasn't landed yet either — planRemap needs to reason about the
        // post-unmap state, the same state it would see if this were the
        // separate, later read the client's old sequential version used).
        const rosterSnapshot = await transaction.get(playersRef.where('isAlive', '==', true));
        const rosterDocsByName = new Map();
        const roster = [];
        for (const doc of rosterSnapshot.docs) {
            const docData = doc.data();
            if (docData.trimmedNameLowerCase === targetKey) continue;
            rosterDocsByName.set(normalizePlayerName(docData.name), doc);
            roster.push({
                name: docData.name,
                targets: (docData.targets || []).filter(
                    (name) => normalizePlayerName(name) !== targetKey
                ),
                assassins: (docData.assassins || []).filter(
                    (name) => normalizePlayerName(name) !== targetKey
                ),
            });
        }

        const plan = planRemap(roster, {
            needTargets: targetData.assassins || [],
            needAssassins: targetData.targets || [],
        });

        // --- write phase ---

        // Firestore rejects more than one write to the same document
        // within a transaction, and it's normal for one to be needed here:
        // the assassin, for instance, gets both a score update and (very
        // likely) a new-target assignment from the remap, since their old
        // target is the player who's dying. Every field update for a given
        // player is accumulated here and applied as a single
        // transaction.update() per document. Unmap writes are queued
        // before remap writes on purpose: a remap write's targets/assassins
        // values are always the complete post-remap state (computed from
        // the already-scrubbed roster above), so where both touch the same
        // field, the remap value is the correct one to keep — later queued
        // values win.
        const pendingUpdates = new Map();
        const queueUpdate = (name, ref, fields) => {
            const key = normalizePlayerName(name);
            const existing = pendingUpdates.get(key);
            if (existing) {
                Object.assign(existing.fields, fields);
            } else {
                pendingUpdates.set(key, { ref, fields: { ...fields } });
            }
        };

        const currTargetPoints = targetData.score >= 0 ? targetData.score : 0;
        queueUpdate(assassin, assassinDoc.ref, {
            score: (assassinData.score || 0) + currTargetPoints,
        });

        queueUpdate(target, targetDoc.ref, {
            score: 0,
            isAlive: false,
            openSeason: false,
            targets: [],
            assassins: [],
        });

        for (const name of targetData.assassins || []) {
            const neighborDoc = neighborDocsByName.get(normalizePlayerName(name));
            if (!neighborDoc) continue;
            const newTargets = (neighborDoc.data().targets || []).filter(
                (n) => normalizePlayerName(n) !== targetKey
            );
            queueUpdate(name, neighborDoc.ref, { targets: newTargets });
        }
        for (const name of targetData.targets || []) {
            const neighborDoc = neighborDocsByName.get(normalizePlayerName(name));
            if (!neighborDoc) continue;
            const newAssassins = (neighborDoc.data().assassins || []).filter(
                (n) => normalizePlayerName(n) !== targetKey
            );
            queueUpdate(name, neighborDoc.ref, { assassins: newAssassins });
        }

        for (const write of plan.writes) {
            const doc = rosterDocsByName.get(normalizePlayerName(write.player));
            if (!doc) continue; // defensive; every plan.writes entry came from `roster`
            queueUpdate(write.player, doc.ref, {
                targets: write.targets,
                assassins: write.assassins,
            });
        }

        for (const { ref, fields } of pendingUpdates.values()) {
            transaction.update(ref, fields);
        }

        return {
            targetWasOpenSzn: targetData.openSeason,
            preKillSnapshot: {
                score: targetData.score,
                targets: targetData.targets,
                assassins: targetData.assassins,
            },
            addedTargets: plan.added.targets,
            addedAssassins: plan.added.assassins,
            remapLogs: plan.logs,
        };
    });
});
```

**Current content of `src/components/executeKill.integration.test.js:37-59`** (the test whose assertion changes):

```js
it("allows a kill when the target is on the assassin's list, and remaps whoever's left short", async () => {
    await seedRoom(ROOM, [
        { name: 'alice', targets: ['bob'], score: 10 },
        { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        { name: 'carol', targets: [], assassins: [] },
    ]);

    const result = await executeKill('bob', 'alice', ROOM);

    expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15); // 10 + bob's 5
    expect(result.preKillSnapshot).toEqual({ score: 5, targets: [], assassins: ['alice'] });

    // Alice's old target (bob) just died — carol is the only other
    // alive player, so she's the only possible new assignment. This is
    // the remap step, folded into the same transaction as the kill
    // itself (docs/improvements.md item 4) rather than a separate
    // client-driven follow-up.
    expect(result.addedTargets.alice).toEqual(['carol']);
    expect(result.remapLogs).toEqual(['New target for alice: carol']);
    expect((await fetchPlayerForRoom('alice', ROOM)).data().targets).toEqual(['carol']);
    expect((await fetchPlayerForRoom('carol', ROOM)).data().assassins).toEqual(['alice']);
});
```

Only the `expect(result.preKillSnapshot)...` line changes. Everything else in this test is unaffected by this task (verified by hand-tracing `killPlayer.js`'s exact logic against this test's seed data below) and must stay identical.

- [ ] **Step 1: Update the failing assertion**

In `src/components/executeKill.integration.test.js`, replace:

```js
expect(result.preKillSnapshot).toEqual({ score: 5, targets: [], assassins: ['alice'] });
```

with:

```js
expect(result.preKillSnapshot).toEqual({
    alice: { score: 10, targets: ['bob'], assassins: [], isAlive: true },
    bob: { score: 5, targets: [], assassins: ['alice'], isAlive: true },
    carol: { score: 0, targets: [], assassins: [], isAlive: true },
});
```

This is derived by hand-tracing `killPlayer.js`'s current logic against this test's exact seed (alice: `targets: ['bob'], score: 10`; bob: `score: 5, targets: [], assassins: ['alice']`; carol: `targets: [], assassins: []`, defaults filling in `score: 0, isAlive: true, openSeason: false`): the kill queues writes for alice (score + unmap), bob (the kill itself), and carol (remap — she becomes alice's new target, per the existing `addedTargets.alice` assertion just below). Those three names are exactly `pendingUpdates.keys()` after this task's change, so the new snapshot has exactly those three entries, each holding that player's values as seeded (before any write in this transaction touches them).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:emulator -- --testPathPattern=executeKill`

(If your shell rejects passing flags through `npm run` like this, run `node functions/scripts/sync-shared-game-logic.js && firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,auth,functions,storage "jest --selectProjects integration --runInBand --testPathPattern=executeKill"` directly instead — either way, the goal is running just this one file under the emulator, not the whole integration suite.)

Expected: FAIL — the current `killPlayer.js` still returns the old flat `{ score: 5, targets: [], assassins: ['alice'] }` shape, not the new map.

- [ ] **Step 3: Write the implementation**

In `functions/callableFunctions/killPlayer.js`:

1. Right after `const db = admin.firestore();`, no change needed there. Inside the `killPlayer` handler, right after `const assassinData = assassinDoc.data();`, add:

```js
const preWriteDataByName = new Map();
const captureSnapshot = (name, data) => {
    const key = normalizePlayerName(name);
    if (!preWriteDataByName.has(key)) {
        preWriteDataByName.set(key, {
            score: data.score,
            targets: data.targets,
            assassins: data.assassins,
            isAlive: data.isAlive,
        });
    }
};
captureSnapshot(assassin, assassinData);
```

2. Right after `const targetData = targetDoc.data();`, add:

```js
captureSnapshot(target, targetData);
```

3. Inside the neighbor-gathering loop, right after `neighborDocsByName.set(key, neighborSnapshot.docs[0]);`, add:

```js
captureSnapshot(name, neighborSnapshot.docs[0].data());
```

4. Inside the roster-building loop, right after `rosterDocsByName.set(normalizePlayerName(docData.name), doc);`, add:

```js
captureSnapshot(docData.name, docData);
```

5. Immediately before `for (const { ref, fields } of pendingUpdates.values()) {`, add:

```js
const preKillSnapshot = {};
for (const key of pendingUpdates.keys()) {
    const snapshot = preWriteDataByName.get(key);
    if (snapshot) preKillSnapshot[key] = snapshot;
}
```

6. Change the return statement's `preKillSnapshot` field from:

```js
            preKillSnapshot: {
                score: targetData.score,
                targets: targetData.targets,
                assassins: targetData.assassins,
            },
```

to:

```js
            preKillSnapshot,
```

(using the local variable built in step 5).

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2.
Expected: PASS — all 7 tests in `executeKill.integration.test.js`, including the updated assertion.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Then also run: `npx prettier --check "functions/**/*.js"` (expected: only pre-existing `functions/index.js` warnings, unrelated to this task — `functions/callableFunctions/killPlayer.js` itself must show no warnings) and `(cd functions && npm run lint)` (expected: clean).
Then run: `npm run test:emulator` in full (not just the one file) — expected: all 5 suites / 52 tests pass (confirms this task didn't break `PhotosDisplay`-adjacent or other integration coverage).

- [ ] **Step 6: Commit**

```bash
git add functions/callableFunctions/killPlayer.js src/components/executeKill.integration.test.js
git commit -m "Snapshot every player killPlayer touches, not just the target"
```

---

### Task 2: Add the atomic `undoKillPlayer` Cloud Function and its client wrapper

**Files:**

- Create: `functions/callableFunctions/undoKillPlayer.js`
- Modify: `functions/index.js` (full current content below)
- Create: `src/components/undoKill.js`
- Create: `src/components/undoKill.integration.test.js`

**Interfaces:**

- Consumes: `preKillSnapshot`'s new map shape from Task 1 (read off a photo doc's `originalPlayerData` field, written there unchanged by the existing `approvePhotoForRoom`). `normalizePlayerName` from `../vendor/game/playerNames` (already vendored, used the same way `killPlayer.js` uses it).
- Produces: a registered Cloud Function `undoKillPlayer`, callable as `httpsCallable(functions, 'undoKillPlayer')` with `{ roomId, photoId }`. A client wrapper `undoKill(roomID, photoID) → Promise<void>` from `src/components/undoKill.js`, default export none (named export `undoKill`). Task 3 imports `{ undoKill } from '../undoKill'` and calls `await undoKill(roomID, photo.id)`.

**Current content of `functions/index.js`:**

```js
const express = require('express');
const cors = require('cors');

var corsOptions = {
    origin: 'http://localhost:3000',
};

const app = express();
app.use(cors({ corsOptions }));

const { killPlayer } = require('./callableFunctions/killPlayer');
exports.killPlayer = killPlayer;

const { joinRoom } = require('./callableFunctions/joinRoom');
exports.joinRoom = joinRoom;

const { cleanupEndedRooms } = require('./scheduledFunctions/cleanupEndedRooms');
exports.cleanupEndedRooms = cleanupEndedRooms;
```

(No trailing newline; inconsistent quote/semicolon style is pre-existing — match it exactly for the two new lines, do not reformat the rest of the file.)

**Current content of `src/components/executeKill.js`** (the pattern the new wrapper mirrors):

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const killPlayerCallable = httpsCallable(functions, 'killPlayer');

/**
 * Kills a player: validates the target is on the assassin's target list (or
 * the assassin has open season), transfers the target's points to the
 * assassin, kills the target, unmaps them from every neighbor, and
 * reassigns targets/assassins to whoever that leaves short — all inside one
 * Firestore transaction, server-side (docs/improvements.md item 4).
 *
 * This used to be ~9-15 separate, unbatched writes from the browser (see
 * functions/callableFunctions/killPlayer.js for what replaced it, and this
 * file's own git history before item 4 for what used to be here). A
 * dropped connection partway through could leave the game in a state
 * nothing detected or repaired. Now it's one request; it either fully
 * succeeds or fully fails.
 *
 * @throws if target isn't a valid kill for assassin, or the caller isn't
 *   the room's host — surfaces as a rejected promise carrying `.message`,
 *   same as any other error this codebase throws (docs/improvements.md
 *   item 10's error-propagation pattern needs no changes to handle this).
 */
export const executeKill = async (target, assassin, roomID) => {
    const { data } = await killPlayerCallable({ target, assassin, roomId: roomID });
    return data;
};
```

**Current content of `test/emulatorHelpers.js`'s relevant exports** (for the test in Step 1 below — already exist, do not modify this file):

```js
export const clearFirestore = async () => {
    /* wipes every doc in the emulator */
};
export const shutdown = () => terminate(db);
export const callableAsNonHost = (functionName) => {
    /* returns an async (data) => callable(data), signed in as a distinct,
       non-host identity */
};
export const seedRoom = async (roomID, players = [], roomOverrides = {}, dbInstance = db) => {
    /* writes a room doc (hostId: the shared signed-in identity) and one
       player doc per entry in `players`, each merged with defaults
       { score: 0, isAlive: true, openSeason: false, targets: [], assassins: [] } */
};
```

**Current content of `src/components/firebase_calls/dbCalls.js`'s relevant exports** (for the test below — already exist, do not modify this file):

```js
export const addPhotoForRoom = async (roomID, assassin, target, url) => {
    const photosRef = collection(db, 'rooms', roomID, 'photos');
    await addDoc(photosRef, {
        url,
        assassin,
        target,
        timestamp: serverTimestamp(),
        status: 'pending',
        originalPlayerData: null,
    });
};

export const fetchPhotosQueryByAscendingTimestampForRoom = (roomID) => {
    const photosCollectionRef = collection(db, 'rooms', roomID, 'photos');
    return query(photosCollectionRef, orderBy('timestamp', 'asc'));
};

export const approvePhotoForRoom = async (roomID, photoID, originalPlayerData) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, { status: 'approved', originalPlayerData });
};

export const fetchPlayerForRoom = async (playerName, roomID) => {
    /* returns the QueryDocumentSnapshot for playerName, throws 'Player not found' if none */
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/undoKill.integration.test.js`:

```js
/**
 * Layer 1b — the atomic kill-undo Cloud Function, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `undoKill` is a thin wrapper around
 * `httpsCallable(functions, 'undoKillPlayer')` — these tests call it
 * exactly the way the real app does, then assert on what actually landed
 * in Firestore, rather than asserting against the function's internals
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). Each test
 * builds a real approved kill photo first (via the real `executeKill` +
 * `addPhotoForRoom` + `approvePhotoForRoom`), matching exactly what
 * `PhotosDisplay.js`'s Accept flow does, so the snapshot being undone is
 * genuine, not hand-constructed.
 */
import { getDocs } from 'firebase/firestore';
import { undoKill } from './undoKill';
import { executeKill } from './executeKill';
import {
    addPhotoForRoom,
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
} from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

const latestPhotoId = async () => {
    const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
    return snapshot.docs[0].id;
};

describe('undoKill', () => {
    it('reverts a simple kill: killer and target both restored, photo back to pending', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        await undoKill(ROOM, photoId);

        const alice = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect(alice.score).toBe(10);
        expect(alice.targets).toEqual(['bob']);
        expect(alice.assassins).toEqual([]);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.score).toBe(5);
        expect(bob.targets).toEqual([]);
        expect(bob.assassins).toEqual(['alice']);

        const photoSnapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(photoSnapshot.docs[0].data().status).toBe('pending');
    });

    it('reverts a kill whose remap touched a third player, restoring their targets/assassins too', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
            { name: 'carol', targets: [], assassins: [] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        // Confirm the remap actually touched carol before undoing, so this
        // test is proven non-vacuous.
        expect((await fetchPlayerForRoom('carol', ROOM)).data().assassins).toEqual(['alice']);

        await undoKill(ROOM, photoId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(10);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().targets).toEqual(['bob']);
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);

        const carol = (await fetchPlayerForRoom('carol', ROOM)).data();
        expect(carol.targets).toEqual([]);
        expect(carol.assassins).toEqual([]);
    });

    it('rejects undo of a photo that is not approved', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();
        // Photo is still 'pending' — never approved.

        await expect(undoKill(ROOM, photoId)).rejects.toThrow(/not approved|nothing to undo/i);

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();
        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        const undoAsNonHost = callableAsNonHost('undoKillPlayer');
        await expect(undoAsNonHost({ roomId: ROOM, photoId })).rejects.toThrow(
            /permission-denied|host/i
        );

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:emulator -- --testPathPattern=undoKill`
Expected: FAIL — `undoKill.js` and `undoKillPlayer.js` don't exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `functions/callableFunctions/undoKillPlayer.js`:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Reverses everything killPlayer.js did for one approved kill — not just
 * the target, but every player its transaction touched (the killer, any
 * co-assassins, and anyone the remap reassigned) — in one Firestore
 * transaction, mirroring killPlayer.js's own atomicity
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here.
 */
exports.undoKillPlayer = functions.https.onCall(async (data, context) => {
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
        const playersRef = roomRef.collection('players');
        const photoRef = roomRef.collection('photos').doc(photoId);

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can undo a kill.'
            );
        }

        const photoSnapshot = await transaction.get(photoRef);
        if (!photoSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Photo not found: ${photoId}`);
        }
        const photoData = photoSnapshot.data();
        if (photoData.status !== 'approved') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Photo is not approved (status: ${photoData.status}); nothing to undo.`
            );
        }

        const snapshotEntries = Object.entries(photoData.originalPlayerData || {});
        const playerRefsByKey = new Map();
        for (const [key] of snapshotEntries) {
            const playerSnapshot = await transaction.get(
                playersRef.where('trimmedNameLowerCase', '==', key)
            );
            if (playerSnapshot.empty) {
                console.warn(`undoKillPlayer: player not found, skipping restore: ${key}`);
                continue;
            }
            playerRefsByKey.set(key, playerSnapshot.docs[0].ref);
        }

        for (const [key, snapshot] of snapshotEntries) {
            const ref = playerRefsByKey.get(key);
            if (!ref) continue;
            transaction.update(ref, {
                score: snapshot.score,
                targets: snapshot.targets,
                assassins: snapshot.assassins,
                isAlive: snapshot.isAlive,
            });
        }

        transaction.update(photoRef, { status: 'pending' });
    });
});
```

Modify `functions/index.js` — add these two lines after the `killPlayer` block (matching the file's existing no-semicolon, double-quote-`require` style exactly):

```js
const { undoKillPlayer } = require('./callableFunctions/undoKillPlayer');
exports.undoKillPlayer = undoKillPlayer;
```

So the full file becomes:

```js
const express = require('express');
const cors = require('cors');

var corsOptions = {
    origin: 'http://localhost:3000',
};

const app = express();
app.use(cors({ corsOptions }));

const { killPlayer } = require('./callableFunctions/killPlayer');
exports.killPlayer = killPlayer;

const { undoKillPlayer } = require('./callableFunctions/undoKillPlayer');
exports.undoKillPlayer = undoKillPlayer;

const { joinRoom } = require('./callableFunctions/joinRoom');
exports.joinRoom = joinRoom;

const { cleanupEndedRooms } = require('./scheduledFunctions/cleanupEndedRooms');
exports.cleanupEndedRooms = cleanupEndedRooms;
```

Create `src/components/undoKill.js`:

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const undoKillPlayerCallable = httpsCallable(functions, 'undoKillPlayer');

/**
 * Reverses an approved kill photo's kill in full — the target and every
 * other player killPlayer.js's transaction touched — via one Firestore
 * transaction, server-side
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
 *
 * @throws if the photo is not currently approved, or the caller isn't the
 *   room's host — surfaces as a rejected promise carrying `.message`.
 */
export const undoKill = async (roomID, photoID) => {
    await undoKillPlayerCallable({ roomId: roomID, photoId: photoID });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:emulator -- --testPathPattern=undoKill`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Then: `npx prettier --check "functions/**/*.js"` (expected: only the pre-existing `functions/index.js` warning — check the diff you just wrote to `functions/index.js` doesn't ADD new warnings beyond what was already there; if it does, run `npx prettier --write functions/index.js` and verify the diff only reformats, doesn't change behavior) and `(cd functions && npm run lint)` (expected: clean).
Then run: `npm run test:emulator` in full — expected: all 5 suites (now 6, with the new file) pass. Confirm the exact new total.

- [ ] **Step 6: Commit**

```bash
git add functions/callableFunctions/undoKillPlayer.js functions/index.js src/components/undoKill.js src/components/undoKill.integration.test.js
git commit -m "Add atomic undoKillPlayer Cloud Function and client wrapper"
```

---

### Task 3: Wire `PhotosDisplay.js`'s Undo to the new atomic reversal

**Files:**

- Modify: `src/components/photos_display_component/PhotosDisplay.js` (full current content below)
- Modify: `src/components/photos_display_component/PhotosDisplay.test.jsx` (full current content below)
- Modify: `docs/improvements.md` (add a new tracking item)

**Interfaces:**

- Consumes: `undoKill(roomID, photoID) → Promise<void>` from `src/components/undoKill.js` (Task 2).
- Produces: no new exports — `PhotosDisplay`'s default export and no-props signature are unchanged.

**Current content of `src/components/photos_display_component/PhotosDisplay.js`:**

```jsx
import { Box, Heading, Image } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { gameContext } from '../Contexts';
import {
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    updatePhotoStatusForRoom,
    updatePointsForPlayer,
    updateTargetsForPlayer,
    updateAssassinsForPlayer,
    remapPlayerAsTarget,
} from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import { splitPhotosByStatus } from '../../game/photoJudgments';
import { executeKill } from '../executeKill';
import confirm from '../../assets/enter-green.png';
import deny from '../../assets/red-x.png';
import undo from '../../assets/arrow-left.png';
import GamePhotos from './GamePhotos';
import { executionContext } from '../Contexts';
import CreateAlert from '../CreateAlert';

const PhotosDisplay = () => {
    const [unjudgedPhotos, setUnjudgedPhotos] = useState([]);
    const [judgedPhotos, setJudgedPhotos] = useState([]);
    const { roomID } = useContext(gameContext);
    const {
        handlePlayerRevive,
        addLog,
        handleRemapping,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
    } = useContext(executionContext);
    const createAlert = CreateAlert();

    // Both lists are derived from Firestore on every snapshot, not
    // accumulated locally (docs/improvements.md item 6) — judgedPhotos used
    // to live only in React state, built up as the GM clicked through a
    // session, so reloading the console lost every prior judgment (and the
    // originalPlayerData an undo needs) even though the photo documents
    // were already approved/denied in Firestore. splitPhotosByStatus is the
    // pure, unit-tested piece of this (src/game/photoJudgments.js).
    useEffect(() => {
        const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(
            photosQuery,
            (snapshot) => {
                const allPhotos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                const { unjudged, judged } = splitPhotosByStatus(allPhotos);
                setUnjudgedPhotos(unjudged);
                setJudgedPhotos(judged);
            },
            (error) => {
                console.error('Error fetching photos: ', error);
            }
        );

        return () => unsubscribe();
    }, [roomID]);

    // Approving a photo used to kill the target unconditionally — no check
    // that the assassin was actually hunting them, and no remap of the
    // target's own assassins/targets onto new ones (docs/improvements.md
    // item 5). executeKill now runs the validate/transfer-points/kill/
    // unmap/remap sequence atomically server-side (item 4) — the same
    // Cloud Function /kill (ChatInput.js) calls, so the two paths can't
    // diverge; its preKillSnapshot is exactly the {score, targets,
    // assassins} shape handleUndo below expects as originalPlayerData.
    const handlePass = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto] = unjudgedPhotos;

        try {
            const { preKillSnapshot, addedTargets, addedAssassins, remapLogs } = await executeKill(
                currentPhoto.target,
                currentPhoto.assassin,
                roomID
            );

            // Persists preKillSnapshot onto the photo doc so undo survives a
            // reload (docs/improvements.md item 6) — the onSnapshot listener
            // above picks up the resulting status change and recomputes
            // judgedPhotos, so no local state update is needed here.
            await approvePhotoForRoom(roomID, currentPhoto.id, preKillSnapshot);
            await addLog(
                `${currentPhoto.target} was killed by ${currentPhoto.assassin}`,
                'red.400'
            );

            for (const log of remapLogs) {
                await handleRemapping(log);
            }
            handleAddNewAssassins(addedAssassins);
            handleAddNewTargets(addedTargets);
            handleSetShowMessageToTrue();
        } catch (error) {
            console.error('Error approving photo: ', error);
            createAlert('error', 'Error approving photo', error.message, 1500);
        }
    };

    const handleDeny = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto] = unjudgedPhotos;

        try {
            await updatePhotoStatusForRoom(roomID, currentPhoto.id, 'denied');
            await addLog(
                `${currentPhoto.assassin}'s attempt to kill ${currentPhoto.target} was denied`,
                'gray'
            );
        } catch (error) {
            console.error('Error denying photo: ', error);
            createAlert('error', 'Error denying photo', error.message, 1500);
        }
    };

    const handleUndo = async () => {
        if (judgedPhotos.length === 0) return;

        const last = judgedPhotos[judgedPhotos.length - 1];
        const { photo, action, originalPlayerData } = last;

        try {
            // Step 1: Revert status in Firestore
            await updatePhotoStatusForRoom(roomID, photo.id, 'pending');

            // Step 2: Revert kill if it was approved
            if (action === 'pass') {
                await addLog(
                    `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                    'blue.200'
                );

                await handlePlayerRevive(photo.target);
                await updatePointsForPlayer(photo.target, originalPlayerData.score, roomID);
                await updateTargetsForPlayer(photo.target, originalPlayerData.targets, roomID);
                await updateAssassinsForPlayer(photo.target, originalPlayerData.assassins, roomID);
                await remapPlayerAsTarget(photo.target, roomID, originalPlayerData.assassins);
                // GameMasterView's players subscription (docs/improvements.md
                // item 13) picks up handlePlayerRevive's isAlive write above
                // — no local array mutation needed.
            }

            if (action === 'deny') {
                await addLog(
                    `Undo: denial of ${photo.assassin}'s claim on ${photo.target} was reverted.`,
                    'blue.200'
                );
            }
            // unjudgedPhotos/judgedPhotos update via the onSnapshot listener
            // once the status write above lands — no local update needed.
        } catch (error) {
            console.error('Error undoing photo judgment:', error);
            createAlert('error', 'Error undoing photo judgment', error.message, 1500);
        }
    };

    return (
        <>
            <Box sx={styles.photosContainer}>
                <Heading size="lg" m="4px">
                    Photos
                </Heading>
                <Box sx={styles.photosBox}>
                    <GamePhotos photo={unjudgedPhotos[0]} />
                </Box>
                <Box sx={styles.buttonsBox}>
                    <Image src={deny} alt="Deny" sx={styles.buttonImage} onClick={handleDeny} />
                    <Image src={undo} alt="Undo" sx={styles.buttonImage} onClick={handleUndo} />
                    <Image
                        src={confirm}
                        alt="Approve"
                        sx={styles.buttonImage}
                        onClick={handlePass}
                    />
                </Box>
            </Box>
        </>
    );
};

const styles = {
    photosContainer: {
        h: '100%',
        w: '100%',
        borderWidth: 2,
        borderRadius: '3xl',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    photosBox: {
        w: '94%',
        h: '75%',
        textAlign: 'center',
        flexGrow: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginX: '2px',
        borderWidth: 1,
    },
    buttonsBox: {
        display: 'flex',
        flexDirection: 'row',
        w: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonImage: {
        w: '10%',
        m: '4px',
        marginX: '30px',
        transition: 'opacity 0.3s',
        '&:hover': {
            opacity: 0.7,
        },
    },
};
export default PhotosDisplay;
```

**Current content of `src/components/photos_display_component/PhotosDisplay.test.jsx`:**

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 6 end to end: judgedPhotos is now derived
 * from Firestore on every snapshot (via src/game/photoJudgments.js), not
 * accumulated in local state. This proves the actual bug scenario — undo
 * works for a photo judged in an *earlier* session, reconstructed purely
 * from what onSnapshot reports on mount, never clicked through here.
 *
 * `executeKill` is a thin wrapper around a Cloud Function call now
 * (docs/improvements.md item 4) — validation, scoring, unmapping, and
 * remapping all happen server-side, so this mocks `executeKill` itself
 * rather than the individual Firestore calls it used to make.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import PhotosDisplay from './PhotosDisplay';
import { gameContext, executionContext } from '../Contexts';
import * as dbCalls from '../firebase_calls/dbCalls';
import { executeKill } from '../executeKill';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../firebase_calls/dbCalls', () => ({
    approvePhotoForRoom: jest.fn(),
    fetchPhotosQueryByAscendingTimestampForRoom: jest.fn(() => 'photos-query'),
    remapPlayerAsTarget: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updatePhotoStatusForRoom: jest.fn(),
    updatePointsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));

const executionHandlers = {
    handlePlayerRevive: jest.fn(),
    addLog: jest.fn(),
    handleRemapping: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
};

/** Simulates the given photo docs as what onSnapshot reports immediately on mount. */
const mountWithSnapshot = (photoDocs) => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: photoDocs.map((data, i) => ({ id: `photo-${i}`, data: () => data })),
        });
        return () => {};
    });

    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <PhotosDisplay />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );
};

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.updatePhotoStatusForRoom.mockResolvedValue(undefined);
    dbCalls.updatePointsForPlayer.mockResolvedValue(undefined);
    dbCalls.updateTargetsForPlayer.mockResolvedValue(undefined);
    dbCalls.updateAssassinsForPlayer.mockResolvedValue(undefined);
    dbCalls.remapPlayerAsTarget.mockResolvedValue(undefined);
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        preKillSnapshot: { score: 0, targets: [], assassins: [] },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});

describe('reconstructing judged photos from Firestore (improvements item 6)', () => {
    it('can undo a photo approved in an earlier session, using its persisted snapshot', async () => {
        // Nothing was clicked in this render — this photo's approval and its
        // originalPlayerData snapshot both come purely from what Firestore
        // reports, simulating a reload after the approval happened earlier.
        mountWithSnapshot([
            {
                status: 'approved',
                target: 'alice',
                assassin: 'bob',
                originalPlayerData: { score: 7, targets: ['carol'], assassins: ['dave'] },
            },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        // updateAssassinsForPlayer is the last await in handleUndo's success
        // path, so waiting for it means the whole chain has settled.
        await waitFor(() => expect(dbCalls.updateAssassinsForPlayer).toHaveBeenCalled());

        expect(dbCalls.updatePhotoStatusForRoom).toHaveBeenCalledWith(
            'room-a',
            'photo-0',
            'pending'
        );
        expect(executionHandlers.handlePlayerRevive).toHaveBeenCalledWith('alice');
        expect(dbCalls.updatePointsForPlayer).toHaveBeenCalledWith('alice', 7, 'room-a');
        expect(dbCalls.updateTargetsForPlayer).toHaveBeenCalledWith('alice', ['carol'], 'room-a');
        expect(dbCalls.updateAssassinsForPlayer).toHaveBeenCalledWith('alice', ['dave'], 'room-a');
    });

    it('does nothing when there is no judged photo to undo', async () => {
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Undo'));

        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });
});

describe('approving a photo persists the undo snapshot (improvements item 6)', () => {
    it('calls executeKill and persists its preKillSnapshot', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: { score: 12, targets: ['x'], assassins: ['y'] },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
        expect(dbCalls.approvePhotoForRoom).toHaveBeenCalledWith('room-a', 'photo-0', {
            score: 12,
            targets: ['x'],
            assassins: ['y'],
        });
    });

    it('passes remapLogs, addedTargets, and addedAssassins through to their handlers', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: { score: 0, targets: [], assassins: [] },
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
    });
});

describe('a photo approval executeKill rejects is not applied (improvements item 5)', () => {
    it('leaves the photo pending and shows an alert instead of killing anyway', async () => {
        // The bug this item fixes: photo approval used to kill
        // unconditionally, with no check that the assassin was actually
        // hunting the target.
        executeKill.mockRejectedValue(new Error('alice is not a valid target for bob'));
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        expect(await screen.findByText(/alice is not a valid target for bob/i)).toBeInTheDocument();
        expect(dbCalls.approvePhotoForRoom).not.toHaveBeenCalled();
    });
});
```

**Only the first `describe` block (`'reconstructing judged photos from Firestore'`) and the mock setup at the top change.** The `'approving a photo persists the undo snapshot'` and `'a photo approval executeKill rejects is not applied'` blocks test `handlePass`, which this task does not touch — leave both completely unchanged, including their `preKillSnapshot` mock shapes (still the old flat shape — irrelevant to what they're testing, which is pure passthrough plumbing, not the shape's real-world correctness).

- [ ] **Step 1: Write the failing test**

In `src/components/photos_display_component/PhotosDisplay.test.jsx`:

Replace the mock block:

```jsx
// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../firebase_calls/dbCalls', () => ({
    approvePhotoForRoom: jest.fn(),
    fetchPhotosQueryByAscendingTimestampForRoom: jest.fn(() => 'photos-query'),
    remapPlayerAsTarget: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updatePhotoStatusForRoom: jest.fn(),
    updatePointsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));
```

with:

```jsx
// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../firebase_calls/dbCalls', () => ({
    approvePhotoForRoom: jest.fn(),
    fetchPhotosQueryByAscendingTimestampForRoom: jest.fn(() => 'photos-query'),
    updatePhotoStatusForRoom: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));
jest.mock('../undoKill', () => ({ undoKill: jest.fn() }));
```

Add the import (alongside the existing `import { executeKill } from '../executeKill';`):

```jsx
import { undoKill } from '../undoKill';
```

Replace the `executionHandlers` object:

```jsx
const executionHandlers = {
    handlePlayerRevive: jest.fn(),
    addLog: jest.fn(),
    handleRemapping: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
};
```

with:

```jsx
const executionHandlers = {
    addLog: jest.fn(),
    handleRemapping: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
};
```

Replace the `beforeEach`:

```jsx
beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.updatePhotoStatusForRoom.mockResolvedValue(undefined);
    dbCalls.updatePointsForPlayer.mockResolvedValue(undefined);
    dbCalls.updateTargetsForPlayer.mockResolvedValue(undefined);
    dbCalls.updateAssassinsForPlayer.mockResolvedValue(undefined);
    dbCalls.remapPlayerAsTarget.mockResolvedValue(undefined);
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        preKillSnapshot: { score: 0, targets: [], assassins: [] },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});
```

with:

```jsx
beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.updatePhotoStatusForRoom.mockResolvedValue(undefined);
    undoKill.mockResolvedValue(undefined);
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        preKillSnapshot: { score: 0, targets: [], assassins: [] },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});
```

Replace the first `describe` block entirely:

```jsx
describe('reconstructing judged photos from Firestore (improvements item 6)', () => {
    it('can undo a photo approved in an earlier session, using its persisted snapshot', async () => {
        // Nothing was clicked in this render — this photo's approval and its
        // originalPlayerData snapshot both come purely from what Firestore
        // reports, simulating a reload after the approval happened earlier.
        mountWithSnapshot([
            {
                status: 'approved',
                target: 'alice',
                assassin: 'bob',
                originalPlayerData: {
                    alice: { score: 7, targets: ['carol'], assassins: ['dave'], isAlive: true },
                },
            },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        // The reversal (score/targets/assassins/isAlive, for every player
        // killPlayer.js's transaction touched) now happens entirely inside
        // the atomic undoKillPlayer Cloud Function — the client only needs
        // to trigger it and log the result
        // (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
        await waitFor(() => expect(undoKill).toHaveBeenCalledWith('room-a', 'photo-0'));
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            "Undo: alice's death by bob was reverted",
            'blue.200'
        );
        // updatePhotoStatusForRoom is only for the deny-undo path now —
        // undoKillPlayer's own transaction already resets status to
        // 'pending' for an approval-undo.
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });

    it('does nothing when there is no judged photo to undo', async () => {
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Undo'));

        expect(undoKill).not.toHaveBeenCalled();
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });

    it('reverts a denied judgment by resetting status to pending, without calling undoKill', async () => {
        mountWithSnapshot([
            { status: 'denied', target: 'alice', assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        await waitFor(() =>
            expect(dbCalls.updatePhotoStatusForRoom).toHaveBeenCalledWith(
                'room-a',
                'photo-0',
                'pending'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            "Undo: denial of bob's claim on alice was reverted.",
            'blue.200'
        );
        expect(undoKill).not.toHaveBeenCalled();
    });
});
```

(The third test, for `action === 'deny'`, is new — the old file had no dedicated test for this branch at all; it's cheap to add now that `handleUndo` is being touched, and it pins the one behavior this task must NOT change.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/photos_display_component/PhotosDisplay.test.jsx`
Expected: FAIL — `undoKill` module doesn't exist yet from this test file's perspective until Task 2 lands (should already exist if Task 2 is complete — if this task is executed after Task 2, the failure instead comes from `PhotosDisplay.js` not yet importing/calling `undoKill`, so `undoKill` mock is never invoked and the `toHaveBeenCalledWith` assertions fail).

- [ ] **Step 3: Write the implementation**

Replace the full content of `src/components/photos_display_component/PhotosDisplay.js` with:

```jsx
import { Box, Heading, Image } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { gameContext } from '../Contexts';
import {
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    updatePhotoStatusForRoom,
} from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import { splitPhotosByStatus } from '../../game/photoJudgments';
import { executeKill } from '../executeKill';
import { undoKill } from '../undoKill';
import confirm from '../../assets/enter-green.png';
import deny from '../../assets/red-x.png';
import undo from '../../assets/arrow-left.png';
import GamePhotos from './GamePhotos';
import { executionContext } from '../Contexts';
import CreateAlert from '../CreateAlert';

const PhotosDisplay = () => {
    const [unjudgedPhotos, setUnjudgedPhotos] = useState([]);
    const [judgedPhotos, setJudgedPhotos] = useState([]);
    const { roomID } = useContext(gameContext);
    const {
        addLog,
        handleRemapping,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
    } = useContext(executionContext);
    const createAlert = CreateAlert();

    // Both lists are derived from Firestore on every snapshot, not
    // accumulated locally (docs/improvements.md item 6) — judgedPhotos used
    // to live only in React state, built up as the GM clicked through a
    // session, so reloading the console lost every prior judgment (and the
    // originalPlayerData an undo needs) even though the photo documents
    // were already approved/denied in Firestore. splitPhotosByStatus is the
    // pure, unit-tested piece of this (src/game/photoJudgments.js).
    useEffect(() => {
        const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(
            photosQuery,
            (snapshot) => {
                const allPhotos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                const { unjudged, judged } = splitPhotosByStatus(allPhotos);
                setUnjudgedPhotos(unjudged);
                setJudgedPhotos(judged);
            },
            (error) => {
                console.error('Error fetching photos: ', error);
            }
        );

        return () => unsubscribe();
    }, [roomID]);

    // Approving a photo used to kill the target unconditionally — no check
    // that the assassin was actually hunting them, and no remap of the
    // target's own assassins/targets onto new ones (docs/improvements.md
    // item 5). executeKill now runs the validate/transfer-points/kill/
    // unmap/remap sequence atomically server-side (item 4) — the same
    // Cloud Function /kill (ChatInput.js) calls, so the two paths can't
    // diverge; its preKillSnapshot is exactly the map of every touched
    // player's pre-kill data that undoKillPlayer needs to fully reverse a
    // kill (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
    const handlePass = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto] = unjudgedPhotos;

        try {
            const { preKillSnapshot, addedTargets, addedAssassins, remapLogs } = await executeKill(
                currentPhoto.target,
                currentPhoto.assassin,
                roomID
            );

            // Persists preKillSnapshot onto the photo doc so undo survives a
            // reload (docs/improvements.md item 6) — the onSnapshot listener
            // above picks up the resulting status change and recomputes
            // judgedPhotos, so no local state update is needed here.
            await approvePhotoForRoom(roomID, currentPhoto.id, preKillSnapshot);
            await addLog(
                `${currentPhoto.target} was killed by ${currentPhoto.assassin}`,
                'red.400'
            );

            for (const log of remapLogs) {
                await handleRemapping(log);
            }
            handleAddNewAssassins(addedAssassins);
            handleAddNewTargets(addedTargets);
            handleSetShowMessageToTrue();
        } catch (error) {
            console.error('Error approving photo: ', error);
            createAlert('error', 'Error approving photo', error.message, 1500);
        }
    };

    const handleDeny = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto] = unjudgedPhotos;

        try {
            await updatePhotoStatusForRoom(roomID, currentPhoto.id, 'denied');
            await addLog(
                `${currentPhoto.assassin}'s attempt to kill ${currentPhoto.target} was denied`,
                'gray'
            );
        } catch (error) {
            console.error('Error denying photo: ', error);
            createAlert('error', 'Error denying photo', error.message, 1500);
        }
    };

    // For an approved kill, the full reversal (every player killPlayer.js's
    // transaction touched, not just the target) now happens atomically
    // inside undoKillPlayer, which also resets the photo's status back to
    // pending as part of the same transaction — so this function no longer
    // needs to know anything about individual player fields, and no longer
    // calls updatePhotoStatusForRoom for that path
    // (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). A
    // denied judgment never touched player data, so undoing one is still
    // just a status reset here.
    const handleUndo = async () => {
        if (judgedPhotos.length === 0) return;

        const last = judgedPhotos[judgedPhotos.length - 1];
        const { photo, action } = last;

        try {
            if (action === 'pass') {
                await undoKill(roomID, photo.id);
                await addLog(
                    `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                    'blue.200'
                );
            }

            if (action === 'deny') {
                await updatePhotoStatusForRoom(roomID, photo.id, 'pending');
                await addLog(
                    `Undo: denial of ${photo.assassin}'s claim on ${photo.target} was reverted.`,
                    'blue.200'
                );
            }
            // unjudgedPhotos/judgedPhotos update via the onSnapshot listener
            // once the writes above land — no local update needed.
        } catch (error) {
            console.error('Error undoing photo judgment:', error);
            createAlert('error', 'Error undoing photo judgment', error.message, 1500);
        }
    };

    return (
        <>
            <Box sx={styles.photosContainer}>
                <Heading size="lg" m="4px">
                    Photos
                </Heading>
                <Box sx={styles.photosBox}>
                    <GamePhotos photo={unjudgedPhotos[0]} />
                </Box>
                <Box sx={styles.buttonsBox}>
                    <Image src={deny} alt="Deny" sx={styles.buttonImage} onClick={handleDeny} />
                    <Image src={undo} alt="Undo" sx={styles.buttonImage} onClick={handleUndo} />
                    <Image
                        src={confirm}
                        alt="Approve"
                        sx={styles.buttonImage}
                        onClick={handlePass}
                    />
                </Box>
            </Box>
        </>
    );
};

const styles = {
    photosContainer: {
        h: '100%',
        w: '100%',
        borderWidth: 2,
        borderRadius: '3xl',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    photosBox: {
        w: '94%',
        h: '75%',
        textAlign: 'center',
        flexGrow: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginX: '2px',
        borderWidth: 1,
    },
    buttonsBox: {
        display: 'flex',
        flexDirection: 'row',
        w: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonImage: {
        w: '10%',
        m: '4px',
        marginX: '30px',
        transition: 'opacity 0.3s',
        '&:hover': {
            opacity: 0.7,
        },
    },
};
export default PhotosDisplay;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/photos_display_component/PhotosDisplay.test.jsx`
Expected: PASS — 6/6 tests.

- [ ] **Step 5: Add the backlog tracking note**

Check the current highest item number in `docs/improvements.md` (run `grep -n "^### [0-9]" docs/improvements.md | tail -3` — expected to show item 48 as the highest at the time of writing this plan; use the next number after whatever is actually highest when you run it). Read item 47's exact heading/body format first (`### 47. \`addPlayerForRoom\` is now unreferenced by any production code path`) to match its tone precisely, then add a new item, inserted after the last existing item and before the `---`/`## Suggested sequencing` divider near the end of the file:

```markdown
### 49. `remapPlayerAsTarget` is now unreferenced by any production code path

**Impact: low (informational) · Effort: —**

The 2026-08-16 full-kill-undo redesign
(`docs/superpowers/specs/2026-08-16-full-kill-undo-design.md`) replaced
`PhotosDisplay.js`'s five separate client-side writes for undoing an
approved kill (including a call to `remapPlayerAsTarget`) with one atomic
`undoKillPlayer` Cloud Function call — the client no longer reconstructs
any part of the reversal itself. Deleting `remapPlayerAsTarget` was
explicitly out of scope for that change (mirroring how `addPlayerForRoom`
was handled in item 47), so it was left in place.

As of this writing, `remapPlayerAsTarget`
(`src/components/firebase_calls/dbCalls.js`) has zero callers anywhere in
`src/` outside its own definition. Not urgent — nothing is broken, and the
function costs nothing sitting unused — but worth tracking rather than
rediscovering later.
```

(Use whatever number is actually next when you run the grep above — 49 is the expected value based on 48 being the current highest, but verify rather than assume.)

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/photos_display_component/PhotosDisplay.js src/components/photos_display_component/PhotosDisplay.test.jsx docs/improvements.md
git commit -m "Wire PhotosDisplay Undo to the atomic full-kill-undo Cloud Function"
```

---

## Self-Review Notes

- **Spec coverage:** "Mirror killPlayer.js's own pattern" (atomic transaction, host-checked) → Task 2's `undoKillPlayer.js`. "killPlayer.js needs to capture pre-write state of every touched player" → Task 1. "handlePass needs no code changes" → confirmed unchanged across all three tasks (only its test file's unrelated blocks are explicitly preserved, not touched). "Only the pass half of handleUndo changes" → Task 3, with a new test (`reverts a denied judgment...`) pinning that the deny half stays behaviorally identical. "No backward compatibility" → no fallback/shape-detection code written anywhere. "remapPlayerAsTarget tracked, not deleted" → Task 3 Step 5.
- **Placeholder scan:** none — every step has complete, concrete code, including a hand-derived (not hand-waved) expected value for the one changed assertion in Task 1.
- **Type consistency:** `undoKill(roomID, photoID)`'s signature matches between Task 2's definition and Task 3's call site (`undoKill(roomID, photo.id)`). `preKillSnapshot`'s new map shape (`{ [normalizedName]: { score, targets, assassins, isAlive } }`) is used identically by Task 1 (producer) and Task 2 (consumer, via `photoData.originalPlayerData`).
