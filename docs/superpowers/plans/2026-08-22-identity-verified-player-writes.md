# Identity-Verified Player Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close kill-photo/chat identity spoofing, add rate limiting, freeze
player writes after a game ends, and add a narrow session-recovery
fallback — without touching Storage or any GM-side write path.

**Architecture:** Two new callable Cloud Functions (`submitKillPhoto`,
`submitChatMessage`) replace the current direct client writes to
`photos`/`playerMessages`, mirroring `functions/callableFunctions/killPlayer.js`'s
existing Admin-SDK-transaction pattern. Neither trusts a client-supplied
identity — each derives the caller's real name by looking up the player
doc whose `uid` matches `context.auth.uid`. `firestore.rules` loses the
player-facing `allow create` clauses these functions replace; the
separate, untouched `allow write: if isHostOfExistingRoom(roomId)` clause
on both collections keeps every GM action working exactly as before. A
narrow `Homepage.js` fallback recovers a player's session via a
`collectionGroup('players')` query keyed on their Firebase Auth uid when
`localStorage` has been cleared but the Auth session survived.

**Tech Stack:** Firebase Cloud Functions (Admin SDK), Firestore security
rules, React/CRA, Chakra UI, Jest (`unit`/`dom`/`integration`/`rules`
projects — see `docs/testing.md`).

## Global Constraints

- Rate limits: **10 kill-photo submissions per rolling 60000ms window**,
  **20 chat messages per rolling 60000ms window**, per player. Fixed
  window, not a true sliding window: expired → reset to `{start: now,
count: 1}`; not expired and under cap → increment; not expired and at
  cap → reject.
- The GM write path (`allow write: if isHostOfExistingRoom(roomId)`) on
  both `photos` and `playerMessages` must remain completely functional —
  this is regression-tested in Task 4, not just left alone by omission.
- Storage (`uploadKillPhoto`, `src/components/firebase_calls/storageCalls.js`,
  `storage.rules`) is completely out of scope. Do not touch it.
- Cross-device/cross-browser/incognito session recovery is explicitly out
  of scope and cannot be fixed by anything in this plan (Firebase
  anonymous-auth identity is device/browser-bound). Only the
  same-browser-cleared-localStorage case is being added.
- `#2` (Begin-Game roster-size lock), `#7` (restart/second round), `#12`
  (multi-GM support), and any change to `killPlayer.js` itself are out of
  scope.
- Every new Cloud Function matches `killPlayer.js`'s conventions exactly:
  Admin SDK, `functions.https.onCall`, every thrown error is a
  `functions.https.HttpsError` with one of `unauthenticated` /
  `invalid-argument` / `not-found` / `failed-precondition` /
  `resource-exhausted`, reads-before-writes inside `db.runTransaction`,
  and any shared `src/game/` logic is `require()`d from
  `../vendor/game/...`, never `../../src/game/...` (Cloud Functions deploy
  uploads only the `functions/` directory in isolation).

**Plan-writing corrections to the approved spec** (both required for
correctness, neither optional — read before starting):

1. **Kill-photo URL validation must move into `submitKillPhoto`, not be
   dropped.** The spec's illustrative code for `submitKillPhoto` didn't
   validate `url` at all. The player-facing `allow create` rule being
   deleted in Task 4 currently does this validation (an
   origin-and-path-pinned regex — the fix for `docs/improvements.md` item
   60, this session's most serious prior security defect: a wildcard
   origin that let any external host qualify). Deleting that rule without
   replicating the check in the new function would silently regress item 60. Task 1 extracts this into a pure, unit-tested `src/game/killPhotoUrl.js`
   function; Task 2 wires it into `submitKillPhoto`.
2. **`Homepage.js`'s recovery fallback must restore `playerSession.js`'s
   localStorage entry, not just navigate.** `PlayerGame.js` reads the
   player's _name_ from `readPlayerSession()`, matched against the current
   room — a bare redirect with no `writePlayerSession` call would land the
   player on the right room with an empty `playerName`, breaking their own
   target view, chat, and everything else keyed on it. Task 6 calls
   `writePlayerSession(roomID, name)` using the name from the recovered
   player doc before navigating.

---

## Task 1: Shared pure helpers — rate limiting and kill-photo URL validation

**Files:**

- Create: `src/game/rateLimit.js`
- Create: `src/game/rateLimit.test.js`
- Create: `src/game/killPhotoUrl.js`
- Create: `src/game/killPhotoUrl.test.js`
- Modify: `functions/scripts/sync-shared-game-logic.js`

**Interfaces:**

- Produces: `nextRateLimitWindow(currentWindow, nowMs, {max, windowMs})`
  → `{windowStartMs, count}` or `null`. Consumed by Task 2
  (`submitKillPhoto`) and Task 3 (`submitChatMessage`).
- Produces: `isValidKillPhotoUrl(url, roomId)` → `boolean`. Consumed by
  Task 2 (`submitKillPhoto`).
- Both are vendored into `functions/vendor/game/` (gitignored build
  output — `src/game/` stays the single source of truth) by
  `functions/scripts/sync-shared-game-logic.js`, which every Cloud
  Function test run and every deploy runs first.

### Step 1: Write the failing test for `nextRateLimitWindow`

```js
// src/game/rateLimit.test.js
const { nextRateLimitWindow } = require('./rateLimit');

describe('nextRateLimitWindow', () => {
    it('starts a fresh window when there is no current window', () => {
        const result = nextRateLimitWindow(null, 1000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 1000, count: 1 });
    });

    it('increments count when still within the window and under the cap', () => {
        const current = { windowStartMs: 1000, count: 3 };
        const result = nextRateLimitWindow(current, 5000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 1000, count: 4 });
    });

    it('rejects (returns null) once the cap is reached within the window', () => {
        const current = { windowStartMs: 1000, count: 10 };
        const result = nextRateLimitWindow(current, 5000, { max: 10, windowMs: 60000 });
        expect(result).toBeNull();
    });

    it('resets to a fresh window once the window has elapsed, even if the cap was reached', () => {
        const current = { windowStartMs: 1000, count: 10 };
        const result = nextRateLimitWindow(current, 61000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 61000, count: 1 });
    });

    it('treats exactly windowMs elapsed as expired, not still-current', () => {
        const current = { windowStartMs: 1000, count: 1 };
        const result = nextRateLimitWindow(current, 61000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 61000, count: 1 });
    });
});
```

### Step 2: Run it to verify it fails

Run: `npx jest src/game/rateLimit.test.js`
Expected: FAIL with "Cannot find module './rateLimit'" (the file doesn't
exist yet).

### Step 3: Implement `nextRateLimitWindow`

```js
// src/game/rateLimit.js
/**
 * Decides the next state of a rolling rate-limit window, given the
 * current one (or none) and the current time. Pure — no Firestore, no
 * Date.now() call inside; the caller supplies `nowMs` so this stays fully
 * deterministic and testable. Returns the window to persist when the
 * submission is allowed, or `null` when the cap has been hit and the
 * caller should reject.
 *
 * A fixed window, not a true sliding one: once `windowMs` has elapsed
 * since `windowStartMs`, the count resets entirely rather than decaying
 * gradually. Used by both submitKillPhoto.js and submitChatMessage.js to
 * enforce a burst allowance — not a fixed per-submission cooldown, which
 * would block legitimate rapid-fire kill-photo submission during a fast
 * moment in the game
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * playerNames.js's convention in this directory — also required by a
 * Cloud Function via functions/vendor/game/ (functions/scripts/
 * sync-shared-game-logic.js).
 */
const nextRateLimitWindow = (currentWindow, nowMs, { max, windowMs }) => {
    if (!currentWindow || nowMs - currentWindow.windowStartMs >= windowMs) {
        return { windowStartMs: nowMs, count: 1 };
    }
    if (currentWindow.count < max) {
        return { windowStartMs: currentWindow.windowStartMs, count: currentWindow.count + 1 };
    }
    return null;
};

module.exports = { nextRateLimitWindow };
```

### Step 4: Run it to verify it passes

Run: `npx jest src/game/rateLimit.test.js`
Expected: PASS, 5 tests.

### Step 5: Write the failing test for `isValidKillPhotoUrl`

These cases are migrated verbatim (same literal URLs) from
`test/firestore.rules.test.js`'s `BYPASS_URLS` and realistic-URL
constants — that file's own player-create tests are deleted in Task 4
since the rule they exercised no longer exists; this is where that
coverage now lives, as fast unit tests instead of slow emulator ones.

```js
// src/game/killPhotoUrl.test.js
const { isValidKillPhotoUrl } = require('./killPhotoUrl');

const REALISTIC_ROOM_A_PHOTO_URL =
    'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Froom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';

const REALISTIC_EMULATOR_ROOM_A_PHOTO_URL =
    'http://localhost:9199/v0/b/demo-mall-mystery-heroes.appspot.com/o/rooms%2Froom-a%2Fphotos%2F0b68bae5-b8ab-4dfc-b675-585fb9847a9f.jpg?alt=media&token=70af1544-8755-496b-a111-b020b62d7392';

describe('isValidKillPhotoUrl', () => {
    it("accepts a realistic production download URL for this room's own Storage path", () => {
        expect(isValidKillPhotoUrl(REALISTIC_ROOM_A_PHOTO_URL, 'room-a')).toBe(true);
    });

    it("accepts a realistic Storage-emulator download URL for this room's own path", () => {
        expect(isValidKillPhotoUrl(REALISTIC_EMULATOR_ROOM_A_PHOTO_URL, 'room-a')).toBe(true);
    });

    it('rejects a url that does not point at Firebase Storage at all', () => {
        expect(isValidKillPhotoUrl('https://evil.example.com/x.jpg', 'room-a')).toBe(false);
    });

    it("rejects a url pointing at a different room's Storage path", () => {
        const url =
            'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Fsome-other-room%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';
        expect(isValidKillPhotoUrl(url, 'room-a')).toBe(false);
    });

    // Regression cases for the origin-pinning bug (docs/improvements.md
    // item 60). The first version of this check was
    // `.*/o/rooms%2F{roomId}%2Fphotos%2F.*`, so every one of these was
    // ACCEPTED: the required path segment only had to appear somewhere in
    // the string, which an attacker controls entirely.
    const BYPASS_URLS = {
        'an external host carrying the room path segment in its own path':
            'https://evil.example.com/o/rooms%2Froom-a%2Fphotos%2Fx.jpg',
        'a lookalike host that merely starts with the real Storage host':
            'https://firebasestorage.googleapis.com.evil.example.com/v0/b/b/o/rooms%2Froom-a%2Fphotos%2Fy.jpg',
        'an external host carrying the path segment in its query string':
            'https://evil.example.com/track.gif?z=/o/rooms%2Froom-a%2Fphotos%2F',
        'a plain-http host on the local network':
            'http://10.0.0.5:8080/o/rooms%2Froom-a%2Fphotos%2Fz.jpg',
        'a host differing from the real Storage host only in a dot position':
            'https://firebasestorageXgoogleapis.com/v0/b/b/o/rooms%2Froom-a%2Fphotos%2Fw.jpg',
    };

    for (const [description, url] of Object.entries(BYPASS_URLS)) {
        it(`rejects a url that is ${description}`, () => {
            expect(isValidKillPhotoUrl(url, 'room-a')).toBe(false);
        });
    }

    it('escapes roomId so it cannot be used to smuggle regex syntax', () => {
        // Not reachable via real room IDs today (uniqueNamesGenerator
        // output has no regex metacharacters), but this function has no
        // way to know that about its caller, so it must not assume it.
        const url =
            'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2FXroom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';
        expect(isValidKillPhotoUrl(url, '.room-a')).toBe(false);
    });
});
```

### Step 6: Run it to verify it fails

Run: `npx jest src/game/killPhotoUrl.test.js`
Expected: FAIL with "Cannot find module './killPhotoUrl'".

### Step 7: Implement `isValidKillPhotoUrl`

```js
// src/game/killPhotoUrl.js
/**
 * Whether `url` is a legitimate download URL for a kill-photo this room's
 * own Storage upload actually produced — the whole string must START
 * with an allowed Storage origin (production
 * `https://firebasestorage.googleapis.com`, or the
 * `http://localhost:9199` emulator origin `getDownloadURL` actually
 * returns under `npm run test:emulator`) AND carry this room's own
 * `/v0/b/{bucket}/o/rooms%2F{roomId}%2Fphotos%2F` object path, with no
 * `/` left in the trailing filename+query.
 *
 * Ported from firestore.rules's now-deleted player-facing `photos`
 * `allow create` clause (docs/improvements.md item 60 fixed the same
 * origin-pinning bug there; that history is preserved in this file's own
 * test cases, migrated verbatim). Pinning the origin is what matters: a
 * `.*` prefix would let any host qualify just by carrying the path
 * segment somewhere in its own path or query string.
 *
 * The {bucket} segment is deliberately a wildcard, not this project's own
 * bucket name: production and the emulator use different buckets
 * (`mall-mystery-heroes.firebasestorage.app` vs
 * `demo-mall-mystery-heroes.appspot.com`), and pinning the wrong one
 * would reject every real upload.
 *
 * `roomId` is regex-escaped here (unlike the rules version it replaces,
 * which spliced it in raw on the documented assumption that
 * uniqueNamesGenerator-produced room IDs never contain a regex
 * metacharacter) — cheap to do correctly, so this function makes no
 * assumption about its caller.
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * playerNames.js's convention in this directory — also required by a
 * Cloud Function via functions/vendor/game/ (functions/scripts/
 * sync-shared-game-logic.js).
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidKillPhotoUrl = (url, roomId) => {
    const pattern = new RegExp(
        '^(https://firebasestorage\\.googleapis\\.com|http://localhost:9199)' +
            '/v0/b/[^/]+/o/rooms%2F' +
            escapeRegExp(roomId) +
            '%2Fphotos%2F[^/]*$'
    );
    return pattern.test(url);
};

module.exports = { isValidKillPhotoUrl };
```

### Step 8: Run it to verify it passes

Run: `npx jest src/game/killPhotoUrl.test.js`
Expected: PASS, all cases.

### Step 9: Vendor both new modules for Cloud Function use

```js
// functions/scripts/sync-shared-game-logic.js — modify the FILES array
const FILES = [
    'remapPlan.js',
    'playerNames.js',
    'targetGraph.js',
    'rateLimit.js',
    'killPhotoUrl.js',
];
```

### Step 10: Run the full unit suite and commit

Run: `npm run format && npm run lint && npm test`
Expected: format/lint clean; `npm test` passes with the 2 new suites
included (this repo's `unit` project already picks up any
`src/game/**/*.test.js`, no config change needed).

```bash
git add src/game/rateLimit.js src/game/rateLimit.test.js \
    src/game/killPhotoUrl.js src/game/killPhotoUrl.test.js \
    functions/scripts/sync-shared-game-logic.js
git commit -m "Add shared rate-limit-window and kill-photo-url pure helpers"
```

---

## Task 2: `submitKillPhoto` Cloud Function

**Files:**

- Create: `functions/callableFunctions/submitKillPhoto.js`
- Create: `src/components/submitKillPhoto.js`
- Create: `src/components/submitKillPhoto.integration.test.js`
- Modify: `test/emulatorHelpers.js`

**Interfaces:**

- Consumes: `nextRateLimitWindow` from `../vendor/game/rateLimit` (Task 1).
  `isValidKillPhotoUrl` from `../vendor/game/killPhotoUrl` (Task 1).
  `normalizePlayerName` from `../vendor/game/playerNames` (pre-existing,
  already vendored).
- Produces: `submitKillPhoto({roomId, target, url}) => Promise<void>`
  (client wrapper), consumed by Task 5 (`MessageComposer.js`). Produces
  the extended `createIndependentIdentity()` return shape
  `{uid, db, functions}` in `test/emulatorHelpers.js`, consumed by Task 3.

### Step 1: Extend `createIndependentIdentity` to also return a bound `functions` instance

Testing "call `submitKillPhoto` as a specific, pre-seeded player" needs an
identity whose `uid` is known _before_ the call (so a matching player doc
can be seeded first) — unlike `callableAsNonHost`, which signs in fresh
inside the call itself. `createIndependentIdentity` already signs in
ahead of time and returns the resulting `uid`; it just doesn't yet expose
a `functions` instance bound to that same identity to call through.

```js
// test/emulatorHelpers.js — modify createIndependentIdentity
export const createIndependentIdentity = async () => {
    const app = initializeApp(
        readFirebaseConfig(process.env),
        `identity-${Date.now()}-${Math.random()}`
    );
    const identityAuth = getAuth(app);
    const identityDb = getFirestore(app);
    const identityFunctions = getFunctions(app);
    connectAuthEmulator(identityAuth, 'http://localhost:9099');
    connectFirestoreEmulator(identityDb, 'localhost', 8081);
    connectFunctionsEmulator(identityFunctions, 'localhost', 5001);

    const credential = await signInAnonymously(identityAuth);
    return { uid: credential.user.uid, db: identityDb, functions: identityFunctions };
};
```

This is additive — every existing caller destructures only `{uid, db}`
and keeps working unchanged.

### Step 2: Write the failing integration test

```js
// src/components/submitKillPhoto.integration.test.js
/**
 * Layer 1b — the identity-verified kill-photo submission Cloud Function,
 * against the real Functions, Firestore, and Auth emulators together.
 * submitKillPhoto is a thin wrapper around
 * httpsCallable(functions, 'submitKillPhoto') — these tests call it
 * exactly the way the real app does, then assert on what actually landed
 * in Firestore, matching executeKill.integration.test.js's approach
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 */
import { httpsCallable } from 'firebase/functions';
import { terminate, getDocs, Timestamp } from 'firebase/firestore';
import { submitKillPhoto } from './submitKillPhoto';
import { fetchPhotosQueryByAscendingTimestampForRoom } from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';
const REALISTIC_URL =
    'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Ftest-room%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('submitKillPhoto', () => {
    it("writes the photo with the caller's own real name as assassin, never a client-supplied one", async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [{ name: 'alice', uid: alice.uid }, { name: 'bob' }],
                {},
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL });

            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                assassin: 'alice',
                target: 'bob',
                url: REALISTIC_URL,
                status: 'pending',
                originalPlayerData: null,
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a url that does not point at this room’s own Storage path', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [{ name: 'alice', uid: alice.uid }, { name: 'bob' }],
                {},
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, target: 'bob', url: 'https://evil.example.com/x.jpg' })
            ).rejects.toThrow('invalid-argument');
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const call = callableAsNonHost('submitKillPhoto');

        await expect(call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });

    it('rejects once the game has ended', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [{ name: 'alice', uid: alice.uid }, { name: 'bob' }],
                { isGameActive: false },
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })).rejects.toThrow(
                'This game has ended.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects an unknown target', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], {}, alice.db);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, target: 'nobody', url: REALISTIC_URL })
            ).rejects.toThrow('Player not found: nobody');
        } finally {
            await terminate(alice.db);
        }
    });

    it('allows up to 10 submissions in a window and rejects the 11th', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [{ name: 'alice', uid: alice.uid }, { name: 'bob' }],
                {},
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            for (let i = 0; i < 10; i += 1) {
                await expect(
                    call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })
                ).resolves.toBeDefined();
            }

            await expect(call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })).rejects.toThrow(
                'Too many submissions'
            );
        } finally {
            await terminate(alice.db);
        }
    }, 30000);

    it('allows a submission again once the window has elapsed, even if the cap was reached', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [
                    {
                        name: 'alice',
                        uid: alice.uid,
                        rateLimits: {
                            photo: {
                                windowStart: Timestamp.fromMillis(Date.now() - 61000),
                                count: 10,
                            },
                        },
                    },
                    { name: 'bob' },
                ],
                {},
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, target: 'bob', url: REALISTIC_URL })
            ).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });
});
```

### Step 3: Run it to verify it fails

Run: `npm run test:emulator -- --testPathPattern submitKillPhoto`
Expected: FAIL — `submitKillPhoto` doesn't exist yet, `Cannot find
module './submitKillPhoto'`, and the Cloud Function isn't deployed to the
Functions emulator either.

### Step 4: Implement the client wrapper

```js
// src/components/submitKillPhoto.js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const submitKillPhotoCallable = httpsCallable(functions, 'submitKillPhoto');

/**
 * Submits a kill-photo claim on the caller's own behalf — the Cloud
 * Function derives who "the caller" is from their own signed-in identity,
 * so there is no assassin name to pass here, only which target and which
 * already-uploaded photo url
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 * uploadKillPhoto (storageCalls.js) still handles the Storage upload
 * itself, unchanged — this only writes the Firestore doc pointing at it.
 *
 * @throws if the caller isn't a player of the room, the game has ended,
 *   the url isn't a legitimate photo for this room, the rate limit is
 *   exceeded, or target doesn't exist — surfaces as a rejected promise
 *   carrying `.message`, same as executeKill.js (docs/improvements.md
 *   item 10's error-propagation pattern needs no changes to handle this).
 */
export const submitKillPhoto = async ({ roomId, target, url }) => {
    await submitKillPhotoCallable({ roomId, target, url });
};
```

### Step 5: Implement the Cloud Function

```js
// functions/callableFunctions/submitKillPhoto.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { normalizePlayerName } = require('../vendor/game/playerNames');
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');
const { isValidKillPhotoUrl } = require('../vendor/game/killPhotoUrl');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const PHOTO_RATE_LIMIT = { max: 10, windowMs: 60000 };

/**
 * Writes a kill-photo submission on the caller's behalf, deriving who the
 * caller actually is from context.auth.uid rather than trusting a
 * client-supplied `assassin` field — closing the identity-spoofing gap
 * addPhotoForRoom (src/components/firebase_calls/dbCalls.js, deleted in
 * Task 5 of this plan) had, where any signed-in room member could claim
 * to be any named player. Also enforces the room being active and a
 * per-player rate limit, and re-implements the url-origin validation
 * firestore.rules' now-deleted player-facing `photos` allow create clause
 * used to do (docs/improvements.md item 60) — rules don't apply to the
 * Admin SDK, so this is the actual enforcement for all of it now
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely.
 * firestore.rules's `photos` `allow write: if isHostOfExistingRoom`
 * clause for GM approve/deny/undo actions is untouched and unaffected by
 * this function.
 */
exports.submitKillPhoto = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, target, url } = data;
    if (!roomId || !target || !url) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId, target, and url are all required.'
        );
    }
    if (!isValidKillPhotoUrl(url, roomId)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            "url does not point at this room's own Storage path."
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        // --- read phase ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }

        const assassinSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (assassinSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'You are not a player of this room.');
        }
        const assassinDoc = assassinSnapshot.docs[0];
        const assassinData = assassinDoc.data();

        if (!roomSnapshot.data().isGameActive) {
            throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
        }

        const targetSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(target))
        );
        if (targetSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${target}`);
        }

        const rateLimits = assassinData.rateLimits || {};
        const currentWindow = rateLimits.photo
            ? {
                  windowStartMs: rateLimits.photo.windowStart.toMillis(),
                  count: rateLimits.photo.count,
              }
            : null;
        const nextWindow = nextRateLimitWindow(currentWindow, Date.now(), PHOTO_RATE_LIMIT);
        if (!nextWindow) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions — slow down and try again in a moment.'
            );
        }

        // --- write phase ---

        transaction.update(assassinDoc.ref, {
            rateLimits: {
                ...rateLimits,
                photo: {
                    windowStart: admin.firestore.Timestamp.fromMillis(nextWindow.windowStartMs),
                    count: nextWindow.count,
                },
            },
        });

        transaction.create(roomRef.collection('photos').doc(), {
            url,
            assassin: assassinData.name,
            target,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            originalPlayerData: null,
        });
    });
});
```

### Step 6: Register the function's export and run the test

`functions/index.js` exports every callable/scheduled function
individually — it does not auto-discover them. Add, after the existing
`joinRoom` export block:

```js
// functions/index.js
const { submitKillPhoto } = require('./callableFunctions/submitKillPhoto');
exports.submitKillPhoto = submitKillPhoto;
```

Run: `npm run test:emulator -- --testPathPattern submitKillPhoto`
Expected: PASS, all 7 cases (identity-derivation, url-rejection,
non-player rejection, ended-game rejection, unknown-target rejection,
rate-limit cap, rate-limit reset).

### Step 7: Run the full gate and commit

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all clean. (`npm run test:emulator` was already run in Step 6 —
no need to re-run here per this repo's established convention of not
re-running the same emulator suite twice in one task.)

```bash
git add functions/callableFunctions/submitKillPhoto.js \
    src/components/submitKillPhoto.js \
    src/components/submitKillPhoto.integration.test.js \
    test/emulatorHelpers.js functions/index.js
git commit -m "Add submitKillPhoto: identity-verified, rate-limited kill-photo submission"
```

---

## Task 3: `submitChatMessage` Cloud Function

**Files:**

- Create: `functions/callableFunctions/submitChatMessage.js`
- Create: `src/components/submitChatMessage.js`
- Create: `src/components/submitChatMessage.integration.test.js`

**Interfaces:**

- Consumes: `nextRateLimitWindow` from `../vendor/game/rateLimit` (Task 1).
  The extended `createIndependentIdentity()` (Task 2, `test/emulatorHelpers.js`).
- Produces: `submitChatMessage({roomId, text}) => Promise<void>` (client
  wrapper), consumed by Task 5 (`MessageComposer.js`).

### Step 1: Write the failing integration test

```js
// src/components/submitChatMessage.integration.test.js
/**
 * Layer 1b — the identity-verified chat-message submission Cloud
 * Function, against the real Functions, Firestore, and Auth emulators
 * together. Same approach as submitKillPhoto.integration.test.js and
 * executeKill.integration.test.js.
 */
import { httpsCallable } from 'firebase/functions';
import { terminate, getDocs, Timestamp } from 'firebase/firestore';
import { submitChatMessage } from './submitChatMessage';
import { fetchPlayerMessagesQueryForRoom } from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('submitChatMessage', () => {
    it("writes the message with the caller's own real name as sender, never a client-supplied one", async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], {}, alice.db);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await call({ roomId: ROOM, text: 'hey where are you' });

            const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                type: 'chat',
                recipient: null,
                text: 'hey where are you',
                standings: null,
                mission: null,
                sender: 'alice',
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, []);
        const call = callableAsNonHost('submitChatMessage');

        await expect(call({ roomId: ROOM, text: 'hi' })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });

    it('rejects once the game has ended', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [{ name: 'alice', uid: alice.uid }],
                { isGameActive: false },
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'hi' })).rejects.toThrow(
                'This game has ended.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('allows up to 20 messages in a window and rejects the 21st', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], {}, alice.db);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            for (let i = 0; i < 20; i += 1) {
                await expect(call({ roomId: ROOM, text: `msg-${i}` })).resolves.toBeDefined();
            }

            await expect(call({ roomId: ROOM, text: 'msg-20' })).rejects.toThrow(
                'Too many submissions'
            );
        } finally {
            await terminate(alice.db);
        }
    }, 30000);

    it('allows a message again once the window has elapsed, even if the cap was reached', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(
                ROOM,
                [
                    {
                        name: 'alice',
                        uid: alice.uid,
                        rateLimits: {
                            chat: {
                                windowStart: Timestamp.fromMillis(Date.now() - 61000),
                                count: 20,
                            },
                        },
                    },
                ],
                {},
                alice.db
            );
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'hi again' })).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });
});
```

### Step 2: Run it to verify it fails

Run: `npm run test:emulator -- --testPathPattern submitChatMessage`
Expected: FAIL — `submitChatMessage` doesn't exist yet.

### Step 3: Implement the client wrapper

```js
// src/components/submitChatMessage.js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const submitChatMessageCallable = httpsCallable(functions, 'submitChatMessage');

/**
 * Sends a player group-chat message on the caller's own behalf — the
 * Cloud Function derives who "the caller" is from their own signed-in
 * identity, so there is no sender name to pass here, only the text
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * @throws if the caller isn't a player of the room, the game has ended,
 *   or the rate limit is exceeded — surfaces as a rejected promise
 *   carrying `.message`, same as executeKill.js.
 */
export const submitChatMessage = async ({ roomId, text }) => {
    await submitChatMessageCallable({ roomId, text });
};
```

### Step 4: Implement the Cloud Function

```js
// functions/callableFunctions/submitChatMessage.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const CHAT_RATE_LIMIT = { max: 20, windowMs: 60000 };

/**
 * Writes a player chat message on the caller's behalf, deriving who the
 * caller actually is from context.auth.uid rather than trusting a
 * client-supplied `sender` field — closing the identity-spoofing gap
 * addChatMessageForRoom (src/components/firebase_calls/dbCalls.js,
 * deleted in Task 5 of this plan) had. Also enforces the room being
 * active and a per-player rate limit
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely.
 * firestore.rules's `playerMessages` `allow write: if
 * isHostOfExistingRoom` clause for GM broadcasts/whispers/leaderboard/
 * mission messages is untouched and unaffected by this function — those
 * write a different set of `type` values (never `'chat'`) through a
 * separate, still-existing dbCalls.addPlayerMessageForRoom path.
 */
exports.submitChatMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, text } = data;
    if (!roomId || !text) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and text are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }

        const senderSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (senderSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', 'You are not a player of this room.');
        }
        const senderDoc = senderSnapshot.docs[0];
        const senderData = senderDoc.data();

        if (!roomSnapshot.data().isGameActive) {
            throw new functions.https.HttpsError('failed-precondition', 'This game has ended.');
        }

        const rateLimits = senderData.rateLimits || {};
        const currentWindow = rateLimits.chat
            ? {
                  windowStartMs: rateLimits.chat.windowStart.toMillis(),
                  count: rateLimits.chat.count,
              }
            : null;
        const nextWindow = nextRateLimitWindow(currentWindow, Date.now(), CHAT_RATE_LIMIT);
        if (!nextWindow) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions — slow down and try again in a moment.'
            );
        }

        transaction.update(senderDoc.ref, {
            rateLimits: {
                ...rateLimits,
                chat: {
                    windowStart: admin.firestore.Timestamp.fromMillis(nextWindow.windowStartMs),
                    count: nextWindow.count,
                },
            },
        });

        transaction.create(roomRef.collection('playerMessages').doc(), {
            type: 'chat',
            recipient: null,
            text,
            standings: null,
            mission: null,
            sender: senderData.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
});
```

### Step 5: Register the export and run the test

Add, after the `submitKillPhoto` export Task 2 added to
`functions/index.js`:

```js
// functions/index.js
const { submitChatMessage } = require('./callableFunctions/submitChatMessage');
exports.submitChatMessage = submitChatMessage;
```

Run: `npm run test:emulator -- --testPathPattern submitChatMessage`
Expected: PASS, all 5 cases.

### Step 6: Run the full gate and commit

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all clean.

```bash
git add functions/callableFunctions/submitChatMessage.js \
    src/components/submitChatMessage.js \
    src/components/submitChatMessage.integration.test.js \
    functions/index.js
git commit -m "Add submitChatMessage: identity-verified, rate-limited chat submission"
```

---

## Task 4: `firestore.rules` — close the old paths, open the new one

**Files:**

- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Consumes: nothing from Tasks 1-3 — this task only needs to know the
  _names_ of the collections/rule shapes involved, not the Cloud
  Functions' internals. Can be implemented independently of Tasks 1-3,
  though it is sequenced after them in this plan so the narrative reads
  "build the new path, then close the old one."
- Produces: the `players` collection-group `allow list` rule, consumed by
  Task 6 (`Homepage.js`).

### Step 1: Write the failing rules tests

Three kinds of changes to `test/firestore.rules.test.js`:

**(a)** Add `collectionGroup` to the `firebase/firestore` import list at
the top of the file (currently `doc, getDoc, getDocs, setDoc, updateDoc,
collection, addDoc, query, where` — add `collectionGroup`).

**(b)** In the `rooms/{roomId}/photos/{photoId}` describe block: delete
every test that exercised the player-facing `allow create` clause being
removed — `"allows a player to create a photo with pending status..."`,
`"allows a player to create a photo whose url is a Storage emulator..."`,
`"denies a player creating a photo with a non-pending status"`, `"denies
a player creating a photo with a non-null originalPlayerData"`, `"denies
a player creating a photo whose url does not point at Firebase Storage at
all"`, `"denies a player creating a photo whose url points at a
different room's Storage path"`, and the whole `BYPASS_URLS`
loop-generated block — along with the now-unused
`REALISTIC_ROOM_A_PHOTO_URL`, `REALISTIC_EMULATOR_ROOM_A_PHOTO_URL`, and
`BYPASS_URLS` constants themselves. That coverage now lives in
`src/game/killPhotoUrl.test.js` (Task 1). Keep the unauthenticated-read,
stranger-read-denial, player-read-success, non-host-write-denial, and
host-write-success tests — those exercise `allow read`/`allow write`,
untouched by this change. Add one new test:

```js
it('denies a player creating a photo directly (removed — submitKillPhoto is now the only path)', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: 'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Froom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
        })
    );
});
```

**(c)** In the `rooms/{roomId}/playerMessages/{messageId}` describe
block: delete `"allows a player to create a chat message with a null
recipient"`, `"denies a player creating a chat message with a non-null
recipient"`, and `"denies a player creating a non-chat message, e.g. a
fake broadcast"` — all three exercise the player-facing `allow create`
clause being removed. Keep the read tests and the non-host/host `allow
write` tests unchanged (those are the GM-broadcast regression coverage
this task's Global Constraint requires — they already exist and already
pass; no new test needed to prove they still do, since nothing about
`allow write` changes). Add one new test:

```js
it('denies a player creating a chat message directly (removed — submitChatMessage is now the only path)', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
            type: 'chat',
            recipient: null,
            text: 'hey where are you',
            standings: null,
            mission: null,
            sender: 'bob',
        })
    );
});
```

**(d)** Add a new top-level describe block for the session-recovery list
rule, after the `playerMessages` block. The existing `beforeEach` fixture
already seeds `bob` with `uid: PLAYER_UID` — reuse it directly:

```js
describe('players collection group (session recovery)', () => {
    it('allows a query scoped to the callers own uid', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        const playersQuery = query(collectionGroup(db, 'players'), where('uid', '==', PLAYER_UID));
        const snapshot = await assertSucceeds(getDocs(playersQuery));
        expect(snapshot.docs.map((d) => d.id)).toEqual(['bob']);
    });

    it('denies a query scoped to a different uid than the caller', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        const playersQuery = query(collectionGroup(db, 'players'), where('uid', '==', HOST_UID));
        await assertFails(getDocs(playersQuery));
    });

    it('denies an unauthenticated query entirely', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        const playersQuery = query(collectionGroup(db, 'players'), where('uid', '==', PLAYER_UID));
        await assertFails(getDocs(playersQuery));
    });
});
```

### Step 2: Run it to verify it fails

Run: `npm run test:rules`
Expected: the new "denies a player creating..." tests FAIL (current rules
still allow it), the new collection-group tests FAIL (`allow list` for
this path doesn't exist yet — every deleted test that used to pass is
gone, so no new failures from those).

### Step 3: Update `firestore.rules`

Modify the `photos` and `playerMessages` match blocks to remove their
`allow create` clauses entirely, and add the new top-level collection-group
rule. Read the file fresh first — reproduced here is the _target_ shape
of the three relevant blocks; everything else in the file (the
`isHostOfExistingRoom`/`isPlayerOfRoom`/`isHostOrPlayerOfRoom` helper
functions, the `rooms`, `players`, `tasks`, `logs` match blocks) is
untouched:

```
// Interim scope — see file header.
match /photos/{photoId} {
  allow read: if isHostOrPlayerOfRoom(roomId);
  allow write: if isHostOfExistingRoom(roomId);
  // Player-facing `allow create` removed — kill-photo submission now
  // goes through functions/callableFunctions/submitKillPhoto.js (Admin
  // SDK, bypasses rules entirely), which derives the submitter's
  // identity from their own uid instead of trusting a client-supplied
  // `assassin` field, and re-implements this clause's old url-origin
  // validation itself (docs/superpowers/specs/
  // 2026-08-22-identity-verified-player-writes-design.md).
}

// Interim scope, same reasoning as photos above — see file header.
match /playerMessages/{messageId} {
  allow read: if isHostOrPlayerOfRoom(roomId);
  allow write: if isHostOfExistingRoom(roomId);
  // Player-facing `allow create` removed — player chat now goes through
  // functions/callableFunctions/submitChatMessage.js (Admin SDK,
  // bypasses rules entirely), same reasoning as photos above. GM
  // broadcasts/whispers/leaderboard/mission messages still go through
  // dbCalls.addPlayerMessageForRoom, authorized by `allow write` above —
  // untouched, a fully independent path.
}
```

Add this new top-level rule, inside `match /databases/{database}/documents`
but _outside_ (a sibling of, not nested inside) `match /rooms/{roomId}`
— it needs to match any room's `players` subcollection via a
collection-group query, which the `{roomId}`-scoped block above cannot
express:

```
// Collection-group list, for session recovery (Homepage.js) when
// localStorage has been cleared but the caller's Firebase Auth session
// survived — finds which room this uid already joined without needing
// the room ID from anywhere else. Deliberately independent of
// isPlayerOfRoom/isHostOfExistingRoom: the query itself is already
// scoped to the caller's own uid via `resource.data.uid ==
// request.auth.uid`, which Firestore can verify against the query's own
// where() filter the same way the rooms-list grant above does — no
// room lookup is needed or possible here (the wildcard path doesn't
// bind {roomId}).
match /{path=**}/players/{playerId} {
  allow list: if request.auth != null && resource.data.uid == request.auth.uid;
}
```

### Step 4: Run it to verify it passes

Run: `npm run test:rules`
Expected: PASS, every test in the file.

### Step 5: Run the full gate and commit

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all clean. (`npm run test:rules` already run in Step 4.)

```bash
git add firestore.rules test/firestore.rules.test.js
git commit -m "Remove player-create rules for photos and chat, add players collection-group list rule"
```

---

## Task 5: Client integration — `MessageComposer.js` and `dbCalls.js` cleanup

**Files:**

- Modify: `src/components/player_messages_components/MessageComposer.js`
- Modify: `src/components/player_messages_components/MessageComposer.test.jsx`
- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/components/firebase_calls/dbCalls.integration.test.js`

**Interfaces:**

- Consumes: `submitKillPhoto` (Task 2), `submitChatMessage` (Task 3).

### Step 1: Update `MessageComposer.js`

Two call-site changes, in `handleSend` and `handlePhotoSubmit`. The
file's existing error-handling idioms (silent restore + `console.error`
for chat, matching the file's own comment about not needing toast/alert
plumbing for a single lost message; `setPhotoError(...)` for photos)
stay exactly as they are — this repo's established convention here is
NOT the `CreateAlert` toast pattern `executeKill.js`'s callers use
elsewhere, so don't introduce one. The one enhancement: `setPhotoError`
now shows the real `submitError.message` when available (falling back to
the existing generic string), so a GM sees _why_ a submission failed
(rate-limited vs. game-ended vs. network) instead of always the same
generic text — the new function's error messages are specific and
user-facing on purpose.

```js
// src/components/player_messages_components/MessageComposer.js
import React, { useEffect, useRef, useState } from 'react';
import { Flex, Input, Button, VisuallyHidden } from '@chakra-ui/react';
import { submitChatMessage } from '../submitChatMessage';
import { submitKillPhoto } from '../submitKillPhoto';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import KillPhotoModal from './KillPhotoModal';
```

`handleSend`:

```js
const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    try {
        await submitChatMessage({ roomId: roomID, text: trimmed });
    } catch (error) {
        // Losing a single sent message isn't session-invalidating,
        // matching MessageFeed's own subscription-error handling — log
        // only, no toast/alert plumbing in this simple composer. The
        // typed text is restored (not left cleared) so a failed send
        // doesn't lose the player's words with no way to retry.
        console.error('Error sending chat message:', error);
        setText(trimmed);
    }
};
```

`handlePhotoSubmit`:

```js
const handlePhotoSubmit = async (effectiveTarget) => {
    setIsSubmitting(true);
    setPhotoError(null);
    try {
        const url = await uploadKillPhoto(roomID, compressedBlob);
        await submitKillPhoto({ roomId: roomID, target: effectiveTarget, url });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setCompressedBlob(null);
        setPreviewUrl(null);
        setIsPhotoModalOpen(false);
    } catch (submitError) {
        console.error('Error submitting kill photo:', submitError);
        setPhotoError(
            submitError.message ||
                'Could not submit the photo. Check your connection and try again.'
        );
    } finally {
        setIsSubmitting(false);
    }
};
```

Nothing else in the file changes — `handleFileChange`, the JSX, and every
other handler are untouched.

### Step 2: Update `MessageComposer.test.jsx`

Replace the `dbCalls` mock with mocks for the two new wrapper modules,
and update every assertion that referenced `addChatMessageForRoom`/
`addPhotoForRoom` to reference `submitChatMessage`/`submitKillPhoto` with
their new argument shapes.

```js
import { submitChatMessage } from '../submitChatMessage';
import { submitKillPhoto } from '../submitKillPhoto';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';

jest.mock('../submitChatMessage', () => ({
    submitChatMessage: jest.fn(),
}));
jest.mock('../submitKillPhoto', () => ({
    submitKillPhoto: jest.fn(),
}));
```

`beforeEach`:

```js
beforeEach(() => {
    jest.clearAllMocks();
    submitChatMessage.mockResolvedValue(undefined);
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    global.URL.revokeObjectURL = jest.fn();
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    submitKillPhoto.mockResolvedValue(undefined);
});
```

Every assertion referencing the old functions changes to the new ones
with the new `{roomId, text}` / `{roomId, target, url}` object shapes —
for example:

```js
it('sends the typed message when Send is clicked', async () => {
    mountComposer();

    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hey where are you');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
        expect(submitChatMessage).toHaveBeenCalledWith({
            roomId: 'room-a',
            text: 'hey where are you',
        })
    );
});
```

Apply the same rename+reshape to: `'sends the typed message when Enter is
pressed'`, `'does not send on Shift+Enter...'` (assert `submitChatMessage`
not called), `'clears the input after sending'`, `'does not send a blank
or whitespace-only message'` (assert `submitChatMessage` not called),
`'restores the typed text if the send fails...'` (use
`submitChatMessage.mockRejectedValue(...)`), and the photo-submission
test:

```js
it('calls compressImage, uploadKillPhoto, then submitKillPhoto in order, then closes the modal', async () => {
    mountComposer();

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
    );
    expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
    expect(submitKillPhoto).toHaveBeenCalledWith({
        roomId: 'room-a',
        target: 'bob',
        url: 'https://example.com/photo.jpg',
    });
    expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
        uploadKillPhoto.mock.invocationCallOrder[0]
    );
    expect(uploadKillPhoto.mock.invocationCallOrder[0]).toBeLessThan(
        submitKillPhoto.mock.invocationCallOrder[0]
    );
});
```

And the upload-failure test uses `uploadKillPhoto.mockRejectedValue(...)`
unchanged (it fails before `submitKillPhoto` is ever called) — add one
new test proving the enhanced error-message behavior:

```js
it('shows the specific error message when submitKillPhoto rejects with one', async () => {
    submitKillPhoto.mockRejectedValue(new Error('This game has ended.'));
    mountComposer();

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('This game has ended.')).toBeInTheDocument();
});
```

### Step 3: Run the component test to verify it passes

Run: `npx jest MessageComposer.test.jsx`
Expected: PASS, every test (renamed ones plus the one new error-message
test).

### Step 4: Delete `addPhotoForRoom` and `addChatMessageForRoom` from `dbCalls.js`

```bash
grep -rn "addPhotoForRoom\|addChatMessageForRoom" src/ --include="*.js" --include="*.jsx"
```

Expected after Steps 1-2: zero remaining call sites outside
`dbCalls.js`'s own definitions and `dbCalls.integration.test.js` (handled
next). Delete both function definitions from `src/components/firebase_calls/dbCalls.js`
(the two blocks read in this plan's research — `addChatMessageForRoom` and
`addPhotoForRoom`).

### Step 5: Update `dbCalls.integration.test.js`

Remove `addChatMessageForRoom` and `addPhotoForRoom` from the top-level
import list.

Delete the `describe('addPhotoForRoom', ...)` block entirely —
`fetchPhotosQueryByAscendingTimestampForRoom` retains its own coverage via
`undoKill.integration.test.js`, so no coverage is lost.

Delete the `describe('addChatMessageForRoom authorized by the
player-scoped rule (final review item 2)', ...)` block entirely — the
player-authorized write path it proved no longer exists as a
rules-authorized `allow create` grant (Task 4 removed it); the equivalent
proof — a real non-host player successfully writing a real chat message
with the right shape — is now `submitChatMessage.integration.test.js`'s
`"writes the message with the caller's own real name as sender"` test
(Task 3).

Replace the `describe('addChatMessageForRoom and the limitToLast(50)
bound', ...)` block: delete its first test (`"writes a chat message with
the correct shape"` — fully superseded by Task 3's own test), and adapt
the second (the `limitToLast(50)` bound test) to seed 51 raw
`playerMessages` docs directly via `addDoc`, rather than looping a
player-scoped writer function 51 times — the new rate limit (20/60s)
would make looping any real submission function 51 times fail partway
through, and this test was never really about _which_ function writes
the messages, only about `fetchPlayerMessagesQueryForRoom`'s own
`limitToLast(50)` behavior:

```js
describe('fetchPlayerMessagesQueryForRoom', () => {
    it('bounds results to the newest 50 messages when more than 50 exist', async () => {
        await seedRoom(ROOM, []);
        const messagesRef = collection(db, 'rooms', ROOM, 'playerMessages');
        for (let i = 0; i < 51; i++) {
            await addDoc(messagesRef, {
                type: 'chat',
                recipient: null,
                text: `msg-${i}`,
                standings: null,
                mission: null,
                sender: 'Alice',
                timestamp: serverTimestamp(),
            });
        }

        const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(50);
        const texts = snapshot.docs.map((docSnapshot) => docSnapshot.data().text);
        expect(texts).not.toContain('msg-0');
        expect(texts[texts.length - 1]).toBe('msg-50');
    });
});
```

This needs `collection`, `addDoc`, and `serverTimestamp` available in the
file — none of the three are currently imported from `firebase/firestore`
in this file (it only imports `dbCalls.js` functions plus `doc`,
`getDoc`, `getDocs`, `terminate`, `Timestamp` directly). Change the
file's existing top-of-file import line from:

```js
import { doc, getDoc, getDocs, terminate, Timestamp } from 'firebase/firestore';
```

to:

```js
import {
    doc,
    getDoc,
    getDocs,
    terminate,
    Timestamp,
    collection,
    addDoc,
    serverTimestamp,
} from 'firebase/firestore';
```

### Step 6: Run the full gate

Run: `npm run format && npm run lint && npm test && npm run build && npm run test:emulator`
Expected: all clean. `npm run test:emulator` specifically re-confirms
`dbCalls.integration.test.js`'s edits are correct against the real
emulator (the adapted `limitToLast(50)` test and the two full block
deletions).

### Step 7: Commit

```bash
git add src/components/player_messages_components/MessageComposer.js \
    src/components/player_messages_components/MessageComposer.test.jsx \
    src/components/firebase_calls/dbCalls.js \
    src/components/firebase_calls/dbCalls.integration.test.js
git commit -m "Wire MessageComposer to submitKillPhoto/submitChatMessage, delete superseded dbCalls writers"
```

---

## Task 6: `Homepage.js` session-recovery fallback

**Files:**

- Modify: `src/pages/Homepage.js`
- Modify: `src/pages/Homepage.test.jsx`

**Interfaces:**

- Consumes: the `players` collection-group `allow list` rule (Task 4).
  `writePlayerSession` from `../utils/playerSession` (pre-existing).

### Step 1: Write the failing tests

Extend the existing mock setup: `firebase/firestore` needs mocking
(`collectionGroup`, `query`, `where`, `getDocs`), and `../utils/firebase`'s
mock needs a `db` export alongside the existing `auth: {}`.

```js
// src/pages/Homepage.test.jsx — add near the top, alongside the existing mocks
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { readPlayerSession, writePlayerSession } from '../utils/playerSession';

jest.mock('firebase/firestore', () => ({
    collectionGroup: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    getDocs: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {}, db: {} }));
```

Add these two tests to the `describe('Homepage', ...)` block:

```js
it('recovers and redirects when no session is stored but a matching player doc is found by uid', async () => {
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback({ uid: 'recovered-uid' });
        return () => {};
    });
    getDocs.mockResolvedValue({
        empty: false,
        docs: [
            {
                data: () => ({ name: 'Alice', uid: 'recovered-uid' }),
                ref: { parent: { parent: { id: 'Fluffy42317' } } },
            },
        ],
    });

    renderHomepage();

    expect(await screen.findByText('Waiting page')).toBeInTheDocument();
    expect(readPlayerSession()).toEqual({ roomID: 'Fluffy42317', playerName: 'Alice' });
});

it('shows the Host/Join buttons when no session is stored and no matching player doc is found', async () => {
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback({ uid: 'stranger-uid' });
        return () => {};
    });
    getDocs.mockResolvedValue({ empty: true, docs: [] });

    renderHomepage();

    expect(await screen.findByRole('button', { name: 'Host Game' })).toBeInTheDocument();
    expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
});

it('shows the Host/Join buttons, not an error, when the recovery query itself fails', async () => {
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback({ uid: 'stranger-uid' });
        return () => {};
    });
    getDocs.mockRejectedValue(new Error('network error'));

    renderHomepage();

    expect(await screen.findByRole('button', { name: 'Host Game' })).toBeInTheDocument();
});
```

### Step 2: Run it to verify it fails

Run: `npx jest Homepage.test.jsx`
Expected: FAIL — `Homepage.js` doesn't yet call `getDocs`/`collectionGroup`
at all, so the new mocks are never invoked and the redirect/recovery
never happens.

### Step 3: Implement the fallback in `Homepage.js`

```js
// src/pages/Homepage.js
import React, { useEffect } from 'react';
import { Button, Stack, Image, Flex, Heading } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import logo from '../assets/mall-logo-white-2.png';
import { readPlayerSession, writePlayerSession } from '../utils/playerSession';
import { auth, db } from '../utils/firebase';

const Homepage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            const session = readPlayerSession();
            if (session && user) {
                navigate(`/rooms/${session.roomID}/waiting`, { replace: true });
                return;
            }
            if (!session && user) {
                // localStorage's room/name pair is gone (cleared, or never
                // written) but the Firebase Auth session survived — find
                // the room this uid already joined, if any, via a
                // collection-group query scoped to the caller's own uid
                // (firestore.rules' new players list rule), rather than
                // treating a returning player as brand new. Restoring the
                // session (not just navigating) matters: PlayerGame.js
                // reads the player's *name* from readPlayerSession(), so a
                // bare redirect would land on the right room with an
                // empty playerName
                // (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
                // Best-effort: any failure here just falls through to the
                // normal Host/Join buttons, same as "no match" — never an
                // error shown to what might just be a first-time visitor.
                try {
                    const playersQuery = query(
                        collectionGroup(db, 'players'),
                        where('uid', '==', user.uid)
                    );
                    const snapshot = await getDocs(playersQuery);
                    if (!snapshot.empty) {
                        const playerDoc = snapshot.docs[0];
                        const roomID = playerDoc.ref.parent.parent.id;
                        writePlayerSession(roomID, playerDoc.data().name);
                        navigate(`/rooms/${roomID}/waiting`, { replace: true });
                    }
                } catch (error) {
                    console.error('Error recovering player session:', error);
                }
            }
        });
        return unsubscribe;
    }, [navigate]);

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>
            <Image src={logo} maxWidth="250px" maxHeight="250px" alt="logo white" mb={4} />
            <Heading mb={8} color="brand.100" textAlign="center">
                Mall Mystery Heroes
            </Heading>
            <Stack direction="row" spacing={4} width="100%" maxWidth="320px">
                <Button
                    colorScheme="teal"
                    variant="solid"
                    flex={1}
                    onClick={() => navigate('/login')}
                >
                    Host Game
                </Button>
                <Button
                    colorScheme="teal"
                    variant="outline"
                    flex={1}
                    onClick={() => navigate('/join')}
                >
                    Join Game
                </Button>
            </Stack>
        </Flex>
    );
};

export default Homepage;
```

### Step 4: Run it to verify it passes

Run: `npx jest Homepage.test.jsx`
Expected: PASS, all 8 tests (5 existing + 3 new).

### Step 5: Run the full gate and commit

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all clean.

```bash
git add src/pages/Homepage.js src/pages/Homepage.test.jsx
git commit -m "Add uid-keyed session recovery fallback to Homepage"
```

---

## Final verification

After all 6 tasks: `npm run format && npm run lint && npm test && npm run build && npm run test:emulator && npm run test:rules` — every one clean. Manually confirm via `grep -rn "addPhotoForRoom\|addChatMessageForRoom" src/` that zero references remain anywhere in `src/`.
