# Full Kill Undo Design

**Date:** 2026-08-16
**Status:** Approved

## Problem

`PhotosDisplay.js`'s Undo button, used to revert a mistakenly-approved kill
photo, only reverts the **target**'s side of the kill. A kill
(`killPlayer.js`, one atomic Cloud Function transaction) actually mutates
far more than the target:

- **Target**: `score: 0, isAlive: false, openSeason: false, targets: [],
assassins: []`.
- **Killer**: `score += target's pre-kill score`, and the dead target is
  removed from their `targets` array.
- **Every other player hunting the target** (if more than one — the data
  model allows it): same unmap, dead target removed from their `targets`.
- **Every player the target was hunting**: dead target removed from their
  `assassins` array.
- **The remap** (`planRemap`): the killer and any co-assassins, all of
  whom just lost their target to death, get a fresh target assigned from
  the alive roster; everyone the target was hunting gets a fresh assassin
  assigned. This can touch an arbitrary number of players beyond the
  target and killer.

Today's `handleUndo` only restores the target's `{score, targets,
assassins}` from a snapshot `killPlayer.js` captures — a snapshot that was
only ever taken of the target, never the killer or anyone else the remap
touched. It also isn't atomic: it's five separate, individually-awaited
client-side Firestore writes, the exact non-atomicity problem
`docs/improvements.md` item 4 already fixed for the kill direction but not
for the undo direction.

## Decisions

**Mirror `killPlayer.js`'s own pattern for the reversal.** One atomic
Cloud Function transaction, host-authorization-checked the same way,
given a complete pre-kill snapshot of every player document the original
kill touched — not just the target. This means `killPlayer.js` needs to
capture the pre-write state of every player in its own `pendingUpdates`
map before any write happens, and return that full map as
`preKillSnapshot` (shape change: from a flat `{score, targets, assassins}`
object describing only the target, to a map keyed by normalized player
name, each value `{score, targets, assassins, isAlive}`).

**No backward compatibility for pre-fix approved photos.** Confirmed with
the user: the game hasn't shipped yet, so there's no existing data whose
`originalPlayerData` is in the old flat shape that needs to keep working.
The new undo function assumes the new map shape unconditionally.

**`handlePass` (Accept) needs no code changes.** It already does
`const { preKillSnapshot, ... } = await executeKill(...); await
approvePhotoForRoom(roomID, currentPhoto.id, preKillSnapshot);` — a
straight passthrough. The reshaped snapshot flows through transparently;
`approvePhotoForRoom` just stores whatever it's handed, unchanged.

**Only the `action === 'pass'` half of `handleUndo` changes.** The
`action === 'deny'` branch never touched player data (Decline only ever
writes the photo's `status`), so it's untouched.

## Data flow

```
GM clicks Undo (last judged photo was an approval)
        |
handleUndo (action === 'pass')
        |
undoKill(roomID, photo.id)  — thin httpsCallable wrapper
        |
undoKillPlayer Cloud Function (one transaction):
  - auth check: caller is room host
  - read phase: photo doc (must be status 'approved'); for every
    key in photo.originalPlayerData, find that player's current doc
    via trimmedNameLowerCase
  - write phase: each found player -> {score, targets, assassins,
    isAlive} from their snapshot entry; photo doc -> {status: 'pending'}
        |
client logs "Undo: {target}'s death by {assassin} was reverted"
        |
onSnapshot listener (already existing) picks up every write above and
recomputes unjudgedPhotos/judgedPhotos — no local state mutation needed
```

## Components

### `functions/callableFunctions/killPlayer.js` (modified)

Add a `preWriteDataByName` map, populated the moment each player's data is
first read (assassin, target, each neighbor, each roster player) — before
any write happens, so it's guaranteed to hold pre-kill values:

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
```

Call `captureSnapshot(assassin, assassinData)` right after `assassinData`
is read, and `captureSnapshot(target, targetData)` right after `targetData`
is read. Inside the existing neighbor-gathering loop, after
`neighborDocsByName.set(key, neighborSnapshot.docs[0]);`, add
`captureSnapshot(name, neighborSnapshot.docs[0].data());`. Inside the
existing roster-building loop, after `rosterDocsByName.set(...)`, add
`captureSnapshot(docData.name, docData);`.

Immediately before the write loop (`for (const { ref, fields } of
pendingUpdates.values())`), build the final snapshot from only the players
actually touched:

```js
const preKillSnapshot = {};
for (const key of pendingUpdates.keys()) {
    const snapshot = preWriteDataByName.get(key);
    if (snapshot) preKillSnapshot[key] = snapshot;
}
```

Change the return statement's `preKillSnapshot` field from the current
flat `{ score: targetData.score, targets: targetData.targets, assassins:
targetData.assassins }` to this new map.

### `functions/callableFunctions/undoKillPlayer.js` (new)

Same structure and authorization pattern as `killPlayer.js` — one
transaction, host-only:

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

Note this does not need `planRemap` at all — undo is a pure replay of
captured values, not a fresh remap decision.

### `functions/index.js` (modified)

Register the new function, matching the existing pattern:

```js
const { undoKillPlayer } = require('./callableFunctions/undoKillPlayer');
exports.undoKillPlayer = undoKillPlayer;
```

### `src/components/undoKill.js` (new)

Thin wrapper, matching `executeKill.js` exactly:

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

### `src/components/photos_display_component/PhotosDisplay.js` (modified)

`handleUndo`'s body becomes:

```js
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
```

Drops the `updatePointsForPlayer`, `updateTargetsForPlayer`,
`updateAssassinsForPlayer`, `remapPlayerAsTarget`, `handlePlayerRevive`
calls (and their now-unneeded imports/context destructuring) from this
function — folded into the atomic `undoKillPlayer` transaction instead.
Imports `undoKill` from the new file. The `action === 'pass'` branch's
`updatePhotoStatusForRoom(roomID, photo.id, 'pending')` call — previously
shared, unconditional, at the top of `handleUndo` — is dropped for this
branch specifically, since `undoKillPlayer`'s own transaction already sets
the photo back to `pending`; it's kept for the `action === 'deny'` branch,
which has no Cloud Function call to do it for.

`updatePointsForPlayer`/`updateTargetsForPlayer`/`updateAssassinsForPlayer`
stay exported from `dbCalls.js` — used elsewhere (`TargetGenerator.js`,
`RemapPlayers.js`, `ResetTargetsButton.js`, `ChatInput.js`).
`handlePlayerRevive` stays — used by `ChatInput.js`'s `/revive` command.
`remapPlayerAsTarget` becomes unreferenced anywhere in `src/` once this
change lands (confirmed via `grep` — its only call site is the line being
removed here). Per this session's established convention (see
`docs/improvements.md` item 47's handling of `addPlayerForRoom`), this is
a new backlog note, not something to delete in this change.

## Testing

- **`functions/callableFunctions/undoKillPlayer.js`** gets new emulator
  integration tests, mirroring `executeKill.integration.test.js`'s style
  (assert against real persisted Firestore state, not internals): reverts
  a simple kill (killer's score/targets restored, target revived with
  original score/targets/assassins, photo status back to `pending`);
  reverts a kill whose remap touched a third player (that player's
  targets/assassins also restored); rejects undo of a non-approved photo
  (still `pending`, or already `denied`); rejects a non-host caller,
  leaving everything unchanged.
- **`executeKill.integration.test.js`** needs one existing assertion
  updated: line 48 currently asserts `result.preKillSnapshot).toEqual({
score: 5, targets: [], assassins: ['alice'] })` — the old flat shape.
  This becomes the new map shape, e.g. `{ bob: { score: 5, targets: [],
assassins: ['alice'], isAlive: true } }` (verify the exact expected
  values against the test's actual seeded data at implementation time).
- **`PhotosDisplay.test.jsx`** gets reworked for the `action === 'pass'`
  undo test(s): mock `undoKill` (new import) instead of the five
  individual `dbCalls` functions the old code called; assert it's called
  with `(roomID, photo.id)`; assert none of the now-removed dbCalls
  functions are called at all for this path.

## Error handling

Matches `killPlayer.js`'s existing error shape exactly — `HttpsError` with
`unauthenticated`/`invalid-argument`/`not-found`/`permission-denied`/
`failed-precondition` codes, surfacing to the client as a rejected promise
with `.message`, caught by `handleUndo`'s existing `try`/`catch` →
`createAlert('error', 'Error undoing photo judgment', error.message,
1500)`. No new error-handling pattern needed.

## Out of scope

- No backward compatibility for photos approved before this change ships
  (confirmed with the user — the game hasn't shipped).
- No change to `handlePass`/Accept, `handleDeny`/Decline, or `planRemap`.
- No change to `firestore.rules` — the new Cloud Function runs under the
  Admin SDK, which bypasses rules entirely, matching `killPlayer.js`.
- Deleting `remapPlayerAsTarget` once it's orphaned — tracked as a new
  backlog note instead, not fixed in this change.
