# Player Access, Auth, and Room Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Sign-In (GM), the backend contract for player self-registration (`joinRoom` Cloud Function + `gameStarted` room field), and a room-cleanup pipeline (`endedAt` field + a scheduled `cleanupEndedRooms` function, retention duration deferred but the mechanism fully built).

**Architecture:** Two new Cloud Functions alongside the existing `killPlayer.js`: a callable `joinRoom` (Admin SDK, atomic, mirrors `killPlayer.js`'s validation-then-transaction shape) and a scheduled `cleanupEndedRooms` (new `functions/scheduledFunctions/` directory, its room-selection logic extracted into a pure, unit-tested module). Two new room-document fields (`gameStarted`, `endedAt`) give both functions something to key off. Google Sign-In is an additive button on the GM's existing `auth.js` form. Player-facing join-flow UI screens are explicitly out of scope — see the design spec.

**Tech Stack:** React (Create React App), Firebase Auth/Firestore/Functions, Jest, `firebase-functions-test` (already a `functions/` devDependency, unused until now — verified working against this repo's installed versions, `firebase-functions@5.1.1` / `firebase-functions-test@3.5.0`, before this plan was written).

**Out of scope for this plan** (see the design spec's own "Out of scope" section for the full list): the join-flow UI screens themselves (room code entry, name entry) — nothing in this plan builds a page that calls `joinRoom`, only `joinRoom` itself. Guest/anonymous auth (`signInAnonymously()`) has no task here either — unlike Google auth, which has a concrete GM-side attachment point (Task 1), anonymous auth is a pure client SDK call with nothing to wire it into until the join-flow screens exist. Session persistence (remembering "I'm Alice in room X" locally) is likewise UI work with no backend counterpart to build ahead of it. All three are the natural next plan once the join-flow UI gets its own design pass.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md`. Its "Decisions made" and "Out of scope" sections bind every task below.
- `src/game/` modules stay pure — no Firebase, no React.
- 4-space indentation, Prettier-formatted (`npm run format`), ESLint clean (`npm run lint` from the repo root; `functions/` has its own `npm run lint` too — run both for any task touching `functions/`).
- TDD throughout: write the failing test, confirm it fails for the right reason, implement, confirm it passes.
- Never import `dbCalls.js` or `utils/firebase.js` into a `.test.js`/`.test.jsx` unit/component test — explicit mock factories only.
- Cloud Functions (`functions/callableFunctions/*.js`, `functions/scheduledFunctions/*.js`) are CommonJS (`require`/`module.exports`/`exports.x =`), matching `killPlayer.js` and `targetFunction.js` — not ES modules.
- Every `dbCalls.js` write function follows the `add…For…`/`update…For…`/`fetch…For…`/`mark…For…` naming convention already established in that file.
- Run the full gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) before any commit. Run `npm run test:emulator` after any task that adds emulator-backed tests (Tasks 3 and 5), and once more at the end (Task 7).

---

## File Structure

- **Modify** `src/components/auth.js` — add a "Sign in with Google" button.
- **Modify** `src/components/auth.test.jsx` — cover it.
- **Modify** `src/pages/DashBoard.js` — room-creation write gains `gameStarted: false`.
- **Modify** `src/components/firebase_calls/dbCalls.js` — add `markGameAsStarted`; `endGame` gains `endedAt: serverTimestamp()`.
- **Modify** `src/components/TargetGenerator.js` — calls `markGameAsStarted` in `onYesClose`.
- **Modify** `src/components/TargetGenerator.test.jsx` — cover it.
- **Create** `functions/callableFunctions/joinRoom.js` — the self-registration Cloud Function.
- **Modify** `functions/index.js` — export `joinRoom` and `cleanupEndedRooms`.
- **Create** `src/components/joinRoom.js` — thin client wrapper, mirrors `executeKill.js`.
- **Modify** `test/emulatorHelpers.js` — `seedRoom` gains a `gameStarted` default and an overrides parameter.
- **Create** `src/components/joinRoom.integration.test.js` — mirrors `executeKill.integration.test.js`.
- **Create** `functions/scheduledFunctions/selectExpiredRooms.js` — pure room-selection logic.
- **Create** `functions/scheduledFunctions/selectExpiredRooms.test.js` — its unit tests.
- **Create** `functions/scheduledFunctions/cleanupEndedRooms.js` — the scheduled function.
- **Create** `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js` — `wrap()`-based emulator test.
- **Modify** `jest.config.js` — `integration` project's `testMatch` gains `functions/**/*.integration.test.js`.
- **Modify** `docs/data-model.md` — document `gameStarted`/`endedAt`; fix the stale "isGameActive... never read" note (it's been read since the earlier `docs/improvements.md` item 15 fix this session — the table was never updated).
- **Modify** `docs/architecture.md`, `docs/testing.md` — reflect the two new Cloud Functions.

---

### Task 1: Google Sign-In for the GM

**Files:**

- Modify: `src/components/auth.js`
- Modify: `src/components/auth.test.jsx`

**Interfaces:** None consumed by later tasks — self-contained.

- [ ] **Step 1: Write the failing test**

In `src/components/auth.test.jsx`, add `signInWithPopup: jest.fn()` to the existing `jest.mock('firebase/auth', ...)` factory:

```js
jest.mock('firebase/auth', () => ({
    createUserWithEmailAndPassword: jest.fn(),
    signInWithEmailAndPassword: jest.fn(),
    signInWithPopup: jest.fn(),
}));
```

Change the `jest.mock('../utils/firebase', ...)` line to also provide a `googleProvider` (auth.js will need to import it):

```js
jest.mock('../utils/firebase', () => ({ auth: {}, googleProvider: {} }));
```

Add a new `describe` block at the end of the file:

```js
describe('Google Sign-In', () => {
    it('calls signInWithPopup with the shared googleProvider and navigates to /dashboard', async () => {
        const { signInWithPopup } = require('firebase/auth');
        signInWithPopup.mockResolvedValue({ user: { uid: 'google-uid' } });

        render(
            <ChakraProvider>
                <MemoryRouter>
                    <Auth isLoginPage={true} />
                </MemoryRouter>
            </ChakraProvider>
        );

        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

        expect(signInWithPopup).toHaveBeenCalled();
    });

    it('shows an error if Google sign-in fails', async () => {
        const { signInWithPopup } = require('firebase/auth');
        signInWithPopup.mockRejectedValue(new Error('popup closed'));

        render(
            <ChakraProvider>
                <MemoryRouter>
                    <Auth isLoginPage={true} />
                </MemoryRouter>
            </ChakraProvider>
        );

        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

        expect(await screen.findByText(/error signing in with google/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=auth.test`
Expected: FAIL — `Unable to find role="button" with name "Sign in with Google"`.

- [ ] **Step 3: Implement**

In `src/components/auth.js`:

Change the import line:

```js
import { auth, googleProvider } from '../utils/firebase';
```

Add `signInWithPopup` to the existing `firebase/auth` import:

```js
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
} from 'firebase/auth';
```

Add a new handler near `signIn`/`signUp`:

```js
const signInWithGoogle = async () => {
    try {
        await signInWithPopup(auth, googleProvider);
        navigate('/dashboard');
    } catch (err) {
        setErrorMessage('Error signing in with Google. Please try again.');
        console.error('Error signing in with Google:', err);
    }
};
```

Add the button. Place it right after the closing `</Box>` of the password `InputGroup`'s wrapping `Box` (the one containing the password field and, on the login page, `FilledEnterButton`), before the `{!passRules && ...}` block — i.e. one new element between the existing password-field `Box` and the password-rules text, visible on both login and signup:

```jsx
<Button variant="outline" colorScheme="brand" onClick={signInWithGoogle} borderWidth="3px">
    Sign in with Google
</Button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=auth.test`
Expected: PASS, all tests in the file (existing confirm-password test plus the two new ones).

- [ ] **Step 5: Full component-layer check**

Run: `npm run format && npm run lint && npx jest --selectProjects dom`
Expected: clean, all `dom` project tests pass (confirms no other file imports `auth.js`/`utils/firebase.js` in a way this breaks).

- [ ] **Step 6: Commit**

```bash
git add src/components/auth.js src/components/auth.test.jsx
git commit -m "Add Google Sign-In to the GM's existing auth flow"
```

---

### Task 2: Room lifecycle fields — `gameStarted` and `endedAt`

**Files:**

- Modify: `src/pages/DashBoard.js`
- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/components/TargetGenerator.js`
- Modify: `src/components/TargetGenerator.test.jsx`

**Interfaces:**

- Produces: `dbCalls.markGameAsStarted(roomID) => Promise<void>` — sets `gameStarted: true` on the room doc. Task 3's `joinRoom` Cloud Function reads `gameStarted` directly via the Admin SDK (not through this client function) but relies on this task making the field exist and get set correctly from the client side.
- Produces: `dbCalls.endGame` now also writes `endedAt: serverTimestamp()`. Task 5's `cleanupEndedRooms` reads this field.

- [ ] **Step 1: Write the failing test for `TargetGenerator`**

In `src/components/TargetGenerator.test.jsx`, add `markGameAsStarted: jest.fn()` to the `jest.mock('./firebase_calls/dbCalls', ...)` factory and its `beforeEach` mock resolution:

```js
jest.mock('./firebase_calls/dbCalls', () => ({
    addLogForRoom: jest.fn(),
    markGameAsStarted: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));
```

```js
import {
    addLogForRoom,
    markGameAsStarted,
    updateAssassinsForPlayer,
    updateTargetsForPlayer,
} from './firebase_calls/dbCalls';
```

```js
beforeEach(() => {
    jest.clearAllMocks();
    updateTargetsForPlayer.mockResolvedValue(undefined);
    updateAssassinsForPlayer.mockResolvedValue(undefined);
    addLogForRoom.mockResolvedValue(undefined);
    markGameAsStarted.mockResolvedValue(undefined);
});
```

Add a new test in the `describe('confirming writes targets, logs the start, and hands off to the lobby (improvements item 23)', ...)` block:

```js
it('marks the room as started', async () => {
    mountTargetGenerator();

    await beginGame();

    await waitFor(() => expect(markGameAsStarted).toHaveBeenCalledWith('room-a'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=TargetGenerator`
Expected: FAIL — `markGameAsStarted` is never called (doesn't exist in the component yet).

- [ ] **Step 3: Implement**

In `src/components/firebase_calls/dbCalls.js`, immediately after `endGame` (which currently ends at the closing `};` right before `// A reference to the room document itself...`), insert:

```js
// Marks the room's Lobby phase as over — written once, when "Confirm and
// Begin Game" is clicked. Distinct from isGameActive, which is set true at
// room creation and only goes false on explicit "End Game": it answers
// "does this room still exist," not "has gameplay started"
// (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
// joinRoom (functions/callableFunctions/joinRoom.js) reads this field via
// the Admin SDK to reject self-registration once it's true.
export const markGameAsStarted = async (roomID) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { gameStarted: true });
};
```

Change `endGame` to also stamp `endedAt`:

```js
export const endGame = async (roomID) => {
    const roomRef = doc(db, 'rooms', roomID);
    await updateDoc(roomRef, { isGameActive: false, endedAt: serverTimestamp() });
};
```

In `src/pages/DashBoard.js`, change the room-creation `setDoc` call to include the new field:

```js
await setDoc(roomRef, {
    hostId: user.uid,
    isGameActive: true,
    gameStarted: false,
    taskIndex: 1,
    storageReference: [],
});
```

In `src/components/TargetGenerator.js`, add the import:

```js
import {
    addLogForRoom,
    markGameAsStarted,
    updateAssassinsForPlayer,
    updateTargetsForPlayer,
} from './firebase_calls/dbCalls';
```

Add the call inside `onYesClose`, alongside the existing `addLogForRoom` try/catch (same error-handling shape — this write shouldn't block "Begin Game" from completing if it fails, matching how the log-write is already handled):

```js
const onYesClose = async () => {
    await UpdateDatabase(arrayOfPlayers, graph);
    // A real log entry, not the phantom `<ListItem>Game has begun!</ListItem>`
    // Log.js used to hardcode above every real entry (docs/improvements.md
    // item 23) — nothing in Firestore ever actually contained that text.
    // Seeded here, at the moment the game actually begins, rather than at
    // room creation, when no players exist yet.
    try {
        await addLogForRoom('Game has begun!', 'gray.400', roomID);
    } catch (error) {
        console.error('Error adding log: ', error);
    }
    try {
        await markGameAsStarted(roomID);
    } catch (error) {
        console.error('Error marking game as started: ', error);
    }
    onClose();
    handleLobbyRoom();
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=TargetGenerator`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green. (`Endgamebutton.test.jsx` mocks `dbCalls.endGame` entirely at the module boundary, so the `endedAt` change inside `endGame`'s body needs no test update there — confirm this by running its test file specifically: `npx jest --selectProjects dom --testPathPattern=Endgamebutton` should show no changes needed and still pass.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/DashBoard.js src/components/firebase_calls/dbCalls.js src/components/TargetGenerator.js src/components/TargetGenerator.test.jsx
git commit -m "Add gameStarted and endedAt room lifecycle fields"
```

---

### Task 3: `joinRoom` Cloud Function + client wrapper + integration tests

**Files:**

- Create: `functions/callableFunctions/joinRoom.js`
- Modify: `functions/index.js`
- Create: `src/components/joinRoom.js`
- Modify: `test/emulatorHelpers.js`
- Create: `src/components/joinRoom.integration.test.js`

**Interfaces:**

- Consumes: `gameStarted` field (Task 2).
- Produces: `joinRoom(roomId, playerName) => Promise<void>` (the client wrapper in `src/components/joinRoom.js`) — this is the function a future join-flow UI (out of scope for this plan; see the design spec) will call.

This task's automated coverage lives entirely at the integration layer, not a unit layer — matching this repo's own established precedent for `killPlayer.js` (see `docs/testing.md`'s "Layer 1b" section): the interesting logic here is inherently a Firestore transaction, more accurately exercised end-to-end against a real emulator than mocked.

- [ ] **Step 1: Extend `seedRoom` for `gameStarted`**

In `test/emulatorHelpers.js`, change `seedRoom`'s signature and room-doc write:

```js
export const seedRoom = async (roomID, players = [], roomOverrides = {}) => {
    await setDoc(doc(db, 'rooms', roomID), {
        taskIndex: 1,
        hostId: await hostUid(),
        isGameActive: true,
        gameStarted: false,
        storageReference: [],
        ...roomOverrides,
    });
```

(The rest of the function — the `for (const player of players)` loop — is unchanged.) This is backward compatible: every existing caller (`executeKill.integration.test.js`) passes only two arguments, so `roomOverrides` defaults to `{}` and their seeded rooms gain `gameStarted: false` with no behavior change, since nothing there reads that field.

- [ ] **Step 2: Write the failing integration test**

Create `src/components/joinRoom.integration.test.js`:

```js
/**
 * Layer 1b — the player self-registration Cloud Function, against the
 * real Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `joinRoom` is a thin wrapper around
 * `httpsCallable(functions, 'joinRoom')` — these tests call it exactly
 * the way a real player's device would, then assert on what actually
 * landed in Firestore, matching executeKill.integration.test.js's own
 * stance (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 */
import { joinRoom } from './joinRoom';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('joinRoom', () => {
    it('adds a new player to a room still in its Lobby phase', async () => {
        await seedRoom(ROOM, []);

        await joinRoom(ROOM, 'Alice');

        const player = await fetchPlayerForRoom('alice', ROOM);
        expect(player.data()).toMatchObject({
            name: 'Alice',
            trimmedNameLowerCase: 'alice',
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
        });
    });

    it('rejects joining a room that does not exist', async () => {
        // seedRoom (for an unrelated room) is what actually signs in the
        // shared auth singleton the first time — calling it here keeps
        // this test self-contained rather than relying on an earlier test
        // in the file to have done so first, matching every test in
        // executeKill.integration.test.js.
        await seedRoom('some-other-room', []);

        await expect(joinRoom('nonexistent-room', 'Alice')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });

    it('rejects joining a room whose game has already started', async () => {
        await seedRoom(ROOM, [], { gameStarted: true });

        await expect(joinRoom(ROOM, 'Alice')).rejects.toThrow('This game has already started.');
    });

    it('rejects a duplicate name, case- and whitespace-insensitively', async () => {
        await seedRoom(ROOM, ['Alice']);

        await expect(joinRoom(ROOM, '  alice  ')).rejects.toThrow(/already taken/);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:emulator`
Expected: FAIL — `Cannot find module './joinRoom'` (neither the client wrapper nor the Cloud Function exist yet).

- [ ] **Step 4: Implement the Cloud Function**

Create `functions/callableFunctions/joinRoom.js`:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { normalizePlayerName } = require('../../src/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Lets a player join a room from their own device — the player-facing
 * counterpart to dbCalls.addPlayerForRoom, callable by anyone signed in
 * (Google or anonymous/guest), not just the room's host
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely —
 * unlike killPlayer, there is deliberately no host-only check: any
 * signed-in caller may join any room still in its Lobby phase.
 */
exports.joinRoom = functions.https.onCall(async (data, context) => {
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

    const roomRef = db.collection('rooms').doc(roomId);
    const trimmedLowercaseName = normalizePlayerName(playerName);
    const playerRef = roomRef.collection('players').doc(trimmedLowercaseName);

    return db.runTransaction(async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().gameStarted) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'This game has already started.'
            );
        }

        const existing = await transaction.get(playerRef);
        if (existing.exists) {
            throw new functions.https.HttpsError(
                'already-exists',
                `${playerName} is already taken in this room.`
            );
        }

        transaction.set(playerRef, {
            name: playerName,
            trimmedNameLowerCase: trimmedLowercaseName,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
    });
});
```

In `functions/index.js`, add:

```js
const { joinRoom } = require('./callableFunctions/joinRoom');
exports.joinRoom = joinRoom;
```

- [ ] **Step 5: Implement the client wrapper**

Create `src/components/joinRoom.js`:

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const joinRoomCallable = httpsCallable(functions, 'joinRoom');

/**
 * Lets the current signed-in user (Google or guest/anonymous) join a room
 * as a new player, from their own device — the player-facing counterpart
 * to dbCalls.addPlayerForRoom
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 * Only succeeds while the room is still in its Lobby phase.
 *
 * @throws if the room doesn't exist, has already started, or the name is
 *   already taken — surfaces as a rejected promise carrying `.message`.
 */
export const joinRoom = async (roomId, playerName) => {
    await joinRoomCallable({ roomId, playerName });
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:emulator`
Expected: PASS, all 4 new tests, plus every pre-existing `integration` test still passing (confirms `seedRoom`'s signature change didn't break `executeKill.integration.test.js`).

- [ ] **Step 7: Lint (both root and functions/)**

Run: `npm run format && npm run lint`
Run: `cd functions && npm run lint && cd ..`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add functions/callableFunctions/joinRoom.js functions/index.js src/components/joinRoom.js test/emulatorHelpers.js src/components/joinRoom.integration.test.js
git commit -m "Add joinRoom: player self-registration Cloud Function"
```

---

### Task 4: `cleanupEndedRooms` — pure room-selection logic

**Files:**

- Create: `functions/scheduledFunctions/selectExpiredRooms.js`
- Create: `functions/scheduledFunctions/selectExpiredRooms.test.js`

**Interfaces:**

- Produces: `selectExpiredRooms(rooms: Array<{id: string, endedAt: Date | null}>, now: Date, retentionDays: number | null) => string[]` (array of room IDs to delete). Task 5's `cleanupEndedRooms.js` imports this.

This is plain CommonJS Node code — no Firebase import at all, not even the Admin SDK — so it runs under the existing `unit` Jest project (`jest.config.js` already matches `functions/**/*.test.js` there; no config change needed for this task).

- [ ] **Step 1: Write the failing test**

Create `functions/scheduledFunctions/selectExpiredRooms.test.js`:

```js
const { selectExpiredRooms } = require('./selectExpiredRooms');

describe('selectExpiredRooms', () => {
    const now = new Date('2026-08-10T00:00:00Z');

    it('selects a room ended more than retentionDays ago', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2026-08-05T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual(['room-a']);
    });

    it('does not select a room ended less than retentionDays ago', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2026-08-09T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual([]);
    });

    it('selects a room ended exactly retentionDays ago (boundary)', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2026-08-07T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual(['room-a']);
    });

    it('does not select a room that never ended (endedAt: null)', () => {
        const rooms = [{ id: 'room-a', endedAt: null }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual([]);
    });

    it('selects nothing when retentionDays is null (feature off)', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2020-01-01T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, null)).toEqual([]);
    });

    it('handles a mix of qualifying and non-qualifying rooms', () => {
        const rooms = [
            { id: 'old-room', endedAt: new Date('2026-08-01T00:00:00Z') },
            { id: 'recent-room', endedAt: new Date('2026-08-09T12:00:00Z') },
            { id: 'never-ended-room', endedAt: null },
        ];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual(['old-room']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern=selectExpiredRooms`
Expected: FAIL — `Cannot find module './selectExpiredRooms'`.

- [ ] **Step 3: Implement**

Create `functions/scheduledFunctions/selectExpiredRooms.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit --testPathPattern=selectExpiredRooms`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Lint**

Run: `cd functions && npm run lint && cd ..`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add functions/scheduledFunctions/selectExpiredRooms.js functions/scheduledFunctions/selectExpiredRooms.test.js
git commit -m "Add selectExpiredRooms: pure room-retention selection logic"
```

---

### Task 5: `cleanupEndedRooms` — scheduled function + emulator test

**Files:**

- Create: `functions/scheduledFunctions/cleanupEndedRooms.js`
- Modify: `functions/index.js`
- Modify: `jest.config.js`
- Create: `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`

**Interfaces:**

- Consumes: `selectExpiredRooms` (Task 4), `endedAt` field (Task 2).

This is the first scheduled (as opposed to callable) Cloud Function in this repo, and the first test in this repo to invoke a Cloud Function's handler directly via `firebase-functions-test`'s `wrap()` rather than through a client-facing `httpsCallable` — there is no client wrapper for a cron job to go through. `wrap()` was verified working against this repo's exact installed versions (`firebase-functions@5.1.1`, `firebase-functions-test@3.5.0`) before this plan was written: `functionsTest.wrap(scheduledFn)` returns a function; calling it with no arguments invokes the `.onRun()` handler directly.

- [ ] **Step 1: Extend the integration Jest project to cover `functions/`**

In `jest.config.js`, change the `integration` project's `testMatch`:

```js
{
    displayName: 'integration',
    testEnvironment: 'node',
    clearMocks: true,
    testMatch: [
        '<rootDir>/src/**/*.integration.test.js',
        '<rootDir>/functions/**/*.integration.test.js',
    ],
    testPathIgnorePatterns: ['/node_modules/'],
    // Must be setupFiles, not setupFilesAfterEnv: the env vars have to be in
    // place before src/utils/firebase.js is first imported.
    setupFiles: ['<rootDir>/test/integrationSetup.js'],
    setupFilesAfterEnv: ['<rootDir>/test/integrationTimeout.js'],
},
```

(Only the `testMatch` array changes — `setupFiles`/`setupFilesAfterEnv` stay as they are. `cleanupEndedRooms.integration.test.js` doesn't import `src/utils/firebase.js` at all, so `integrationSetup.js`'s env-var setup is harmless-but-unused for this specific file, not required by it.)

- [ ] **Step 2: Write the failing integration test**

Create `functions/scheduledFunctions/cleanupEndedRooms.integration.test.js`:

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
const functionsTest = require('firebase-functions-test')();
const { clearFirestore, seedRoom, shutdown } = require('../../test/emulatorHelpers');
const { cleanupEndedRooms, setRetentionDaysForTesting } = require('./cleanupEndedRooms');

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

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:emulator`
Expected: FAIL — `Cannot find module './cleanupEndedRooms'`.

- [ ] **Step 4: Implement**

Create `functions/scheduledFunctions/cleanupEndedRooms.js`:

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { selectExpiredRooms } = require('./selectExpiredRooms');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// null = deliberate no-op. The mechanism is fully built; only the actual
// duration is undecided (docs/superpowers/specs/2026-08-06-player-access-
// and-room-lifecycle-design.md). Flip this to a number to turn it on.
let RETENTION_DAYS = null;

// Test-only seam — the alternative (injecting retentionDays as a
// parameter to cleanupEndedRooms) would change this function's signature
// away from what functions.pubsub.schedule(...).onRun(handler) expects
// (no arguments), so the emulator test flips this module-level value
// directly instead.
const setRetentionDaysForTesting = (days) => {
    RETENTION_DAYS = days;
};

const cleanupEndedRooms = functions.pubsub.schedule('every 24 hours').onRun(async () => {
    const roomsSnapshot = await db.collection('rooms').get();
    const rooms = roomsSnapshot.docs.map((doc) => ({
        id: doc.id,
        endedAt: doc.data().endedAt ? doc.data().endedAt.toDate() : null,
    }));

    const expiredRoomIds = selectExpiredRooms(rooms, new Date(), RETENTION_DAYS);

    for (const roomId of expiredRoomIds) {
        await db.recursiveDelete(db.collection('rooms').doc(roomId));
    }

    return null;
});

module.exports = { cleanupEndedRooms, setRetentionDaysForTesting };
```

In `functions/index.js`, add:

```js
const { cleanupEndedRooms } = require('./scheduledFunctions/cleanupEndedRooms');
exports.cleanupEndedRooms = cleanupEndedRooms;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:emulator`
Expected: PASS, all 4 new tests, plus every other `integration` test (now including `functions/**` per Step 1) still green.

- [ ] **Step 6: Lint**

Run: `cd functions && npm run lint && cd ..`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add functions/scheduledFunctions/cleanupEndedRooms.js functions/index.js jest.config.js functions/scheduledFunctions/cleanupEndedRooms.integration.test.js
git commit -m "Add cleanupEndedRooms: scheduled room-retention deletion (retention duration unset)"
```

---

### Task 6: Documentation

**Files:**

- Modify: `docs/data-model.md`
- Modify: `docs/architecture.md`
- Modify: `docs/testing.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `docs/data-model.md`**

In the `## rooms/{roomID}` field table, add two rows and fix the now-stale `isGameActive` note (it says "Written but never read — ending a game does not gate anything," which stopped being true once `docs/improvements.md` item 15's `isGameActive` gating landed earlier this session — `GameMasterView` now subscribes to it and disables `ChatInput` once it's `false`; the table was never updated at the time). Replace the whole table:

```markdown
| Field              | Type                     | Written by                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostId`           | `string`                 | `DashBoard.handleHostRoom`                                                                                           | The creating user's `auth.uid`. Read by `firestore.rules` to scope access — see [architecture.md](./architecture.md#authentication-and-authorization). Not read anywhere in application code.                                                                                                                                          |
| `isGameActive`     | `boolean`                | `DashBoard.handleHostRoom` (`true`), `dbCalls.endGame` (`false`)                                                     | `GameMasterView` subscribes to this and disables `ChatInput` once it's `false` (docs/improvements.md item 15) — no longer write-only.                                                                                                                                                                                                  |
| `gameStarted`      | `boolean`                | `DashBoard.handleHostRoom` (`false`), `dbCalls.markGameAsStarted` (`true`, called from `TargetGenerator.onYesClose`) | Distinct from `isGameActive`: this answers "has the Lobby phase ended," not "does the room still exist." Read by `joinRoom` (`functions/callableFunctions/joinRoom.js`) via the Admin SDK to reject self-registration once targets have been generated (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md). |
| `endedAt`          | `Timestamp \| undefined` | `dbCalls.endGame`                                                                                                    | `serverTimestamp()`, set when "End Game" is clicked. Absent on a room that's never been ended. Read by the scheduled `cleanupEndedRooms` function to decide what's old enough to delete.                                                                                                                                               |
| `taskIndex`        | `number`                 | `DashBoard.handleHostRoom` (`1`), `dbCalls.fetchTaskIndexThenIncrement`                                              | Monotonic counter handing out human-facing mission numbers.                                                                                                                                                                                                                                                                            |
| `storageReference` | `array`                  | `DashBoard.handleHostRoom` (`[]`)                                                                                    | Written empty at creation, never read or appended. Vestigial.                                                                                                                                                                                                                                                                          |
```

Add a new section after the `## rooms/{roomID}/playerMessages/{autoId}` section (before its trailing `---` and the next `## Firebase Storage` heading — search for the exact boundary):

```markdown
## Room cleanup

`functions/scheduledFunctions/cleanupEndedRooms.js` runs once every 24
hours and deletes any room (and everything under it — players, logs,
tasks, photos, playerMessages, via the Admin SDK's `recursiveDelete()`)
whose `endedAt` is older than a retention window. The window is a
module-level constant, currently `null` — a deliberate no-op until a
duration is chosen
(docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
A room that's abandoned mid-lobby and never explicitly ended (`endedAt`
never set) is not covered by this and is never automatically deleted.
```

- [ ] **Step 2: Update `docs/architecture.md`**

In the `## Cloud Functions` section, change the intro line and bulleted list. Find:

```markdown
`functions/` contains two callables:

- `targetFunction` — a stub that checks `context.auth` and echoes its input
  back. Nothing in the game depends on it; its only caller, a debug button
  component (`cloudFunction.js`) that was never mounted anywhere, was
  deleted as dead code (`improvements.md` item 14).
- `killPlayer` (`functions/callableFunctions/killPlayer.js`) — the atomic
  replacement for the client-side kill flow (`improvements.md` item 4).
  Validates the kill, transfers points, marks the victim dead, unmaps them
  from every neighbor, and reassigns targets/assassins to whoever that
  leaves short, all inside one Firestore transaction via the Admin SDK.
  `src/components/executeKill.js` is now a thin `httpsCallable` wrapper
  around it. This is the one place in the app where game logic runs
  server-side rather than in the browser.
```

Replace with:

```markdown
`functions/` contains three callables and one scheduled function:

- `targetFunction` — a stub that checks `context.auth` and echoes its input
  back. Nothing in the game depends on it; its only caller, a debug button
  component (`cloudFunction.js`) that was never mounted anywhere, was
  deleted as dead code (`improvements.md` item 14).
- `killPlayer` (`functions/callableFunctions/killPlayer.js`) — the atomic
  replacement for the client-side kill flow (`improvements.md` item 4).
  Validates the kill, transfers points, marks the victim dead, unmaps them
  from every neighbor, and reassigns targets/assassins to whoever that
  leaves short, all inside one Firestore transaction via the Admin SDK.
  `src/components/executeKill.js` is now a thin `httpsCallable` wrapper
  around it. This is the one place in the app where game logic runs
  server-side rather than in the browser.
- `joinRoom` (`functions/callableFunctions/joinRoom.js`) — lets a player
  self-register into a room from their own device, atomically checking for
  a duplicate name and that the room is still in its Lobby phase, all
  inside one Firestore transaction via the Admin SDK — the player-facing
  counterpart to `dbCalls.addPlayerForRoom`
  (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
  `src/components/joinRoom.js` is its thin `httpsCallable` wrapper, same
  shape as `executeKill.js`. Unlike `killPlayer`, there is no host-only
  check — any signed-in caller (Google or anonymous/guest) may call it.
- `cleanupEndedRooms` (`functions/scheduledFunctions/cleanupEndedRooms.js`)
  — runs once every 24 hours, deleting any room (and everything under it)
  whose `endedAt` is older than a retention window. The window is a
  module-level constant, currently unset — the mechanism is fully built,
  the actual duration is a deliberately deferred decision. The first
  scheduled (as opposed to callable) function in this repo, and the first
  tested via `firebase-functions-test`'s `wrap()` rather than a client
  wrapper, since a cron job has no client caller to go through.
```

Also update the later paragraph beginning "`killPlayer.js` reuses
`src/game/remapPlan.js`..." — it currently implies `killPlayer.js` is the
only function reaching into `src/game/` this way. Find:

```markdown
works with no build step; the client's existing `import` of them is
unaffected (webpack's CommonJS interop).
```

Replace with:

```markdown
works with no build step; the client's existing `import` of them is
unaffected (webpack's CommonJS interop). `joinRoom.js` reuses
`playerNames.js` the same way, for the same reason.
```

- [ ] **Step 3: Update `docs/testing.md`**

Add one row to the pure-modules table (search for the row starting
`| \`src/game/leaderboard.js\` |` to find the exact spot — insert
immediately after it):

```markdown
| `functions/scheduledFunctions/selectExpiredRooms.js` | `selectExpiredRooms` — pure room-retention selection, given `now` injected rather than read internally (item: player access/room lifecycle) | 6 |
```

Replace the whole "Layer 1b" section. Find:

```markdown
### Layer 1b — Cloud Functions, against the Functions, Firestore, and Auth emulators together

Target: `functions/callableFunctions/killPlayer.js` (backlog item 4).

`executeKill.integration.test.js` calls it exactly the way the real app
does — through `httpsCallable`, via the thin `src/components/executeKill.js`
wrapper — rather than importing the function's internals and invoking them
directly (the `firebase-functions-test` shortcut this repo's devDependencies
would otherwise support). That keeps the same "test through the real
interface" stance Layer 1 already takes with `dbCalls.js`: assertions read
back what actually landed in Firestore after a real callable-function HTTP
round trip, not what the function's return value merely claims happened.

This requires the `functions` emulator running alongside `firestore` and
`auth` — `test:emulator`'s `--only` flag lists all three. A second helper,
`callableAsNonHost` (`test/emulatorHelpers.js`), spins up a second, separate
Firebase app instance signed in as a different anonymous user, so the
host-only authorization check (re-implemented in `killPlayer.js`, since the
Admin SDK it runs under bypasses `firestore.rules` entirely) has something
real to reject.

`functions/` has its own lint config and script (`functions/.eslintrc.json`,
`npm run lint` from inside `functions/`) but no separate unit-test runner —
the three pure modules it imports (`src/game/{remapPlan,targetGraph,
playerNames}.js`) are already covered by Layer 0, and `killPlayer.js` itself
has no logic that isn't more accurately exercised end-to-end at this layer.
```

Replace with:

```markdown
### Layer 1b — Cloud Functions, against the Functions, Firestore, and Auth emulators together

Targets: `functions/callableFunctions/killPlayer.js` (backlog item 4),
`functions/callableFunctions/joinRoom.js`, and
`functions/scheduledFunctions/cleanupEndedRooms.js` (player access/room
lifecycle).

`executeKill.integration.test.js` and `joinRoom.integration.test.js` both
call their function exactly the way the real app does — through
`httpsCallable`, via a thin wrapper (`src/components/executeKill.js`,
`src/components/joinRoom.js`) — rather than importing the function's
internals and invoking them directly (the `firebase-functions-test`
shortcut this repo's devDependencies would otherwise support). That keeps
the same "test through the real interface" stance Layer 1 already takes
with `dbCalls.js`: assertions read back what actually landed in Firestore
after a real callable-function HTTP round trip, not what the function's
return value merely claims happened.

`cleanupEndedRooms.integration.test.js` is the one exception: a scheduled
function has no client-facing callable interface to go through — its only
real caller is Cloud Scheduler. It uses `firebase-functions-test`'s
`wrap()` to invoke the `.onRun()` handler directly instead, the first use
of that shortcut in this repo, reserved for exactly the case Layer 1's
"real interface" stance can't apply to.

This requires the `functions` emulator running alongside `firestore` and
`auth` — `test:emulator`'s `--only` flag lists all three. A second helper,
`callableAsNonHost` (`test/emulatorHelpers.js`), spins up a second, separate
Firebase app instance signed in as a different anonymous user, so
`killPlayer.js`'s host-only authorization check (re-implemented there,
since the Admin SDK it runs under bypasses `firestore.rules` entirely) has
something real to reject. `joinRoom` has no equivalent check to test this
way — any signed-in caller may call it, by design.

`functions/` has its own lint config and script (`functions/.eslintrc.json`,
`npm run lint` from inside `functions/`) but no separate unit-test runner —
`functions/**/*.test.js` rides the same `unit` Jest project as everything
else. The pure modules `functions/` imports or contains
(`src/game/{remapPlan,targetGraph,playerNames}.js`,
`functions/scheduledFunctions/selectExpiredRooms.js`) are covered there.
`killPlayer.js` and `joinRoom.js` themselves have no logic that isn't more
accurately exercised end-to-end at this layer; `cleanupEndedRooms.js`
splits the difference — its room-selection decision is pure and unit
tested, its actual Firestore reads/deletes are exercised here.
```

- [ ] **Step 4: Format**

Run: `npm run format`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add docs/data-model.md docs/architecture.md docs/testing.md
git commit -m "Docs: document gameStarted, endedAt, joinRoom, and cleanupEndedRooms"
```

---

### Task 7: Final validation gate

**Files:** None modified — verification only.

- [ ] **Step 1: Full gate**

Run in order:

```bash
npm run format
npm run format:check
npm run lint
(cd functions && npm run lint)
npm test -- --watchAll=false
npm run test:emulator
npm run test:rules
CI=true npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Sanity-check the retention constant is really off**

`grep -n "RETENTION_DAYS = " functions/scheduledFunctions/cleanupEndedRooms.js` should show `null` — confirms nothing in this plan accidentally turned on live room deletion before a duration was actually decided.

- [ ] **Step 3: Optional — verify Google Sign-In live against the running app**

If a dev server + emulators are available (`npm run firebase:emulate` in one terminal, `npm start` in another), click "Sign in with Google" on `/login` and confirm the Google auth popup opens (the Auth emulator provides a fake account picker rather than a real Google login). Not blocking if the environment isn't available — noted per this project's own precedent that live verification has caught real bugs the test suite alone missed.
