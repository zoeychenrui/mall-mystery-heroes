# Player Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player whose browser silently lost its login mid-game (Safari's
storage limits are the guaranteed case, but any device can hit this) can
request to reconnect under their existing name once the game has started,
and the moderator approves or denies that request from the console —
approval reattaches their existing score/targets/kills to the new device.

**Architecture:** One new Cloud Function file with three `onCall` exports
(`requestReconnect`, `approveReconnectRequest`, `denyReconnectRequest`)
mirroring `submitKillPhoto.js`'s "create a pending item inside a
transaction" shape for the request and `removePlayer.js`'s host-check
transaction shape for the two judgment functions. A new
`reconnectRequests` subcollection plays the same "queue the GM judges"
role `photos` already plays. `joinRoom.js` and `Homepage.js` are both
untouched — this is a fully separate, additive code path triggered only
when `joinRoom` rejects with its existing, unchanged "already started"
error.

**Tech Stack:** Firebase Cloud Functions (Admin SDK, `onCall`), Firestore
transactions, Firestore Security Rules, React Router, React/Chakra UI,
Jest (`node`/`jsdom`/`integration`/`rules` projects per `jest.config.js`).

**Spec:** `docs/superpowers/specs/2026-08-30-player-reconnect-design.md`

## Global Constraints

- Run all four gate commands before considering any task done:
  `npm run format`, `npm run lint` (fails on any warning), `npm test`,
  `npm run build`. Task 1 additionally requires `npm run test:emulator`
  (the Cloud Function integration tests) **and** `npm run test:rules`
  (the new Firestore rules coverage) — it is the only task touching
  either.
- The Admin SDK's `FieldValue` must be imported from
  `'firebase-admin/firestore'`, never `admin.firestore.FieldValue` (the
  Functions emulator strips static properties off the top-level
  `admin.firestore` binding).
- No new vendoring needed in `functions/scripts/sync-shared-game-logic.js`
  — `reconnectRequest.js` only needs `normalizePlayerName`, already
  vendored via `playerNames.js` for `joinRoom.js`'s own use.
- **`requestReconnect` uses a transaction, not a plain read-then-write.**
  The spec's own text describes a plain read+write as sufficient; this
  plan corrects that after reading `submitKillPhoto.js` fresh —
  every other "create a pending item for GM judgment" Cloud Function in
  this codebase already wraps that read-then-create in
  `db.runTransaction`, and there is no reason for this one to be the
  exception. Follow this plan's actual code, not the spec's prose, on
  this specific point.
- `approveReconnectRequest`'s three writes (the player document's `uid`,
  the room's `joinedUids` via `arrayUnion`, the request's `status`) must
  all go through the same transaction object — this is what makes the
  re-link atomic. `denyReconnectRequest` also transacts, for the same
  host-check-then-write shape, even though it only makes one write.
- No rate limiting on `requestReconnect` — an explicit spec decision
  (every request still requires GM approval regardless of volume), not
  an oversight. Treat any task that adds one as a plan defect.
- `functions/callableFunctions/joinRoom.js` must not be modified by any
  task in this plan.
- `src/pages/Homepage.js` must not be modified by any task in this plan
  — its existing same-uid session recovery solves a different failure
  mode (local storage lost, login intact) and needs no changes here.
- No confirmation dialog on Approve or Deny in `ReconnectRequests.js` —
  matches `/kick`'s existing no-confirmation precedent in this codebase.

---

## Task 1: `reconnectRequest.js` Cloud Function + rules coverage

**Files:**

- Create: `functions/callableFunctions/reconnectRequest.js`
- Create: `src/components/reconnectRequestCallable.integration.test.js`
- Modify: `functions/index.js`
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`
- Modify: `docs/testing.md` (emulator suite count and enumeration)

**Interfaces:**

- Produces: three `onCall` Cloud Functions.
    - `requestReconnect({roomId, playerName})` → `{requestId}`. No host
      check — callable by anyone signed in.
    - `approveReconnectRequest({roomId, requestId})` → nothing meaningful.
      Host-only.
    - `denyReconnectRequest({roomId, requestId})` → nothing meaningful.
      Host-only.
    - All three throw `HttpsError`s: `unauthenticated` (no `context.auth`),
      `invalid-argument` (missing arguments), `not-found` (room/request/
      player not found), `failed-precondition` (game not started yet, room
      no longer active, request already resolved), `permission-denied`
      (judgment functions called by a non-host).
- Task 2 (the client wrappers) consumes all three callable names and
  argument shapes verbatim.

- [ ] **Step 1: Write the failing emulator test file**

Create `src/components/reconnectRequestCallable.integration.test.js`:

```js
/**
 * Layer 1b — the reconnect-request Cloud Functions, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `requestReconnect`,
 * `approveReconnectRequest`, and `denyReconnectRequest` are thin wrappers
 * around `httpsCallable(functions, ...)` — these tests call them exactly
 * the way the real app does, then assert on what actually landed in
 * Firestore (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 */
import { requestReconnect } from './requestReconnect';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { auth, db } from '../utils/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

// requestReconnect resolves the caller purely from context.auth.uid — it
// never needs to already own a player doc (that's the entire premise:
// the caller has just lost the identity that used to). The shared
// singleton `auth`/`db` from utils/firebase, signed in as host by
// seedRoom's own first call, doubles as "some other signed-in device"
// for these tests, matching this codebase's own established shortcut
// (see removePlayerCallable.integration.test.js's identical reasoning)
// rather than always reaching for createIndependentIdentity.
describe('requestReconnect', () => {
    it('creates a pending request for an existing player name', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });

        const result = await requestReconnect(ROOM, 'alice');

        expect(result.requestId).toBeDefined();
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', result.requestId)
        );
        expect(requestSnapshot.data()).toMatchObject({
            playerName: 'alice',
            trimmedNameLowerCase: 'alice',
            requestingUid: auth.currentUser.uid,
            status: 'pending',
        });
    });

    it('rejects a name with no matching player, writing nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });

        await expect(requestReconnect(ROOM, 'nobody')).rejects.toThrow(
            'No player named nobody in this room.'
        );
        const requestsSnapshot = await getDocs(collection(db, 'rooms', ROOM, 'reconnectRequests'));
        expect(requestsSnapshot.docs).toHaveLength(0);
    });

    it('rejects a room where the game has not started yet', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: false });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This room has not started a game yet — just join normally.'
        );
    });

    it('rejects a room that has already ended', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], {
            gameStarted: true,
            isGameActive: false,
            endedAt: new Date(),
        });

        await expect(requestReconnect(ROOM, 'alice')).rejects.toThrow(
            'This room is no longer active.'
        );
    });

    it('rejects a room that does not exist', async () => {
        await seedRoom('some-other-room', []);

        await expect(requestReconnect('nonexistent-room', 'alice')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });
});

describe('approveReconnectRequest', () => {
    it("re-links the player document's uid and adds the requester to joinedUids", async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await approveReconnectRequest(ROOM, requestId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBe(auth.currentUser.uid);
        const roomSnapshot = await getDoc(doc(db, 'rooms', ROOM));
        expect(roomSnapshot.data().joinedUids).toContain(auth.currentUser.uid);
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('approved');
    });

    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const approveAsNonHost = callableAsNonHost('approveReconnectRequest');

        await expect(approveAsNonHost({ roomId: ROOM, requestId })).rejects.toThrow(
            /permission-denied|host/i
        );
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
    });

    it('rejects a request that has already been resolved', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await approveReconnectRequest(ROOM, requestId);

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been approved.'
        );
    });

    it('rejects a request naming a player who no longer exists, mutating nothing', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const { removePlayer } = await import('./removePlayer');
        await removePlayer('alice', ROOM);

        await expect(approveReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'The player this request was for no longer exists.'
        );
        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('pending');
    });
});

describe('denyReconnectRequest', () => {
    it('marks the request denied and writes nothing else', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');

        await denyReconnectRequest(ROOM, requestId);

        const requestSnapshot = await getDoc(
            doc(db, 'rooms', ROOM, 'reconnectRequests', requestId)
        );
        expect(requestSnapshot.data().status).toBe('denied');
        expect((await fetchPlayerForRoom('alice', ROOM)).data().uid).toBeUndefined();
    });

    it('requires the caller to be host', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        const denyAsNonHost = callableAsNonHost('denyReconnectRequest');

        await expect(denyAsNonHost({ roomId: ROOM, requestId })).rejects.toThrow(
            /permission-denied|host/i
        );
    });

    it('rejects a request that has already been resolved', async () => {
        await seedRoom(ROOM, [{ name: 'alice' }], { gameStarted: true });
        const { requestId } = await requestReconnect(ROOM, 'alice');
        await denyReconnectRequest(ROOM, requestId);

        await expect(denyReconnectRequest(ROOM, requestId)).rejects.toThrow(
            'This request has already been denied.'
        );
    });
});
```

Note: `removePlayer` is imported dynamically inside one test rather than
at the top of the file specifically to avoid an unused-import warning in
every other test in this file — if that reads awkwardly once written,
moving it to a normal top-level `import { removePlayer } from
'./removePlayer';` is equally correct and probably clearer; use your own
judgment on this one stylistic point, it does not change behavior.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:emulator -- --testPathPattern=reconnectRequestCallable`
Expected: FAIL — `Cannot find module './requestReconnect'` (Task 2
doesn't exist yet) or a Functions-emulator "no such function" error,
since none of the three callables exist yet. This is an acceptable
"fails for the right reason."

- [ ] **Step 3: Write `functions/callableFunctions/reconnectRequest.js`**

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue —
// see joinRoom.js's/removePlayer.js's identical comment for why (the
// Functions emulator strips static properties off the top-level
// admin.firestore binding).
const { FieldValue } = require('firebase-admin/firestore');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Creates a pending reconnect request for a player who already exists in
 * this room but whose current uid isn't the one that joined — mirrors
 * submitKillPhoto.js's "create a pending item for GM judgment" shape
 * (read-then-create inside one transaction), not the plain read+write
 * originally sketched in docs/superpowers/specs/
 * 2026-08-30-player-reconnect-design.md — every other "create a pending
 * item" Cloud Function in this codebase already transacts this, so this
 * does too, for consistency.
 *
 * No host check — callable by anyone signed in, since this is exactly
 * the case where the caller has just lost whatever identity they had
 * before and cannot prove anything about themselves yet.
 * joinRoom.js is what already rejected this join attempt (gameStarted is
 * true); this function doesn't trust that and re-checks independently.
 */
exports.requestReconnect = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, playerName } = data;
    if (!roomId || !playerName) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and playerName are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (!roomSnapshot.data().gameStarted) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This room has not started a game yet — just join normally.'
            );
        }
        if (roomSnapshot.data().isGameActive === false || roomSnapshot.data().endedAt) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This room is no longer active.'
            );
        }

        const trimmedLowercaseName = normalizePlayerName(playerName);
        const playerSnapshot = await transaction.get(playersRef.doc(trimmedLowercaseName));
        if (!playerSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                `No player named ${playerName} in this room.`
            );
        }

        const requestRef = roomRef.collection('reconnectRequests').doc();
        transaction.create(requestRef, {
            playerName: playerSnapshot.data().name,
            trimmedNameLowerCase: trimmedLowercaseName,
            requestingUid: context.auth.uid,
            status: 'pending',
            timestamp: FieldValue.serverTimestamp(),
        });

        return { requestId: requestRef.id };
    });
});

/**
 * Re-links an existing player document to a new uid and marks the
 * request approved — one transaction, so the player's uid, the room's
 * joinedUids, and the request's status all land together or not at all.
 * Host-only, mirrors killPlayer.js's/removePlayer.js's host check
 * exactly.
 */
exports.approveReconnectRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, requestId } = data;
    if (!roomId || !requestId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and requestId are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can approve a reconnect request.'
            );
        }

        const requestRef = roomRef.collection('reconnectRequests').doc(requestId);
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                `Reconnect request not found: ${requestId}`
            );
        }
        const requestData = requestSnapshot.data();
        if (requestData.status !== 'pending') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `This request has already been ${requestData.status}.`
            );
        }

        const playerRef = roomRef.collection('players').doc(requestData.trimmedNameLowerCase);
        const playerSnapshot = await transaction.get(playerRef);
        if (!playerSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                'The player this request was for no longer exists.'
            );
        }

        transaction.update(playerRef, { uid: requestData.requestingUid });
        transaction.update(roomRef, {
            joinedUids: FieldValue.arrayUnion(requestData.requestingUid),
        });
        transaction.update(requestRef, { status: 'approved' });
    });
});

/**
 * Marks a reconnect request denied. Host-only, same host check as
 * approveReconnectRequest. Touches no player data — mirrors how denying
 * a kill photo never touches player data either.
 */
exports.denyReconnectRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, requestId } = data;
    if (!roomId || !requestId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and requestId are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can deny a reconnect request.'
            );
        }

        const requestRef = roomRef.collection('reconnectRequests').doc(requestId);
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                `Reconnect request not found: ${requestId}`
            );
        }
        if (requestSnapshot.data().status !== 'pending') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `This request has already been ${requestSnapshot.data().status}.`
            );
        }

        transaction.update(requestRef, { status: 'denied' });
    });
});
```

- [ ] **Step 4: Register the three exports in `functions/index.js`**

Add, following the file's existing require/exports pattern exactly
(double-quoted requires, no semicolons after the `exports.X = X` lines):

```js
const {
    requestReconnect,
    approveReconnectRequest,
    denyReconnectRequest,
} = require('./callableFunctions/reconnectRequest');
exports.requestReconnect = requestReconnect;
exports.approveReconnectRequest = approveReconnectRequest;
exports.denyReconnectRequest = denyReconnectRequest;
```

Insert this block after the `leaveGame`/`removePlayer` block and before
the `cleanupEndedRooms` block.

- [ ] **Step 5: Add the new match block to `firestore.rules`**

Insert this new `match` block inside `rooms/{roomId}`, after the
`playerMessages` block and before the closing `}` of `rooms/{roomId}`:

```
      // No Player-facing `allow create` here at all, unlike photos/
      // playerMessages above — every write to this collection goes
      // through the three Cloud Functions in
      // functions/callableFunctions/reconnectRequest.js (Admin SDK,
      // bypasses rules entirely)
      // (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
      // The read grant covers both get and list uniformly (unlike the
      // top-level rooms collection's split grant) — this subcollection's
      // path is already bound to a known {roomId}, so it doesn't need
      // the query-shape workaround the rooms-level `allow list` grant
      // needs.
      match /reconnectRequests/{requestId} {
        allow read: if isHostOfExistingRoom(roomId) ||
          (isSignedIn() && resource.data.requestingUid == request.auth.uid);
        allow write: if false;
      }
```

- [ ] **Step 6: Add rules coverage in `test/firestore.rules.test.js`**

Read the file's shared `beforeEach` (around line 67) fresh first — add
one new seeded document there, alongside the existing `room-a`/`alice`/
`bob`/`task-1` seeds:

```js
await setDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1'), {
    playerName: 'alice',
    trimmedNameLowerCase: 'alice',
    requestingUid: OTHER_UID,
    status: 'pending',
});
```

(`OTHER_UID` already exists in this file as "a signed-in stranger who has
not joined the room" — using it as the seeded request's `requestingUid`
fits exactly: a reconnect requester looks identical to a stranger from
the room's own perspective, until approved.)

Then add a new `describe` block, mirroring the file's own
`rooms/{roomId}/players/{playerId}` block's exact style
(`test/firestore.rules.test.js:250-290`) — insert it after that block:

```js
describe('rooms/{roomId}/reconnectRequests/{requestId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it('allows the host to read', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it('allows the requester named on the request to read their own request', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it("denies a signed-in stranger who isn't the host or the requester", async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it('denies any client write, even from the host', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1'), {
                status: 'approved',
            })
        );
    });

    it('allows the host to list pending requests', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        const requestsQuery = query(
            collection(db, 'rooms', 'room-a', 'reconnectRequests'),
            where('status', '==', 'pending')
        );
        await assertSucceeds(getDocs(requestsQuery));
    });
});
```

- [ ] **Step 7: Sync vendored files and run the emulator + rules tests**

Run: `node functions/scripts/sync-shared-game-logic.js`

Run: `npm run test:emulator -- --testPathPattern=reconnectRequestCallable`
Expected: PASS, all tests green.

Run: `npm run test:rules`
Expected: PASS, including the new `reconnectRequests` describe block.

- [ ] **Step 8: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
npm run test:emulator
npm run test:rules
```

All six must be clean.

- [ ] **Step 9: Update `docs/testing.md`'s emulator suite enumeration**

Read the current state of `docs/testing.md` fresh — it currently says
"eleven further suites" (after the `removePlayerCallable` suite landed
earlier today). Update it: change "eleven" to "twelve", add
`reconnectRequestCallable.integration.test.js` to the enumeration
sentence with its actual test count (13 as drafted above — verify
against what actually landed after Step 8's gate run), update the running
total accordingly, and add a new row to the suite table further down the
file (mirroring `removePlayerCallable.integration.test.js`'s own row
format) describing what this suite covers: "The `requestReconnect`,
`approveReconnectRequest`, and `denyReconnectRequest` Cloud Functions via
`httpsCallable` (player-reconnect): a pending request requires an
existing player name and an active, started game; approval re-links the
player document's `uid` and adds the requester to `joinedUids` atomically
with marking the request approved; both judgment functions are host-only
and reject an already-resolved request; approval rejects a request
naming a player who no longer exists, mutating nothing."

- [ ] **Step 10: Commit**

```bash
git add functions/callableFunctions/reconnectRequest.js \
    src/components/reconnectRequestCallable.integration.test.js \
    functions/index.js firestore.rules test/firestore.rules.test.js \
    docs/testing.md
git commit -m "Add reconnectRequest Cloud Functions and their rules coverage"
```

---

## Task 2: Client wrappers

**Files:**

- Create: `src/components/requestReconnect.js`
- Create: `src/components/approveReconnectRequest.js`
- Create: `src/components/denyReconnectRequest.js`

**Interfaces:**

- Consumes: the three callables from Task 1.
- Produces: `requestReconnect(roomID, playerName)` → resolves to
  `{requestId}`; `approveReconnectRequest(roomID, requestId)` and
  `denyReconnectRequest(roomID, requestId)` → resolve to nothing
  meaningful. All reject with a real `.message` on failure. Tasks 4 and 6
  both import these by these exact names.

- [ ] **Step 1: Write `src/components/requestReconnect.js`**

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const requestReconnectCallable = httpsCallable(functions, 'requestReconnect');

/**
 * Requests to reclaim an existing player's identity in a room whose game
 * has already started — the caller's own uid becomes pending approval,
 * not immediately linked
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if playerName doesn't match an existing player, or the room
 *   hasn't started/is no longer active — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const requestReconnect = async (roomID, playerName) => {
    const { data } = await requestReconnectCallable({ roomId: roomID, playerName });
    return data;
};
```

- [ ] **Step 2: Write `src/components/approveReconnectRequest.js`**

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const approveReconnectRequestCallable = httpsCallable(functions, 'approveReconnectRequest');

/**
 * Approves a pending reconnect request — re-links the named player's
 * document to the requesting device's uid
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if the caller isn't the room's host, or the request has
 *   already been resolved — surfaces as a rejected promise carrying
 *   `.message`.
 */
export const approveReconnectRequest = async (roomID, requestId) => {
    await approveReconnectRequestCallable({ roomId: roomID, requestId });
};
```

- [ ] **Step 3: Write `src/components/denyReconnectRequest.js`**

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const denyReconnectRequestCallable = httpsCallable(functions, 'denyReconnectRequest');

/**
 * Denies a pending reconnect request — touches no player data
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if the caller isn't the room's host, or the request has
 *   already been resolved — surfaces as a rejected promise carrying
 *   `.message`.
 */
export const denyReconnectRequest = async (roomID, requestId) => {
    await denyReconnectRequestCallable({ roomId: roomID, requestId });
};
```

No dedicated unit test for these three files — mirrors `executeKill.js`/
`removePlayer.js`'s own precedent (exercised by Task 1's integration
tests and, once Tasks 4/6 land, by the component tests that mock them).

- [ ] **Step 4: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/requestReconnect.js \
    src/components/approveReconnectRequest.js \
    src/components/denyReconnectRequest.js
git commit -m "Add reconnect-request client wrappers"
```

---

## Task 3: `dbCalls.js` reads + data model doc

Fully independent of every other task — can run anytime.

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `docs/data-model.md`

**Interfaces:**

- Produces: `fetchReconnectRequestReferenceForRoom(requestId, roomID)` —
  a single doc reference for `onSnapshot`. `fetchPendingReconnectRequestsQueryForRoom(roomID)`
  — a live query filtered to `status === 'pending'`. Task 5 consumes the
  first; Task 6 consumes the second.

- [ ] **Step 1: Add the two new functions to `dbCalls.js`**

Read `fetchPlayerReferenceForRoom` (around line 412) and
`fetchPhotosQueryByAscendingTimestampForRoom` (around line 184) fresh
first, for their exact style, then add these two new functions near
`fetchPlayerReferenceForRoom` (both operate on room-scoped subcollections
the same way):

```js
// A reference to a specific reconnect request, for onSnapshot — lets
// ReconnectPending.js watch its own request's status live
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
export const fetchReconnectRequestReferenceForRoom = (requestId, roomID) => {
    return doc(db, 'rooms', roomID, 'reconnectRequests', requestId);
};

// A query of a room's still-pending reconnect requests, for onSnapshot —
// lets ReconnectRequests.js show the GM a live list to judge, the same
// role fetchPhotosQueryByAscendingTimestampForRoom plays for kill photos
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
export const fetchPendingReconnectRequestsQueryForRoom = (roomID) => {
    const requestsCollectionRef = collection(db, 'rooms', roomID, 'reconnectRequests');
    return query(requestsCollectionRef, where('status', '==', 'pending'));
};
```

(`doc`, `collection`, `query`, `where` are already imported at the top of
this file for other functions' use — confirm this when you read the file,
but no new imports should be needed.)

- [ ] **Step 2: Document the new subcollection in `docs/data-model.md`**

Read the existing `rooms/{roomID}/photos/{autoId}` section (around line 216) fresh for its exact prose-then-table format, then add a new section
in the same style — insert it after the `playerMessages` section (around
line 289) and before `## Room cleanup`:

```markdown
## `rooms/{roomID}/reconnectRequests/{autoId}`

Pending requests from a player whose device is signed in under a
different uid than the one that originally joined, asking to reclaim an
existing name once the game has started — written by the
`requestReconnect` Cloud Function
(`functions/callableFunctions/reconnectRequest.js`), judged by the host
via `approveReconnectRequest`/`denyReconnectRequest`
(docs/superpowers/specs/2026-08-30-player-reconnect-design.md). All three
run under the Admin SDK, which bypasses `firestore.rules` entirely —
`firestore.rules`' `reconnectRequests` match block has no player-facing
`allow create` at all, unlike `photos`/`playerMessages`, which at least
had one once (see those sections above).

| Field                  | Type                                  | Notes                                                                                                                                                  |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `playerName`           | `string`                              | The existing player's real stored-casing `name`, copied from their player document at request time.                                                    |
| `trimmedNameLowerCase` | `string`                              | The lookup key — same scheme every player document ID already uses. `approveReconnectRequest` re-reads the player document by this field, not by name. |
| `requestingUid`        | `string`                              | The new device's `context.auth.uid`. Written to the player document's own `uid` field, and added to the room's `joinedUids`, only once approved.       |
| `status`               | `'pending' \| 'approved' \| 'denied'` | Set once, never reverted — a resolved request cannot be re-judged; a fresh reconnect attempt creates a new request document instead.                   |
| `timestamp`            | `Timestamp`                           | `serverTimestamp()`, set once at creation.                                                                                                             |

`firestore.rules`' `reconnectRequests` `allow read` grant lets the
requester read their own request (`resource.data.requestingUid ==
request.auth.uid`) and lets the host read/list every request for their
room — nobody else can read this collection at all, and no client write
is ever permitted (`allow write: if false`).
```

- [ ] **Step 3: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

(No emulator/rules run needed — this task touches no Cloud Function and
no rules file.)

- [ ] **Step 4: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js docs/data-model.md
git commit -m "Add dbCalls reads for reconnect requests"
```

---

## Task 4: `JoinGame.js` reconnect fallback

**Files:**

- Modify: `src/pages/JoinGame.js`
- Test: `src/pages/JoinGame.test.jsx` (create if it doesn't already
  exist — check first; if it exists, extend it following its own
  established conventions instead of the shape below)

**Interfaces:**

- Consumes: `requestReconnect(roomID, playerName)` from Task 2.
- Produces: nothing new for later tasks — this is the player-facing entry
  point, self-contained.

- [ ] **Step 1: Check whether `src/pages/JoinGame.test.jsx` already exists**

Run: `ls src/pages/JoinGame.test.jsx`

If it exists, read it in full and follow its own established mocking
conventions for the steps below rather than the shape given here
verbatim — adapt, don't duplicate a second, differently-styled test
file for the same component. If it does not exist, create it as shown.

- [ ] **Step 2: Write the failing tests**

Create (or add to) `src/pages/JoinGame.test.jsx`:

```js
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * `joinRoom` and `requestReconnect` are both thin Cloud Function wrappers
 * — this mocks both directly rather than any Firestore call underneath
 * them (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import JoinGame from './JoinGame';
import { joinRoom } from '../components/joinRoom';
import { requestReconnect } from '../components/requestReconnect';

jest.mock('firebase/auth', () => ({
    signInAnonymously: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: { currentUser: { uid: 'test-uid' } } }));
jest.mock('../components/joinRoom', () => ({ joinRoom: jest.fn() }));
jest.mock('../components/requestReconnect', () => ({ requestReconnect: jest.fn() }));

const renderJoinGame = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/join']}>
                <Routes>
                    <Route path="/join" element={<JoinGame />} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                    <Route
                        path="/rooms/:roomID/reconnecting/:requestId"
                        element={<div>Reconnecting page</div>}
                    />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

const fillAndSubmit = async (gameId, playerName) => {
    await userEvent.type(screen.getByPlaceholderText('Game ID'), gameId);
    await userEvent.type(screen.getByPlaceholderText('Your name'), playerName);
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
};

beforeEach(() => {
    jest.clearAllMocks();
    signInAnonymously.mockResolvedValue(undefined);
});

describe('the reconnect fallback', () => {
    it('requests a reconnect and navigates to the reconnecting route when joinRoom says the game already started', async () => {
        joinRoom.mockRejectedValue(new Error('This game has already started.'));
        requestReconnect.mockResolvedValue({ requestId: 'request-1' });

        renderJoinGame();
        await fillAndSubmit('Fluffy42317', 'Alice');

        await waitFor(() => expect(requestReconnect).toHaveBeenCalledWith('Fluffy42317', 'Alice'));
        expect(await screen.findByText('Reconnecting page')).toBeInTheDocument();
    });

    it('surfaces any other joinRoom error normally, without calling requestReconnect', async () => {
        joinRoom.mockRejectedValue(new Error('Fluffy42317 is already taken in this room.'));

        renderJoinGame();
        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(
            await screen.findByText('Fluffy42317 is already taken in this room.')
        ).toBeInTheDocument();
        expect(requestReconnect).not.toHaveBeenCalled();
    });

    it("surfaces requestReconnect's own rejection as the visible error", async () => {
        joinRoom.mockRejectedValue(new Error('This game has already started.'));
        requestReconnect.mockRejectedValue(new Error('No player named Alice in this room.'));

        renderJoinGame();
        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('No player named Alice in this room.')).toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/pages/JoinGame.test.jsx -v`
Expected: FAIL — `handleSubmit`'s `catch` block doesn't have the
reconnect branch yet, so every "already started" rejection just shows
that error directly instead of calling `requestReconnect`.

- [ ] **Step 4: Add the reconnect-fallback branch**

In `src/pages/JoinGame.js`, add the import near the other imports:

```js
import { requestReconnect } from '../components/requestReconnect';
```

Replace the existing `catch` block in `handleSubmit`:

```js
        } catch (err) {
            setErrorMessage(err.message);
            console.error('Error joining game:', err);
        } finally {
            setIsSubmitting(false);
        }
```

with:

```js
        } catch (err) {
            if (err.message !== 'This game has already started.') {
                setErrorMessage(err.message);
                console.error('Error joining game:', err);
                return;
            }

            try {
                const { requestId } = await requestReconnect(trimmedGameId, playerName);
                navigate(`/rooms/${trimmedGameId}/reconnecting/${requestId}`);
            } catch (reconnectErr) {
                setErrorMessage(reconnectErr.message);
                console.error('Error requesting reconnect:', reconnectErr);
            }
        } finally {
            setIsSubmitting(false);
        }
```

(The early `return` inside the outer `catch`'s first branch still runs
the `finally` block afterward — that's normal JS control flow, not a bug
to fix.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/pages/JoinGame.test.jsx -v`
Expected: PASS, all tests green.

- [ ] **Step 6: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/JoinGame.js src/pages/JoinGame.test.jsx
git commit -m "Fall back to a reconnect request when joining a started game"
```

---

## Task 5: `ReconnectPending.js` page + route

**Files:**

- Create: `src/pages/ReconnectPending.js`
- Create: `src/pages/ReconnectPending.test.jsx`
- Modify: `src/App.js`

**Interfaces:**

- Consumes: `fetchReconnectRequestReferenceForRoom(requestId, roomID)`
  from Task 3.
- Produces: nothing new for later tasks — this is the requester-facing
  waiting screen, self-contained.

- [ ] **Step 1: Write the failing tests**

Create `src/pages/ReconnectPending.test.jsx`, mirroring
`src/pages/PlayerGame.test.jsx`'s mock-setup conventions (read that file
fresh first for its exact `jest.mock` shapes for `firebase/firestore` and
`dbCalls`):

```js
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the requester-facing side of
 * docs/superpowers/specs/2026-08-30-player-reconnect-design.md: shows a
 * waiting message while pending, redirects into the normal waiting-room
 * flow once approved (writing the session first), and shows a denied
 * message otherwise.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import ReconnectPending from './ReconnectPending';
import { fetchReconnectRequestReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { readPlayerSession } from '../utils/playerSession';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchReconnectRequestReferenceForRoom: jest.fn(() => 'request-ref'),
}));

const renderPending = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/reconnecting/request-1']}>
                <Routes>
                    <Route
                        path="/rooms/:roomID/reconnecting/:requestId"
                        element={<ReconnectPending />}
                    />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

it('fetches the request for this room and requestId', () => {
    onSnapshot.mockImplementation(() => () => {});
    renderPending();

    expect(fetchReconnectRequestReferenceForRoom).toHaveBeenCalledWith('request-1', 'Fluffy42317');
});

it('shows a waiting message while the request is pending', () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({ exists: () => true, data: () => ({ status: 'pending' }) });
        return () => {};
    });

    renderPending();

    expect(screen.getByText('Waiting for the host to approve your reconnect…')).toBeInTheDocument();
});

it('writes the session and navigates to the waiting room once approved', async () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({
            exists: () => true,
            data: () => ({ status: 'approved', playerName: 'Alice' }),
        });
        return () => {};
    });

    renderPending();

    expect(await screen.findByText('Waiting page')).toBeInTheDocument();
    expect(readPlayerSession()).toEqual({ roomID: 'Fluffy42317', playerName: 'Alice' });
});

it('shows a denied message and a way back home when denied', async () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({ exists: () => true, data: () => ({ status: 'denied' }) });
        return () => {};
    });

    renderPending();

    expect(screen.getByText('Your reconnect request was denied')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
});

it('treats the request document disappearing the same as denied', () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({ exists: () => false });
        return () => {};
    });

    renderPending();

    expect(screen.getByText('Your reconnect request was denied')).toBeInTheDocument();
});
```

Note: `readPlayerSession`/`playerSession.js` is left unmocked, matching
`PlayerGame.test.jsx`'s own established precedent (it touches only real
jsdom `localStorage`) — import it directly from `'../utils/playerSession'`
at the top of the test file alongside the other imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/pages/ReconnectPending.test.jsx -v`
Expected: FAIL — `Cannot find module './ReconnectPending'`, since the
component doesn't exist yet.

- [ ] **Step 3: Write `src/pages/ReconnectPending.js`**

```js
import React, { useEffect, useState } from 'react';
import { Button, Center, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { fetchReconnectRequestReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { writePlayerSession } from '../utils/playerSession';

// The requester-facing side of a mid-game reconnect
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md). Reached
// only via JoinGame.js's fallback when joinRoom rejects a join attempt
// specifically because the game has already started and the typed name
// belongs to an existing player. Watches its own request document live;
// once the host approves it, this device's uid has already been added to
// the room's joinedUids (approveReconnectRequest's own transaction did
// that), so writing the local session and navigating into the normal
// PlayerGame.js flow now succeeds the same way a fresh join would.
const ReconnectPending = () => {
    const { roomID, requestId } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('pending');

    useEffect(() => {
        if (!roomID || !requestId) return undefined;
        const requestRef = fetchReconnectRequestReferenceForRoom(requestId, roomID);
        const unsubscribe = onSnapshot(
            requestRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    setStatus('denied');
                    return;
                }
                const data = snapshot.data();
                if (data.status === 'approved') {
                    // The request document's own playerName, not a route
                    // param or anything else — this is the one value a
                    // subtle bug here would silently corrupt.
                    writePlayerSession(roomID, data.playerName);
                    navigate(`/rooms/${roomID}/waiting`, { replace: true });
                    return;
                }
                setStatus(data.status);
            },
            (error) => {
                console.error('Error watching reconnect request:', error);
                setStatus('denied');
            }
        );
        return () => unsubscribe();
    }, [roomID, requestId, navigate]);

    return (
        <Center h="100vh" p={4}>
            <Flex direction="column" alignItems="center" gap={4}>
                {status === 'pending' && (
                    <>
                        <Heading size="md">Waiting for the host to approve your reconnect…</Heading>
                        <Text>Hang tight — this updates automatically.</Text>
                    </>
                )}
                {status === 'denied' && (
                    <>
                        <Heading size="md">Your reconnect request was denied</Heading>
                        <Button colorScheme="teal" onClick={() => navigate('/')}>
                            Back to home
                        </Button>
                    </>
                )}
            </Flex>
        </Center>
    );
};

export default ReconnectPending;
```

- [ ] **Step 4: Add the new route to `src/App.js`**

Add the import near the other page imports:

```js
import ReconnectPending from './pages/ReconnectPending';
```

Add the new route, mirroring the `/rooms/:roomID/waiting` route's exact
`RequireAuth` wrapping — insert it right after that route:

```jsx
<Route
    path="/rooms/:roomID/reconnecting/:requestId"
    element={
        <RequireAuth>
            <ReconnectPending />
        </RequireAuth>
    }
/>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/pages/ReconnectPending.test.jsx -v`
Expected: PASS, all tests green.

- [ ] **Step 6: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/ReconnectPending.js src/pages/ReconnectPending.test.jsx src/App.js
git commit -m "Add the reconnect-pending page and its route"
```

---

## Task 6: `ReconnectRequests.js` GM component + wiring

**Files:**

- Create: `src/components/ReconnectRequests.js`
- Create: `src/components/ReconnectRequests.test.jsx`
- Modify: `src/pages/GameMasterView.js`

**Interfaces:**

- Consumes: `approveReconnectRequest`/`denyReconnectRequest` from Task 2;
  `fetchPendingReconnectRequestsQueryForRoom` from Task 3.
- Produces: nothing new for later tasks — this is the last piece, the
  moderator-facing side.

- [ ] **Step 1: Write the failing tests**

Read `src/components/photos_display_component/PhotosDisplay.test.jsx`'s
top-of-file mock setup fresh first (its `jest.mock('../firebase_calls/dbCalls', ...)`
factory shape and `executionContext`/`gameContext` provider wiring are
the direct precedent). Create
`src/components/ReconnectRequests.test.jsx`:

```js
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Mirrors PhotosDisplay.test.jsx's own mock-setup conventions — a GM-
 * facing live list with judgment buttons that call thin Cloud Function
 * wrappers and then log+broadcast the outcome
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import ReconnectRequests from './ReconnectRequests';
import { gameContext, executionContext } from '../Contexts';
import * as dbCalls from './firebase_calls/dbCalls';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('./firebase_calls/dbCalls', () => ({
    addPlayerMessageForRoom: jest.fn(),
    fetchPendingReconnectRequestsQueryForRoom: jest.fn(() => 'requests-query'),
}));
jest.mock('./approveReconnectRequest', () => ({ approveReconnectRequest: jest.fn() }));
jest.mock('./denyReconnectRequest', () => ({ denyReconnectRequest: jest.fn() }));

const executionHandlers = {
    addLog: jest.fn(),
};

const mountWithRequests = (requests) => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: requests.map((data, i) => ({ id: `request-${i}`, data: () => data })) });
        return () => {};
    });

    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <ReconnectRequests />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );
};

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.addPlayerMessageForRoom.mockResolvedValue(undefined);
    approveReconnectRequest.mockResolvedValue(undefined);
    denyReconnectRequest.mockResolvedValue(undefined);
});

it('renders nothing when there are no pending requests', () => {
    mountWithRequests([]);

    expect(screen.queryByText(/wants to reconnect/)).not.toBeInTheDocument();
});

it('renders a row for each pending request', () => {
    mountWithRequests([{ playerName: 'alice' }, { playerName: 'bob' }]);

    expect(screen.getByText('alice wants to reconnect')).toBeInTheDocument();
    expect(screen.getByText('bob wants to reconnect')).toBeInTheDocument();
});

it('calls approveReconnectRequest and logs/broadcasts on Approve', async () => {
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
        expect(approveReconnectRequest).toHaveBeenCalledWith('room-a', 'request-0')
    );
    expect(executionHandlers.addLog).toHaveBeenCalledWith('alice reconnected', 'blue.300');
    expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
        { type: 'broadcast', recipient: null, text: 'alice reconnected', standings: null },
        'room-a'
    );
});

it('calls denyReconnectRequest on Deny without broadcasting', async () => {
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(denyReconnectRequest).toHaveBeenCalledWith('room-a', 'request-0'));
    expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    expect(executionHandlers.addLog).not.toHaveBeenCalled();
});

it('shows an error toast when Approve is rejected', async () => {
    approveReconnectRequest.mockRejectedValue(new Error('This request has already been denied.'));
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('This request has already been denied.')).toBeInTheDocument();
});

it('shows an error toast when Deny is rejected', async () => {
    denyReconnectRequest.mockRejectedValue(new Error('This request has already been approved.'));
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(await screen.findByText('This request has already been approved.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/components/ReconnectRequests.test.jsx -v`
Expected: FAIL — `Cannot find module './ReconnectRequests'`.

- [ ] **Step 3: Write `src/components/ReconnectRequests.js`**

```js
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { gameContext, executionContext } from '../Contexts';
import {
    addPlayerMessageForRoom,
    fetchPendingReconnectRequestsQueryForRoom,
} from './firebase_calls/dbCalls';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';
import CreateAlert from './CreateAlert';

// The moderator-facing side of a mid-game reconnect
// (docs/superpowers/specs/2026-08-30-player-reconnect-design.md). Mirrors
// PhotosDisplay.js's own shape: a small live list of pending items, one
// row each, with judgment buttons that call a thin Cloud Function
// wrapper and then log+broadcast the outcome — Approve only; a denied
// request is never announced to players, matching how a denied kill
// photo isn't announced either.
const ReconnectRequests = () => {
    const { roomID } = useContext(gameContext);
    const { addLog } = useContext(executionContext);
    const [pendingRequests, setPendingRequests] = useState([]);
    const createAlert = CreateAlert();

    useEffect(() => {
        const requestsQuery = fetchPendingReconnectRequestsQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            requestsQuery,
            (snapshot) => {
                setPendingRequests(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
            },
            (error) => {
                console.error('Error fetching reconnect requests: ', error);
            }
        );
        return () => unsubscribe();
    }, [roomID]);

    const handleApprove = async (request) => {
        try {
            await approveReconnectRequest(roomID, request.id);
            await addLog(`${request.playerName} reconnected`, 'blue.300');
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: `${request.playerName} reconnected`,
                    standings: null,
                },
                roomID
            );
        } catch (error) {
            console.error('Error approving reconnect request: ', error);
            createAlert('error', 'Error approving reconnect', error.message, 1500);
        }
    };

    const handleDeny = async (request) => {
        try {
            await denyReconnectRequest(roomID, request.id);
        } catch (error) {
            console.error('Error denying reconnect request: ', error);
            createAlert('error', 'Error denying reconnect', error.message, 1500);
        }
    };

    if (pendingRequests.length === 0) return null;

    return (
        <Box sx={styles.container}>
            {pendingRequests.map((request) => (
                <Flex key={request.id} sx={styles.row}>
                    <Text>{request.playerName} wants to reconnect</Text>
                    <Button size="sm" colorScheme="red" onClick={() => handleDeny(request)}>
                        Deny
                    </Button>
                    <Button size="sm" colorScheme="green" onClick={() => handleApprove(request)}>
                        Approve
                    </Button>
                </Flex>
            ))}
        </Box>
    );
};

const styles = {
    container: {
        w: '100%',
        px: '8px',
    },
    row: {
        alignItems: 'center',
        gap: '8px',
        bg: 'yellow.700',
        borderRadius: '8px',
        p: '4px',
        mb: '4px',
    },
};

export default ReconnectRequests;
```

- [ ] **Step 4: Wire `<ReconnectRequests />` into `GameMasterView.js`**

Read the file fresh first (it changed for the leave/kick feature earlier
today — re-confirm exact current line numbers before editing). Add the
import near the other component imports:

```js
import ReconnectRequests from '../components/ReconnectRequests';
```

Find the existing comment explaining why `TaskListModal` needs its own
separate `executionContext.Provider` ("this modal sits outside both
narrower executionContext.Provider scopes below, so it gets its own") —
`ReconnectRequests` is in exactly the same situation: it needs `addLog`
from `executionContext`, but the header area (where it belongs visually,
right after `HeaderExecution`) sits outside both of the file's existing
narrower `executionContext.Provider` wrappers. Give it the same
treatment: insert this block immediately after the existing
`<Box h="6%" m="2px" marginX="4px"><HeaderExecution .../></Box>` block,
still inside the outer `gameContext.Provider` (so `roomID` resolves via
`useContext(gameContext)`):

```jsx
<executionContext.Provider value={executionContextProviderValues}>
    <ReconnectRequests />
</executionContext.Provider>
```

- [ ] **Step 4.5: Stub `ReconnectRequests` in `GameMasterView.test.jsx`**

Read `src/pages/GameMasterView.test.jsx` fresh — it already stubs both
`ChatInput` (around line 55) and `PhotosDisplay` (around line 64) with
`jest.mock(...)`, specifically because those are real child components
with their own Firestore subscriptions that this file's tests don't want
to also have to mock the underlying queries for. `ReconnectRequests` is
now the same situation — add an equivalent stub, mirroring
`PhotosDisplay`'s exact one-line functional-stub shape:

```js
jest.mock('../components/ReconnectRequests', () => () => <div>reconnect-requests-stub</div>);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/components/ReconnectRequests.test.jsx src/pages/GameMasterView.test.jsx -v`
Expected: PASS, all tests green in both files.

- [ ] **Step 6: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/components/ReconnectRequests.js \
    src/components/ReconnectRequests.test.jsx \
    src/pages/GameMasterView.js
git commit -m "Add the moderator-facing reconnect requests list"
```

---

## Final Verification

Once all six tasks are complete, run the full gate one more time from a
clean state to confirm nothing regressed across tasks:

```bash
npm run format
npm run lint
npm test
npm run build
npm run test:emulator
npm run test:rules
```

All six must be clean before considering this plan done.
