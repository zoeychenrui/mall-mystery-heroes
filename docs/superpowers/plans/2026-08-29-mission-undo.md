# Mission Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GM undo the most recent mission completion, whether it happened via `/mission done` or by approving a photo, mirroring how kill-undo already works.

**Architecture:** Mission completion moves from client-orchestrated to two new server-side Cloud Functions (`completeMission`, `undoMissionCompletion`) that mirror `killPlayer.js`/`undoKillPlayer.js`'s exact atomic-transaction, snapshot-then-return pattern. Two independent "last completion" trackers — one on the photo doc (extending the existing Undo button), one on the room doc (new `/mission undo` command) — both consuming the same reversal snapshot shape and the same shared server-side reversal logic.

**Tech Stack:** Firebase Cloud Functions (Admin SDK), React (CRA), Firestore.

**Spec:** `docs/superpowers/specs/2026-08-29-mission-undo-design.md`

## Global Constraints

- Tasks 1 and 2 (the two new Cloud Functions) require `npm run test:emulator` to pass, not `npm test` — they are the only Cloud-Function-touching tasks in this plan.
- Every other task's correctness gate is the standard four-step gate from this repo's CLAUDE.md: `npm run format`, `npm run lint` (`--max-warnings=0`), `npm test`, `npm run build`. Run the full gate, not just the touched test file, before a task is considered done.
- `functions/scripts/sync-shared-game-logic.js` must be re-run (or `npm run test:emulator` re-run, which runs it automatically as a pretest step) after any change under `functions/` or to a file it vendors from `src/game/`.
- Every new Cloud Function throws `HttpsError`s on every failure path — never swallow an error or return a partial/ambiguous success (`docs/improvements.md` item 10's convention).
- Both undo entry points (Tasks 5 and 6) announce an undone mission completion with the identical wording — do not let them drift into two different phrasings.
- `admin.firestore.FieldValue`/`admin.firestore.Timestamp` must not be used directly in any new Cloud Function file — import `{ FieldValue }` from `firebase-admin/firestore` instead (the top-level `admin.firestore` property is wrapped in a way that strips static properties under the Functions emulator; `joinRoom.js` and `submitKillPhoto.js` already carry this exact comment and pattern — copy it).

---

### Task 1: `functions/callableFunctions/completeMission.js` — the server-side completion Cloud Function

**Files:**

- Create: `functions/callableFunctions/completeMission.js`
- Create: `src/components/completeMissionCallable.integration.test.js`
- Modify: `functions/scripts/sync-shared-game-logic.js`
- Modify: `functions/index.js` (or wherever Cloud Functions are exported from — check this file's current export list before assuming its name/shape)

**Interfaces:**

- Consumes: `planMissionCompletion` (vendored from `src/game/missionCompletion.js`), `planRemap` (already vendored at `functions/vendor/game/remapPlan.js`), `playersNeedingConnections` (already vendored at `functions/vendor/game/targetGraph.js`), `normalizePlayerName` (already vendored at `functions/vendor/game/playerNames.js`).
- Produces: the `completeMission` callable, taking `{ missionIndex, playerName, roomId }` and returning `{ reversalSnapshot: { missionIndex, playerName, wasAutoEnded, players }, addedTargets, addedAssassins, remapLogs }`. Tasks 2, 4, 5, and 6 all depend on this exact shape.

- [ ] **Step 1: Vendor `planMissionCompletion`**

Read `functions/scripts/sync-shared-game-logic.js` in full first — it currently vendors `remapPlan.js`, `playerNames.js`, `targetGraph.js`, `rateLimit.js`, `killPhotoUrl.js` via a `FILES` array. Add `'missionCompletion.js'` to that array:

```js
const FILES = [
    'remapPlan.js',
    'playerNames.js',
    'targetGraph.js',
    'rateLimit.js',
    'killPhotoUrl.js',
    'missionCompletion.js',
];
```

Run: `node functions/scripts/sync-shared-game-logic.js`
Expected: console output lists `missionCompletion.js` among the synced files, and `functions/vendor/game/missionCompletion.js` now exists on disk (it's gitignored — this is a regenerated build artifact, not something to `git add`).

- [ ] **Step 2: Write the failing emulator tests**

Create `src/components/completeMissionCallable.integration.test.js`. This calls the new Cloud Function directly via `httpsCallable`, the same way `executeKill.integration.test.js` calls `killPlayer` — read that file's full structure first (already read this session) to match its exact style, then write:

```js
/**
 * Layer 1b — the atomic mission-completion Cloud Function, against the
 * real Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. There is no client wrapper yet (Task 4
 * adds one) — these tests call `httpsCallable(functions, 'completeMission')`
 * directly, the same way executeKill.integration.test.js calls killPlayer
 * before executeKill.js existed, then assert on what actually landed in
 * Firestore (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../utils/firebase';

const ROOM = 'test-room';
const completeMissionCallable = httpsCallable(functions, 'completeMission');

beforeEach(clearFirestore);
afterAll(shutdown);

const seedTask = async (task) => {
    const tasksRef = collection(db, 'rooms', ROOM, 'tasks');
    await addDoc(tasksRef, {
        title: 'Find the clue',
        description: 'Look around',
        taskType: 'Task',
        pointValue: '10',
        maxCompletions: null,
        isComplete: false,
        completedBy: [],
        dateCreated: '12:00',
        ...task,
    });
};

const fetchTask = async (taskIndex) => {
    const tasksRef = collection(db, 'rooms', ROOM, 'tasks');
    const snapshot = await getDocs(query(tasksRef, where('taskIndex', '==', taskIndex)));
    return snapshot.docs[0].data();
};

describe('completeMission', () => {
    it('awards points for a Task completion and returns a snapshot naming only the completing player', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 1 });

        const { data } = await completeMissionCallable({
            missionIndex: 1,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
        expect((await fetchTask(1)).completedBy).toEqual(['alice']);
        expect(data.reversalSnapshot).toEqual({
            missionIndex: 1,
            playerName: 'alice',
            wasAutoEnded: false,
            players: {
                alice: { score: 5, targets: [], assassins: [], isAlive: true, openSeason: false },
            },
        });
    });

    it('revives the player for a Revival Mission completion and reassigns targets for everyone the regen touched', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', isAlive: false, score: 0 },
            { name: 'bob', targets: [], assassins: [] },
        ]);
        await seedTask({ taskIndex: 2, taskType: 'Revival Mission', pointValue: '0' });

        const { data } = await completeMissionCallable({
            missionIndex: 2,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().isAlive).toBe(true);
        // bob is the only other alive player, so the revived alice must
        // have been assigned to bob (or vice versa) — proves the regen
        // step actually ran, not just the revival flag flip.
        expect(data.addedTargets).toBeDefined();
        const bobAfter = (await fetchPlayerForRoom('bob', ROOM)).data();
        const aliceAfter = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect([...bobAfter.targets, ...aliceAfter.targets].length).toBeGreaterThan(0);
        // The snapshot must name every player the regen touched, not just alice.
        expect(Object.keys(data.reversalSnapshot.players)).toEqual(
            expect.arrayContaining(['alice', 'bob'])
        );
    });

    it('sets isComplete and wasAutoEnded once maxCompletions is reached', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        await seedTask({ taskIndex: 3, maxCompletions: 1 });

        const { data } = await completeMissionCallable({
            missionIndex: 3,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchTask(3)).isComplete).toBe(true);
        expect(data.reversalSnapshot.wasAutoEnded).toBe(true);
    });

    it('does not set wasAutoEnded when maxCompletions is not yet reached', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', score: 0 },
            { name: 'bob', score: 0 },
        ]);
        await seedTask({ taskIndex: 4, maxCompletions: 2 });

        const { data } = await completeMissionCallable({
            missionIndex: 4,
            playerName: 'alice',
            roomId: ROOM,
        });

        expect((await fetchTask(4)).isComplete).toBe(false);
        expect(data.reversalSnapshot.wasAutoEnded).toBe(false);
    });

    it('rejects an invalid mission index and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);

        await expect(
            completeMissionCallable({ missionIndex: 99, playerName: 'alice', roomId: ROOM })
        ).rejects.toThrow('Invalid task index');
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(0);
    });

    it('rejects a Revival Mission completion for a player who is not dead, and writes nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice', isAlive: true, score: 0 }]);
        await seedTask({ taskIndex: 5, taskType: 'Revival Mission', pointValue: '0' });

        await expect(
            completeMissionCallable({ missionIndex: 5, playerName: 'alice', roomId: ROOM })
        ).rejects.toThrow('is not dead');
        expect((await fetchTask(5)).completedBy).toEqual([]);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        await seedTask({ taskIndex: 6 });
        const callAsNonHost = callableAsNonHost('completeMission');

        await expect(
            callAsNonHost({ missionIndex: 6, playerName: 'alice', roomId: ROOM })
        ).rejects.toThrow(/permission-denied|host/i);
        expect((await fetchTask(6)).completedBy).toEqual([]);
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node functions/scripts/sync-shared-game-logic.js && npm run test:emulator`
Expected: FAIL — `completeMission` is not a deployed function yet (the callable itself does not exist).

- [ ] **Step 4: Write the Cloud Function**

Read `functions/callableFunctions/killPlayer.js` and `functions/callableFunctions/joinRoom.js` in full immediately before writing this — both are already read this session, but re-read them now since this step must match their exact conventions (the `FieldValue` subpath import, the `preWriteDataByName`/`captureSnapshot`/`pendingUpdates`/`queueUpdate` pattern, the host-check shape) precisely, not from memory.

Create `functions/callableFunctions/completeMission.js`:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue — see
// joinRoom.js's identical comment for why (the Functions emulator strips
// static properties off the top-level admin.firestore binding).
const { FieldValue } = require('firebase-admin/firestore');
// Vendored copies, not '../../src/game/...' — Cloud Functions deploy
// uploads only the functions/ directory in isolation. Kept in sync by
// functions/scripts/sync-shared-game-logic.js — src/game/ remains the
// single source of truth.
const { planRemap } = require('../vendor/game/remapPlan');
const { normalizePlayerName } = require('../vendor/game/playerNames');
const { playersNeedingConnections } = require('../vendor/game/targetGraph');
const { planMissionCompletion } = require('../vendor/game/missionCompletion');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The atomic, server-side replacement for the client-side completeMission
 * orchestration this session's mission-completion-via-photo feature
 * originally shipped — records a mission completion (award points, or
 * revive-and-regenerate-targets) and returns a snapshot of everything it
 * touched, mirroring killPlayer.js's own preKillSnapshot pattern, so a
 * caller can persist that snapshot for later undo
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 *
 * Unlike killPlayer.js (which derives the assassin from context.auth.uid),
 * `playerName` here is caller-supplied for both callers of this function —
 * ChatInput.js's /mission done and PhotosDisplay.js's photo-approval flow —
 * since in both cases it is the GM/host deciding who completed the
 * mission, not the completing player submitting their own claim.
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here.
 */
exports.completeMission = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { missionIndex, playerName, roomId } = data;
    if (missionIndex === undefined || missionIndex === null || !playerName || !roomId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'missionIndex, playerName, and roomId are all required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');
        const tasksRef = roomRef.collection('tasks');

        // --- read phase: every read finishes before any write starts ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can complete a mission.'
            );
        }

        const normalizedPlayerName = normalizePlayerName(playerName);

        const taskSnapshot = await transaction.get(tasksRef.where('taskIndex', '==', missionIndex));
        const taskDoc = taskSnapshot.empty ? null : taskSnapshot.docs[0];
        const task = taskDoc ? taskDoc.data() : null;

        let isPlayerDead = false;
        if (task && task.taskType === 'Revival Mission') {
            const deadSnapshot = await transaction.get(playersRef.where('isAlive', '==', false));
            isPlayerDead = deadSnapshot.docs.some(
                (doc) => doc.data().trimmedNameLowerCase === normalizedPlayerName
            );
        }

        const plan = planMissionCompletion(task, normalizedPlayerName, { isPlayerDead });
        if (plan.error) {
            throw new functions.https.HttpsError('failed-precondition', plan.error);
        }

        const playerSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizedPlayerName)
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${playerName}`);
        }
        const playerDoc = playerSnapshot.docs[0];
        const playerData = playerDoc.data();

        // The alive roster (for target regeneration) is only needed for a
        // revival — reading it unconditionally would be wasted work and an
        // unnecessary transaction dependency for the common Task case.
        let rosterSnapshot = null;
        if (plan.revivesPlayer) {
            rosterSnapshot = await transaction.get(playersRef.where('isAlive', '==', true));
        }

        // --- decide, in memory — no more reads below this point ---

        const preWriteDataByName = new Map();
        const captureSnapshot = (name, snapshotData) => {
            const key = normalizePlayerName(name);
            if (!preWriteDataByName.has(key)) {
                preWriteDataByName.set(key, {
                    score: snapshotData.score ?? 0,
                    targets: snapshotData.targets || [],
                    assassins: snapshotData.assassins || [],
                    isAlive: snapshotData.isAlive,
                    openSeason: snapshotData.openSeason ?? false,
                });
            }
        };
        captureSnapshot(normalizedPlayerName, playerData);

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

        let addedTargets = {};
        let addedAssassins = {};
        let remapLogs = [];

        if (plan.awardsPoints !== null) {
            queueUpdate(normalizedPlayerName, playerDoc.ref, {
                score: (playerData.score || 0) + plan.awardsPoints,
            });
        }

        if (plan.revivesPlayer) {
            queueUpdate(normalizedPlayerName, playerDoc.ref, { isAlive: true });

            const rosterDocsByName = new Map();
            const roster = [];
            for (const doc of rosterSnapshot.docs) {
                const docData = doc.data();
                rosterDocsByName.set(normalizePlayerName(docData.name), doc);
                captureSnapshot(docData.name, docData);
                roster.push({
                    name: docData.name,
                    targets: docData.targets || [],
                    assassins: docData.assassins || [],
                });
            }
            // The revived player isn't in rosterSnapshot yet — their
            // isAlive:true write above hasn't landed within this
            // transaction — so they're added manually, with no
            // targets/assassins yet, matching the state planRemap needs
            // to see to correctly treat them as needing both.
            rosterDocsByName.set(normalizedPlayerName, playerDoc);
            roster.push({ name: playerData.name, targets: [], assassins: [] });

            const { needTargets, needAssassins } = playersNeedingConnections(roster);
            const remapPlanResult = planRemap(roster, { needTargets, needAssassins });

            for (const write of remapPlanResult.writes) {
                const doc = rosterDocsByName.get(normalizePlayerName(write.player));
                if (!doc) continue; // defensive; every write came from `roster`
                queueUpdate(write.player, doc.ref, {
                    targets: write.targets,
                    assassins: write.assassins,
                });
            }
            addedTargets = remapPlanResult.added.targets;
            addedAssassins = remapPlanResult.added.assassins;
            remapLogs = remapPlanResult.logs;
        }

        const reversalSnapshotPlayers = {};
        for (const key of pendingUpdates.keys()) {
            const snapshot = preWriteDataByName.get(key);
            if (snapshot) reversalSnapshotPlayers[key] = snapshot;
        }

        // --- write phase ---

        const taskUpdates = { completedBy: FieldValue.arrayUnion(normalizedPlayerName) };
        if (plan.autoEnds) {
            taskUpdates.isComplete = true;
        }
        transaction.update(taskDoc.ref, taskUpdates);

        for (const { ref, fields } of pendingUpdates.values()) {
            transaction.update(ref, fields);
        }

        return {
            reversalSnapshot: {
                missionIndex,
                playerName: normalizedPlayerName,
                wasAutoEnded: plan.autoEnds,
                players: reversalSnapshotPlayers,
            },
            addedTargets,
            addedAssassins,
            remapLogs,
        };
    });
});
```

Read the current `functions/index.js` (or equivalent entry file — check `firebase.json`'s `functions[0].source`/`main` field if the filename isn't obvious) to see how `killPlayer`/`undoKillPlayer`/etc. are re-exported, and add `completeMission` to that same export list following its exact existing pattern.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node functions/scripts/sync-shared-game-logic.js && npm run test:emulator`
Expected: PASS, all 7 new tests, plus every pre-existing emulator suite still green.

- [ ] **Step 6: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean (aside from the known pre-existing `MessageComposer.test.jsx` full-suite parallel-load flake — confirm by running it in isolation if it's the only failure: `npx jest src/components/player_messages_components/MessageComposer.test.jsx`, expect 29/29).

- [ ] **Step 7: Commit**

```bash
git add functions/callableFunctions/completeMission.js functions/scripts/sync-shared-game-logic.js functions/index.js src/components/completeMissionCallable.integration.test.js
git commit -m "Add the atomic completeMission Cloud Function"
```

---

### Task 2: `functions/callableFunctions/undoMissionCompletion.js` — the shared server-side reversal

**Files:**

- Create: `functions/callableFunctions/undoMissionCompletion.js`
- Create: `src/components/undoMissionCompletionCallable.integration.test.js`
- Modify: `functions/index.js` (add the two new exports)

**Interfaces:**

- Consumes: the `reversalSnapshot` shape Task 1's `completeMission` returns (`{ missionIndex, playerName, wasAutoEnded, players }`).
- Produces: two callables — `undoMissionPhotoApproval` (`{ roomId, photoId }` → void) and `undoMissionCommand` (`{ roomId }` → void). Tasks 4, 5, and 6 depend on these two callable names and argument shapes.

- [ ] **Step 1: Write the failing emulator tests**

Read `functions/callableFunctions/undoKillPlayer.js` and `src/components/undoKill.integration.test.js` in full immediately before this step (both already read this session) — this task's tests follow that file's exact `seedPendingPhoto`-style helper pattern, adapted for missions.

Create `src/components/undoMissionCompletionCallable.integration.test.js`:

```js
/**
 * Layer 1b — the atomic mission-undo Cloud Functions, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. There is no client wrapper yet (Task 4
 * adds one) — these tests call httpsCallable directly, the same way
 * undoKill.integration.test.js calls undoKillPlayer before undoKill.js
 * existed, then assert on what actually landed in Firestore
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 */
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../utils/firebase';
import { collection, addDoc, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';
const completeMissionCallable = httpsCallable(functions, 'completeMission');
const undoMissionPhotoApprovalCallable = httpsCallable(functions, 'undoMissionPhotoApproval');
const undoMissionCommandCallable = httpsCallable(functions, 'undoMissionCommand');

beforeEach(clearFirestore);
afterAll(shutdown);

const seedTask = async (task) => {
    const tasksRef = collection(db, 'rooms', ROOM, 'tasks');
    await addDoc(tasksRef, {
        title: 'Find the clue',
        description: 'Look around',
        taskType: 'Task',
        pointValue: '10',
        maxCompletions: null,
        isComplete: false,
        completedBy: [],
        dateCreated: '12:00',
        ...task,
    });
};

const fetchTask = async (taskIndex) => {
    const tasksRef = collection(db, 'rooms', ROOM, 'tasks');
    const snapshot = await getDocs(query(tasksRef, where('taskIndex', '==', taskIndex)));
    return snapshot.docs[0].data();
};

const seedApprovedMissionPhoto = async (assassin, missionIndex, reversalSnapshot) => {
    const photosRef = collection(db, 'rooms', ROOM, 'photos');
    const ref = await addDoc(photosRef, {
        url: 'https://example.com/photo.jpg',
        assassin,
        target: null,
        mission: missionIndex,
        missionUndoSnapshot: reversalSnapshot,
        timestamp: new Date(),
        status: 'approved',
        originalPlayerData: null,
    });
    return ref.id;
};

describe('undoMissionPhotoApproval', () => {
    it('restores the player and resets the photo to pending', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 1 });
        const { data } = await completeMissionCallable({
            missionIndex: 1,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 1, data.reversalSnapshot);

        await undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
        expect((await fetchTask(1)).completedBy).toEqual([]);
        const photoSnapshot = await getDoc(doc(db, 'rooms', ROOM, 'photos', photoId));
        expect(photoSnapshot.data().status).toBe('pending');
    });

    it('un-sets isComplete only when the completion had auto-ended the mission', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        await seedTask({ taskIndex: 2, maxCompletions: 1 });
        const { data } = await completeMissionCallable({
            missionIndex: 2,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 2, data.reversalSnapshot);
        expect((await fetchTask(2)).isComplete).toBe(true);

        await undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId });

        expect((await fetchTask(2)).isComplete).toBe(false);
    });

    it('rejects undo of a photo that is not approved', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        const photosRef = collection(db, 'rooms', ROOM, 'photos');
        const ref = await addDoc(photosRef, {
            url: 'https://example.com/photo.jpg',
            assassin: 'alice',
            target: null,
            mission: null,
            missionUndoSnapshot: null,
            timestamp: new Date(),
            status: 'pending',
            originalPlayerData: null,
        });

        await expect(
            undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId: ref.id })
        ).rejects.toThrow(/not approved|nothing to undo/i);
    });

    it('rejects undo when a snapshotted player no longer exists, and mutates nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 3 });
        const { data } = await completeMissionCallable({
            missionIndex: 3,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 3, data.reversalSnapshot);
        // Simulates the roster changing unexpectedly between completion and undo.
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'rooms', ROOM, 'players', 'alice'));

        await expect(
            undoMissionPhotoApprovalCallable({ roomId: ROOM, photoId })
        ).rejects.toMatchObject({
            code: 'functions/failed-precondition',
            message: expect.stringMatching(/no longer exists/i),
        });
        const photoSnapshot = await getDoc(doc(db, 'rooms', ROOM, 'photos', photoId));
        expect(photoSnapshot.data().status).toBe('approved');
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 4 });
        const { data } = await completeMissionCallable({
            missionIndex: 4,
            playerName: 'alice',
            roomId: ROOM,
        });
        const photoId = await seedApprovedMissionPhoto('alice', 4, data.reversalSnapshot);
        const undoAsNonHost = callableAsNonHost('undoMissionPhotoApproval');

        await expect(undoAsNonHost({ roomId: ROOM, photoId })).rejects.toThrow(
            /permission-denied|host/i
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
    });
});

describe('undoMissionCommand', () => {
    const recordLastMissionCommandCompletion = async (reversalSnapshot) => {
        const { updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'rooms', ROOM), { lastMissionCommandCompletion: reversalSnapshot });
    };

    it('restores the player and clears lastMissionCommandCompletion', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 1 });
        const { data } = await completeMissionCallable({
            missionIndex: 1,
            playerName: 'alice',
            roomId: ROOM,
        });
        await recordLastMissionCommandCompletion(data.reversalSnapshot);

        await undoMissionCommandCallable({ roomId: ROOM });

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
        expect((await fetchTask(1)).completedBy).toEqual([]);
        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().lastMissionCommandCompletion).toBeNull();
    });

    it('rejects when there is nothing to undo', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 0 }]);
        // lastMissionCommandCompletion was never set.

        await expect(undoMissionCommandCallable({ roomId: ROOM })).rejects.toThrow(
            /nothing to undo/i
        );
    });

    it('rejects a second undo once the field has already been cleared', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 2 });
        const { data } = await completeMissionCallable({
            missionIndex: 2,
            playerName: 'alice',
            roomId: ROOM,
        });
        await recordLastMissionCommandCompletion(data.reversalSnapshot);
        await undoMissionCommandCallable({ roomId: ROOM });

        await expect(undoMissionCommandCallable({ roomId: ROOM })).rejects.toThrow(
            /nothing to undo/i
        );
        // The first undo's restore must not be re-applied a second time.
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [{ name: 'alice', score: 5 }]);
        await seedTask({ taskIndex: 3 });
        const { data } = await completeMissionCallable({
            missionIndex: 3,
            playerName: 'alice',
            roomId: ROOM,
        });
        await recordLastMissionCommandCompletion(data.reversalSnapshot);
        const undoAsNonHost = callableAsNonHost('undoMissionCommand');

        await expect(undoAsNonHost({ roomId: ROOM })).rejects.toThrow(/permission-denied|host/i);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(15);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:emulator`
Expected: FAIL — neither `undoMissionPhotoApproval` nor `undoMissionCommand` exist yet.

- [ ] **Step 3: Write the Cloud Function**

Create `functions/callableFunctions/undoMissionCompletion.js`:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The one shared reversal step both mission-undo entry points call — given
 * a reversalSnapshot (the exact shape completeMission.js returns), writes
 * every player entry back verbatim and removes the completion from the
 * task, inside the caller's own transaction. Mirrors undoKillPlayer.js's
 * replay logic exactly, plus the task-level (completedBy/isComplete)
 * reversal a kill has no equivalent of
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 */
const applyReversal = async (transaction, roomRef, reversalSnapshot) => {
    const playersRef = roomRef.collection('players');
    const tasksRef = roomRef.collection('tasks');

    const playerEntries = Object.entries(reversalSnapshot.players);
    const playerRefsByKey = new Map();
    for (const [key] of playerEntries) {
        const playerSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', key)
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Cannot undo: a player from this mission completion (${key}) no longer exists.`
            );
        }
        playerRefsByKey.set(key, playerSnapshot.docs[0].ref);
    }

    const taskSnapshot = await transaction.get(
        tasksRef.where('taskIndex', '==', reversalSnapshot.missionIndex)
    );
    if (taskSnapshot.empty) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `Cannot undo: mission ${reversalSnapshot.missionIndex} no longer exists.`
        );
    }
    const taskRef = taskSnapshot.docs[0].ref;

    for (const [key, snapshot] of playerEntries) {
        transaction.update(playerRefsByKey.get(key), {
            score: snapshot.score,
            targets: snapshot.targets,
            assassins: snapshot.assassins,
            isAlive: snapshot.isAlive,
            openSeason: snapshot.openSeason,
        });
    }

    const taskUpdates = { completedBy: FieldValue.arrayRemove(reversalSnapshot.playerName) };
    if (reversalSnapshot.wasAutoEnded) {
        taskUpdates.isComplete = false;
    }
    transaction.update(taskRef, taskUpdates);
};

const requireHost = async (transaction, roomRef, roomId, uid) => {
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
    }
    if (roomSnapshot.data().hostId !== uid) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Only the room host can undo a mission completion.'
        );
    }
    return roomSnapshot;
};

/**
 * Undoes a mission completion approved from a photo — the photo-anchored
 * undo stack, extending PhotosDisplay.js's existing Undo button the same
 * way undoKillPlayer.js already does for kills.
 */
exports.undoMissionPhotoApproval = functions.https.onCall(async (data, context) => {
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
        const photoRef = roomRef.collection('photos').doc(photoId);

        await requireHost(transaction, roomRef, roomId, context.auth.uid);

        const photoSnapshot = await transaction.get(photoRef);
        if (!photoSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Photo not found: ${photoId}`);
        }
        const photoData = photoSnapshot.data();
        if (photoData.status !== 'approved' || photoData.mission == null) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Photo is not an approved mission completion (status: ${photoData.status}); nothing to undo.`
            );
        }

        await applyReversal(transaction, roomRef, photoData.missionUndoSnapshot);

        transaction.update(photoRef, { status: 'pending' });
    });
});

/**
 * Undoes the most recent mission completion made via /mission done — the
 * room-anchored undo stack, independent from the photo-approval one
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md's "two
 * separate stacks" decision).
 */
exports.undoMissionCommand = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId } = data;
    if (!roomId) {
        throw new functions.https.HttpsError('invalid-argument', 'roomId is required.');
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);

        const roomSnapshot = await requireHost(transaction, roomRef, roomId, context.auth.uid);
        const reversalSnapshot = roomSnapshot.data().lastMissionCommandCompletion;
        if (!reversalSnapshot) {
            throw new functions.https.HttpsError('failed-precondition', 'Nothing to undo.');
        }

        await applyReversal(transaction, roomRef, reversalSnapshot);

        transaction.update(roomRef, { lastMissionCommandCompletion: null });
    });
});
```

Read the current `functions/index.js` (found in Task 1) and add `completeMission`, `undoMissionPhotoApproval`, `undoMissionCommand` to its export list — Task 1 already added `completeMission`, so this step just adds the two undo exports alongside it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:emulator`
Expected: PASS, all 10 new tests, plus every pre-existing emulator suite still green.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean.

- [ ] **Step 6: Commit**

```bash
git add functions/callableFunctions/undoMissionCompletion.js functions/index.js src/components/undoMissionCompletionCallable.integration.test.js
git commit -m "Add the shared server-side mission-undo reversal"
```

---

### Task 3: `dbCalls.js` extension + `docs/data-model.md`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `docs/data-model.md`

**Interfaces:**

- Produces: `approvePhotoAsMissionForRoom(roomID, photoID, missionIndex, reversalSnapshot)` (extends the existing 3-argument function with a 4th), `recordLastMissionCommandCompletion(roomID, reversalSnapshot)` (new). Tasks 5 and 6 both consume these.

- [ ] **Step 1: Extend `approvePhotoAsMissionForRoom`**

Read the current function in `src/components/firebase_calls/dbCalls.js` fresh (currently a 3-argument function, `roomID, photoID, missionIndex`, writing `{ status: 'approved', mission: missionIndex }`). Add a fourth parameter and field:

```js
export const approvePhotoAsMissionForRoom = async (
    roomID,
    photoID,
    missionIndex,
    reversalSnapshot
) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, {
        status: 'approved',
        mission: missionIndex,
        missionUndoSnapshot: reversalSnapshot,
    });
};
```

- [ ] **Step 2: Add `recordLastMissionCommandCompletion`**

Read `endGame` in the same file fresh first (a simple existing room-level writer: `updateDoc(doc(db, 'rooms', roomID), {...})`) — match its exact style. Add, near `endGame` or another room-level writer:

```js
// Persists the most recent /mission done completion's reversal snapshot on
// the room itself, so /mission undo has something to act on — the
// command-path counterpart to approvePhotoAsMissionForRoom's
// missionUndoSnapshot, tracked independently (two separate undo stacks,
// docs/superpowers/specs/2026-08-29-mission-undo-design.md).
export const recordLastMissionCommandCompletion = async (roomID, reversalSnapshot) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { lastMissionCommandCompletion: reversalSnapshot });
};
```

- [ ] **Step 3: Update `docs/data-model.md`**

Read the `rooms/{roomID}/photos/{autoId}` field table fresh (it currently has a `mission` row and an `originalPlayerData` row — read `originalPlayerData`'s exact prose for the style to match). Add a `missionUndoSnapshot` row directly after `mission`:

```
| `missionUndoSnapshot` | `object \| null` | `null` for a kill-approved or denied photo. Set once, to the `reversalSnapshot` `completeMission` returned, by `dbCalls.approvePhotoAsMissionForRoom`, when a moderator approves the photo as a mission completion — mirrors `originalPlayerData`'s role for kills, consumed by `undoMissionPhotoApproval` to reverse the completion. |
```

Read the `rooms/{roomID}` top-level field table fresh (it has a `Written by` column — match `endGame`'s row style). Add a `lastMissionCommandCompletion` row:

```
| `lastMissionCommandCompletion` | `object \| null` | `dbCalls.recordLastMissionCommandCompletion` (`ChatInput.js`'s `/mission done`), cleared to `null` by `undoMissionCommand` | The most recent `/mission done` completion's `reversalSnapshot`, overwritten by every new typed completion. Absent/`null` means `/mission undo` has nothing to act on. Independent from `missionUndoSnapshot` on a photo doc — two separate undo stacks, one per way a mission can be completed (docs/superpowers/specs/2026-08-29-mission-undo-design.md). |
```

- [ ] **Step 4: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean (this task adds no new tests of its own — both new functions are exercised indirectly by Tasks 5 and 6's component tests, and Task 2's emulator tests already prove the Cloud Function side that consumes what these two functions write).

- [ ] **Step 5: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js docs/data-model.md
git commit -m "Add dbCalls support for the two mission-undo snapshot fields"
```

---

### Task 4: Client-side callable wrappers

**Files:**

- Delete: `src/components/completeMission.js` (the old client orchestration)
- Create: `src/components/completeMission.js` (new thin wrapper — same filename, different job)
- Create: `src/components/undoMissionCommand.js`
- Create: `src/components/undoMissionPhotoApproval.js`

**Interfaces:**

- Consumes: the `completeMission`, `undoMissionPhotoApproval`, `undoMissionCommand` callables from Tasks 1 and 2.
- Produces: `completeMission(missionIndex, playerName, roomID)` → `Promise<{ reversalSnapshot, addedTargets, addedAssassins, remapLogs }>`; `undoMissionCommand(roomID)` → `Promise<void>`; `undoMissionPhotoApproval(roomID, photoID)` → `Promise<void>`. Tasks 5 and 6 both import these.

This task deliberately does NOT touch `ChatInput.js` or `PhotosDisplay.js` — both still import the old `src/components/completeMission.js` orchestration at the point this task's own commit lands, which means this task's commit alone would leave those two files broken (importing a default export, `CompleteMission`, from a file that no longer exports it). Do the delete-and-recreate as the LAST step of this task, immediately before committing, and do not run this task's own full gate (Step 4 below) until Task 5 and Task 6 have also landed in the same working tree — coordinate with whoever executes this plan: Tasks 4, 5, and 6 must be committed together as one unit of work if executed by three different people/passes, since no intermediate commit boundary between "old file deleted" and "both callers updated" is independently working code. If you are the same executor for all three tasks in sequence, this is naturally fine — just don't consider Task 4 "done" (its own gate green) until Tasks 5 and 6's import changes are also in the working tree.

- [ ] **Step 1: Read the reference wrappers**

Read `src/components/executeKill.js` and `src/components/undoKill.js` in full (already read this session) — every new file below matches their exact 2-3-line shape and file-header comment style.

- [ ] **Step 2: Create `src/components/undoMissionCommand.js`**

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const undoMissionCommandCallable = httpsCallable(functions, 'undoMissionCommand');

/**
 * Reverses the most recent /mission done completion, server-side, in one
 * Firestore transaction — the command-path half of mission undo's two
 * independent stacks (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 *
 * @throws if there is nothing to undo, or the caller isn't the room's
 *   host — surfaces as a rejected promise carrying `.message`.
 */
export const undoMissionCommand = async (roomID) => {
    await undoMissionCommandCallable({ roomId: roomID });
};
```

- [ ] **Step 3: Create `src/components/undoMissionPhotoApproval.js`**

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const undoMissionPhotoApprovalCallable = httpsCallable(functions, 'undoMissionPhotoApproval');

/**
 * Reverses a photo-approved mission completion in full, server-side, in
 * one Firestore transaction — the photo-anchored half of mission undo's
 * two independent stacks
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 *
 * @throws if the photo is not an approved mission completion, or the
 *   caller isn't the room's host — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const undoMissionPhotoApproval = async (roomID, photoID) => {
    await undoMissionPhotoApprovalCallable({ roomId: roomID, photoId: photoID });
};
```

- [ ] **Step 4: Delete and recreate `src/components/completeMission.js`**

Read the current file (the `CompleteMission(handlers)` factory-function orchestration) once more to confirm nothing about it needs preserving beyond what's already captured in the deleted file's own git history. Delete it, then create a new file of the same name with a completely different shape:

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const completeMissionCallable = httpsCallable(functions, 'completeMission');

/**
 * Completes a mission — awards points for a Task, or revives the player
 * and regenerates targets for a Revival Mission — server-side, in one
 * Firestore transaction, returning a reversal snapshot the caller can
 * persist for later undo
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md). Replaces the
 * client-orchestrated completeMission.js the mission-completion-via-photo
 * feature originally shipped (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md)
 * — see that file's git history for what used to be here.
 *
 * @throws if the mission index is invalid, the mission has already ended,
 *   the player already completed it, a Revival Mission is attempted by a
 *   player who is not dead, or the caller isn't the room's host —
 *   surfaces as a rejected promise carrying `.message`.
 */
export const completeMission = async (missionIndex, playerName, roomID) => {
    const { data } = await completeMissionCallable({ missionIndex, playerName, roomId: roomID });
    return data;
};
```

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: `npm run lint`/`npm run build` will fail at this point, because `ChatInput.js` and `PhotosDisplay.js` still import `CompleteMission` (the old default export) from this file, which no longer exists. This is expected and acceptable ONLY if Tasks 5 and 6 are executed immediately after, in the same sitting, before this is considered a stopping point — do not commit Task 4 in isolation if there will be any gap before Tasks 5/6 land. If your executing process requires each task to independently pass its own gate before proceeding (e.g. subagent-driven-development's per-task review gate), fold Tasks 4, 5, and 6 into a single combined task instead of three, since they cannot be independently green — flag this to whoever is running this plan rather than silently working around it.

- [ ] **Step 6: Commit** (only once Tasks 5 and 6's changes are also ready to land alongside this one — see the note above)

```bash
git add src/components/completeMission.js src/components/undoMissionCommand.js src/components/undoMissionPhotoApproval.js
git commit -m "Add client wrappers for the new mission-completion Cloud Functions"
```

---

### Task 5: `ChatInput.js` — `/mission done` refactor and new `/mission undo`

**Files:**

- Modify: `src/components/logs_components/ChatInput.js`
- Modify: `src/components/logs_components/ChatInput.test.jsx`

**Interfaces:**

- Consumes: `completeMission`, `undoMissionCommand` (Task 4); `recordLastMissionCommandCompletion` (Task 3).

**This task must land together with Task 4** (see Task 4's note) — its own gate is not meaningfully green in isolation, since Task 4 already broke this file's import.

- [ ] **Step 1: Read the current state fresh**

Read `src/components/logs_components/ChatInput.js`'s full `case '/mission':` switch (currently at approximately lines 153-215) and its `/kill` case (for the `executeKill` response-routing pattern to mirror) fresh — do not rely on an earlier reading from before this plan's Tasks 1-4 landed.

- [ ] **Step 2: Replace `case 'done':`'s body**

Replace the `if (arrayOfPlayerNames.includes(playerName)) { ... }` block's contents (currently constructing `CompleteMission({...})` and calling it) with:

```js
if (arrayOfPlayerNames.includes(playerName)) {
    const result = await completeMission(missionIndex, playerName, roomID);
    await recordLastMissionCommandCompletion(roomID, result.reversalSnapshot);
    for (const log of result.remapLogs) {
        await handleRemapping(log);
    }
    handleAddNewAssassins(result.addedAssassins);
    handleAddNewTargets(result.addedTargets);
    handleSetShowMessageToTrue();
} else {
    createAlert('error', 'Error', `Player ${args[1]} is invalid`, 1500);
    console.error(`Player ${args[1]} is invalid.`);
}
```

Add `import { completeMission } from '../completeMission';` and `import { undoMissionCommand } from '../undoMissionCommand';` near this file's existing `import { executeKill } from '../executeKill';` line. Add `recordLastMissionCommandCompletion` to the existing `import { ... } from '../firebase_calls/dbCalls';` list.

Remove the now-unused imports this deletes the only remaining call site of: `CompleteMission` from `'../completeMission'` (replaced above), and check whether `RemapPlayers`/`handleTargetRegeneration`'s construction at the top of `handleCommandExecution` (`const handleTargetRegeneration = RemapPlayers(handleRemapping, createAlert);`) is still used by any OTHER case in this switch (`/kill`, `/revive` both still need it) — it is, so that line stays; only the `/mission done` case's own now-removed usage of it goes away.

- [ ] **Step 3: Add `case 'undo':`**

Add a new case alongside `done`/`end`/`start`/`view` inside the `case '/mission':` switch:

```js
case 'undo':
    await undoMissionCommand(roomID);
    await addLog('Undo: the last mission completion was reverted', 'blue.200');
    await addPlayerMessageForRoom(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Undo: the last mission completion was reverted',
            standings: null,
        },
        roomID
    );
    break;
```

- [ ] **Step 4: Update the mock factory and existing tests**

Read `src/components/logs_components/ChatInput.test.jsx`'s current `jest.mock('../firebase_calls/dbCalls', ...)` factory and its `/mission done` describe block fresh (the mock factory currently mocks low-level functions the OLD orchestration called directly — `addPlayerToCompletedByForTask`, `fetchAliveRosterForRoom`, `fetchPlayersByStatusForRoom`, `fetchReferenceByIndexForTask`, `fetchTaskByIndexForRoom`, `updateIsAliveForPlayer`, `updateIsCompleteToTrueForTaskByIndex`, `updatePointsForPlayer` — none of these are called by `ChatInput.js` anymore once this task lands, since `completeMission` (Task 4's wrapper) is the only thing it calls now). Replace those now-irrelevant mocks with:

```js
jest.mock('../completeMission', () => ({ completeMission: jest.fn() }));
jest.mock('../undoMissionCommand', () => ({ undoMissionCommand: jest.fn() }));
```

(`ChatInput.test.jsx` is colocated with `ChatInput.js` in `src/components/logs_components/`, so `jest.mock`'s path here must match `ChatInput.js`'s own import path from Step 2 exactly — `'../completeMission'`, one level up to `src/components/completeMission.js`, not two; double check this against `ChatInput.js`'s actual import statement before running the tests, since a mismatched mock path fails silently by loading the real module instead of erroring). Add `recordLastMissionCommandCompletion: jest.fn()` to the existing `dbCalls` mock factory (which stays for the file's other commands' needs). Add default resolutions to `beforeEach`:

```js
completeMission.mockResolvedValue({
    reversalSnapshot: { missionIndex: 1, playerName: 'bob', wasAutoEnded: false, players: {} },
    addedTargets: {},
    addedAssassins: {},
    remapLogs: [],
});
dbCalls.recordLastMissionCommandCompletion.mockResolvedValue(undefined);
undoMissionCommand.mockResolvedValue(undefined);
```

Update every existing test in the `/mission done (bug report: ...)` describe block (including the nested `Revival Mission` sub-block) to assert against `completeMission` being called with `(missionIndex, playerName, roomID)` instead of the old dbCalls-level assertions — read each existing test and rewrite its assertions to match what `completeMission` (the mock) was called with and what `recordLastMissionCommandCompletion` was called with, rather than the deleted orchestration's individual write calls. The regression test added when this session's earlier mission-completion-via-photo plan ran (`'rejects completing a Revival Mission for a player who is not dead, without recording the completion'`) becomes redundant with Task 1's own emulator test of the identical scenario — since the actual `planMissionCompletion`/`completeMission` logic now lives entirely server-side and this file only calls a mocked wrapper, this file can no longer meaningfully test that specific business rule at all; delete that test from `ChatInput.test.jsx` (its coverage now lives in Task 1's `completeMissionCallable.integration.test.js`) rather than trying to preserve a version of it that only proves the mock does what the mock was told to do.

Add new tests for `/mission undo`:

```js
describe('/mission undo', () => {
    it('calls undoMissionCommand with just roomID', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission undo');

        await waitFor(() => expect(undoMissionCommand).toHaveBeenCalledWith('room-a'));
    });

    it('logs and broadcasts the undo announcement on success', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission undo');

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'Undo: the last mission completion was reverted',
                'blue.200'
            )
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Undo: the last mission completion was reverted',
                standings: null,
            },
            'room-a'
        );
    });

    it('surfaces a thrown error through the outer-catch wording', async () => {
        undoMissionCommand.mockRejectedValueOnce(new Error('Nothing to undo.'));
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission undo');

        expect(
            await screen.findByText(/mission undo failed: nothing to undo/i)
        ).toBeInTheDocument();
    });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/components/logs_components/ChatInput.test.jsx`
Expected: PASS, every test in the file, including the 3 new `/mission undo` tests.

- [ ] **Step 6: Commit** (together with Task 4, per its note)

```bash
git add src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx
git commit -m "Refactor /mission done onto completeMission, add /mission undo"
```

---

### Task 6: `PhotosDisplay.js` — real mission-undo behavior

**Files:**

- Modify: `src/components/photos_display_component/PhotosDisplay.js`
- Modify: `src/components/photos_display_component/PhotosDisplay.test.jsx`

**Interfaces:**

- Consumes: `completeMission`, `undoMissionPhotoApproval` (Task 4); `approvePhotoAsMissionForRoom`'s new 4th argument (Task 3).

**This task must land together with Task 4** (see Task 4's note).

- [ ] **Step 1: Read the current state fresh**

Read `src/components/photos_display_component/PhotosDisplay.js`'s full `handlePass` and `handleUndo` (already read this session) fresh — do not rely on an earlier reading from before Tasks 1-4 landed.

- [ ] **Step 2: Update `handlePass`'s mission branch**

Replace:

```js
if (effectiveSelection.startsWith('mission:')) {
    const missionIndex = Number(effectiveSelection.slice('mission:'.length));
    const handleTargetRegeneration = RemapPlayers(handleRemapping, createAlert);
    const completeMission = CompleteMission({
        addLog,
        handleTargetRegeneration,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
        handlePlayerRevive,
    });
    await completeMission(approvingPhoto.assassin, missionIndex, roomID, players);
    await approvePhotoAsMissionForRoom(roomID, approvingPhoto.id, missionIndex);
}
```

with:

```js
if (effectiveSelection.startsWith('mission:')) {
    const missionIndex = Number(effectiveSelection.slice('mission:'.length));
    const result = await completeMission(missionIndex, approvingPhoto.assassin, roomID);
    await approvePhotoAsMissionForRoom(
        roomID,
        approvingPhoto.id,
        missionIndex,
        result.reversalSnapshot
    );
    for (const log of result.remapLogs) {
        await handleRemapping(log);
    }
    handleAddNewAssassins(result.addedAssassins);
    handleAddNewTargets(result.addedTargets);
    handleSetShowMessageToTrue();
}
```

Update the file's imports: remove `import CompleteMission from '../completeMission';` and `import RemapPlayers from '../RemapPlayers';` (confirm neither is used anywhere else in this file before removing — `handlePlayerRevive` stays destructured from `executionContext` since nothing else in this diff removes that), add `import { completeMission } from '../completeMission';` and `import { undoMissionPhotoApproval } from '../undoMissionPhotoApproval';`.

- [ ] **Step 3: Update `handleUndo`'s `missionPass` branch**

Replace:

```js
if (action === 'missionPass') {
    createAlert(
        'info',
        'Not Supported',
        'Undo is not available for mission completions yet.',
        1500
    );
    return;
}
```

with:

```js
if (action === 'missionPass') {
    try {
        await undoMissionPhotoApproval(roomID, photo.id);
        await addLog('Undo: the last mission completion was reverted', 'blue.200');
        await addPlayerMessageForRoom(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Undo: the last mission completion was reverted',
                standings: null,
            },
            roomID
        );
    } catch (error) {
        console.error('Error undoing mission completion:', error);
        createAlert('error', 'Error undoing photo judgment', error.message, 1500);
    }
    return;
}
```

(the wording here — `'Undo: the last mission completion was reverted'` — must be character-for-character identical to Task 5's `/mission undo` announcement text, per this plan's Global Constraints.)

- [ ] **Step 4: Update the mock factory and existing tests**

Read `PhotosDisplay.test.jsx`'s current `jest.mock('../firebase_calls/dbCalls', ...)` factory and its `describe('approving a photo as a mission completion', ...)` block fresh (same rework consideration as Task 5 — the low-level dbCalls mocks the old orchestration needed, `addPlayerToCompletedByForTask`/`fetchReferenceByIndexForTask`/`fetchTaskByIndexForRoom`/`updatePointsForPlayer`, are no longer called by `PhotosDisplay.js` once this task lands). Add:

```js
jest.mock('../completeMission', () => ({ completeMission: jest.fn() }));
jest.mock('../undoMissionPhotoApproval', () => ({ undoMissionPhotoApproval: jest.fn() }));
```

Add default resolutions to `beforeEach`, matching Task 5's shape. Update every existing test in the mission-completion describe block to assert against `completeMission` (the mock) being called with `(missionIndex, assassin, roomID)` and `approvePhotoAsMissionForRoom` being called with the 4th `reversalSnapshot` argument, instead of the old dbCalls-level assertions.

Update the existing `'shows a not-yet-supported message and performs no write when Undo is clicked on a mission-approved photo'` test (from the mission-completion-via-photo plan) — this behavior no longer exists. Replace it with:

```js
it('undoes a mission-approved photo for real, instead of showing the placeholder', async () => {
    mountWithSnapshot([
        { status: 'approved', mission: 1, assassin: 'bob', originalPlayerData: null },
    ]);

    await userEvent.click(screen.getByAltText('Undo'));

    await waitFor(() => expect(undoMissionPhotoApproval).toHaveBeenCalledWith('room-a', 'photo-0'));
    expect(executionHandlers.addLog).toHaveBeenCalledWith(
        'Undo: the last mission completion was reverted',
        'blue.200'
    );
    expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Undo: the last mission completion was reverted',
            standings: null,
        },
        'room-a'
    );
});

it('shows an error alert when undoing a mission-approved photo fails', async () => {
    undoMissionPhotoApproval.mockRejectedValueOnce(new Error('nothing to undo'));
    mountWithSnapshot([
        { status: 'approved', mission: 1, assassin: 'bob', originalPlayerData: null },
    ]);

    await userEvent.click(screen.getByAltText('Undo'));

    expect(await screen.findByText(/nothing to undo/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/components/photos_display_component/PhotosDisplay.test.jsx`
Expected: PASS, every test in the file.

- [ ] **Step 6: Run the full gate now that Tasks 4, 5, and 6 are all in the working tree**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean.

- [ ] **Step 7: Commit** (together with Task 4)

```bash
git add src/components/photos_display_component/PhotosDisplay.js src/components/photos_display_component/PhotosDisplay.test.jsx
git commit -m "Let PhotosDisplay undo a mission-approved photo for real"
```

---

### Task 7: `src/game/commandCompletion.js` — `/mission undo` tab completion

**Files:**

- Modify: `src/game/commandCompletion.js`
- Modify: `src/game/commandCompletion.test.js`

**Interfaces:** None — fully independent, no other task depends on this one.

- [ ] **Step 1: Read the current state fresh**

Read `src/game/commandCompletion.js`'s `MISSION_SUBCOMMANDS` array and `MISSION_ARG_LABELS` object fresh, and `src/game/commandCompletion.test.js`'s existing `/mission` describe blocks fresh — in particular the test asserting the full subcommand list (`expect(result.candidates).toEqual(['done', 'end', 'start', 'view'])`) and the `'/mission start and /mission view take no arguments'` describe block, to determine whether `complete()`'s candidates come back alphabetically sorted or in `MISSION_SUBCOMMANDS`'s own array order (the current list happens to already be alphabetical, so this isn't determinable from the current test alone — read `candidatesForSlot`'s actual implementation for the `/mission` bare-subcommand case to see whether it sorts before returning).

- [ ] **Step 2: Write the failing tests**

Add `'undo'` to the existing candidates-list assertion in the correct position (alphabetical, per Step 1's finding — `['done', 'end', 'start', 'undo', 'view']` if sorted, or appended if not — use whichever is actually correct). Add a new test to the `'/mission start and /mission view take no arguments'` describe block (rename it if needed to include `undo`, or add a new one alongside it):

```js
it('has nothing to complete after "/mission undo "', () => {
    const result = complete('/mission undo ', { players, missions });

    expect(result.candidates).toEqual([]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/game/commandCompletion.test.js`
Expected: FAIL — `'undo'` isn't in `MISSION_SUBCOMMANDS` yet, so it doesn't appear in the candidates list, and `/mission undo ` isn't recognized as a valid sub-command at all yet.

- [ ] **Step 4: Update `MISSION_SUBCOMMANDS` and `MISSION_ARG_LABELS`**

```js
const MISSION_SUBCOMMANDS = ['done', 'end', 'start', 'undo', 'view'];
```

```js
const MISSION_ARG_LABELS = {
    done: ['[player_name]', '[mission_index]'],
    end: ['[mission_index]'],
    start: [],
    undo: [],
    view: [],
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/game/commandCompletion.test.js`
Expected: PASS, all tests including the updated candidates-list assertion and the new zero-argument test.

- [ ] **Step 6: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean.

- [ ] **Step 7: Commit**

```bash
git add src/game/commandCompletion.js src/game/commandCompletion.test.js
git commit -m "Add /mission undo to tab completion"
```

---

## Final verification

After all 7 tasks are complete:

1. Run the full gate one more time (`npm run format`, `npm run lint`, `npm test`, `npm run build`) and `npm run test:emulator`.
2. Confirm `src/components/completeMission.js` genuinely has only one definition in the working tree (the new thin wrapper) — `git log --all --oneline -- src/components/completeMission.js` should show a delete-then-recreate in its history, not two files coexisting.
3. Deploy: this plan adds two new Cloud Functions and modifies none of the existing ones, so the deploy is `firebase deploy --only functions,hosting`. Verify the live bundle afterward the same way every prior deploy this session has (fetch `/static/js/main.*.js` from the served HTML, `curl` it, `grep` for a known new string like `'Undo: the last mission completion was reverted'`, and compare the bundle hash to the local `build/` output), and confirm via `firebase functions:list` that `completeMission`, `undoMissionPhotoApproval`, and `undoMissionCommand` all appear alongside the existing six functions.
