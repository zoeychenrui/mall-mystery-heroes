# Player target/status view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a game has started, a player's phone shows who they're hunting (or, if eliminated, a short "you've been eliminated" state) — instead of the current dead-end "The game has started!" text.

**Architecture:** `src/pages/PlayerWaiting.js` is renamed to `PlayerGame.js` and extended in place (same route, `/rooms/:roomID/waiting`) with a second live Firestore subscription — to the player's own doc — that starts only once the existing `gameStarted` subscription reports `true`. A new `fetchPlayerReferenceForRoom` helper in `dbCalls.js` returns the doc ref, mirroring the existing `fetchRoomReferenceForRoom`. No new routes, no writes, no security-rules changes.

**Tech Stack:** React (CRA), Firebase Firestore client SDK (`onSnapshot`), Chakra UI, Jest + React Testing Library (jsdom project).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done — same four-command gate as every other change in this repo (`CLAUDE.md`).
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js` (`CLAUDE.md` — "Where code goes").
- Never import `dbCalls.js` or `utils/firebase.js` from a unit test; component tests use explicit `jest.mock` factories, matching every existing test in `src/pages/`.
- Write the test first and watch it fail, for every behavioral change (`CLAUDE.md`).
- Target only, not assassin; eliminated players stay on this screen (not redirected away); no player-facing mission-completion/submission UI in this plan — see `docs/superpowers/specs/2026-08-08-player-target-view-design.md`, "Scope."

---

## Task 1: `fetchPlayerReferenceForRoom` in `dbCalls.js`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`

**Interfaces:**

- Consumes: `doc` (already imported at the top of the file, `dbCalls.js:7`), `normalizePlayerName` (already imported, `dbCalls.js:25`).
- Produces: `fetchPlayerReferenceForRoom(playerName, roomID) → DocumentReference`, for Task 3 to subscribe to via `onSnapshot`.

This mirrors `fetchRoomReferenceForRoom` (`dbCalls.js:341-343`), which has no dedicated unit or integration test of its own — a bare `doc(...)` wrapper is exercised only indirectly through the component that consumes it (`PlayerWaiting.test.jsx`, soon `PlayerGame.test.jsx`). This task follows the same precedent: no new test file, `PlayerGame.test.jsx` (Task 2 onward) is what exercises it.

- [ ] **Step 1: Add the function**

Add immediately after `fetchRoomReferenceForRoom` (`dbCalls.js:341-343`):

```js
// A reference to a specific player's document, for onSnapshot — lets
// PlayerGame.js watch its own target/alive status live once the game
// starts, the same way fetchRoomReferenceForRoom lets it watch
// gameStarted. Keyed the same way every other player lookup in this file
// is (trimmedNameLowerCase via normalizePlayerName) — addPlayerForRoom
// already uses this exact value as the document ID (dbCalls.js:212).
export const fetchPlayerReferenceForRoom = (playerName, roomID) => {
    return doc(db, 'rooms', roomID, 'players', normalizePlayerName(playerName));
};
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `npx jest --selectProjects unit dom`
Expected: PASS, same counts as before this change (this is a pure addition; nothing calls the new export yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js
git commit -m "Add fetchPlayerReferenceForRoom to dbCalls.js"
```

---

## Task 2: Rename `PlayerWaiting` to `PlayerGame` (mechanical, no behavior change)

**Files:**

- Create: `src/pages/PlayerGame.js` (moved from `src/pages/PlayerWaiting.js`)
- Create: `src/pages/PlayerGame.test.jsx` (moved from `src/pages/PlayerWaiting.test.jsx`)
- Delete: `src/pages/PlayerWaiting.js`, `src/pages/PlayerWaiting.test.jsx`
- Modify: `src/App.js`

**Interfaces:**

- Consumes: nothing new.
- Produces: `PlayerGame` (default export, same props/behavior as `PlayerWaiting` today) for `App.js` to route to; `fetchPlayerReferenceForRoom` mock wiring in the test file, ready for Task 3 to use (not yet exercised by any assertion).

This task changes no behavior — it's a pure rename plus one bit of test-mock groundwork (a second `onSnapshot` caller is coming in Task 3, and the existing mock's generic `(ref, callback) => callback(...)` implementation would mis-route a second ref's response if left as-is). Getting the mock to branch on `ref` now, while there's still only one real caller, keeps this step's diff small and mechanical.

- [ ] **Step 1: Move the component file**

```bash
git mv src/pages/PlayerWaiting.js src/pages/PlayerGame.js
```

In `src/pages/PlayerGame.js`, rename the component itself (the file's only change beyond the move):

```js
const PlayerGame = () => {
```

```js
export default PlayerGame;
```

- [ ] **Step 2: Move the test file and update its imports/branch the onSnapshot mock**

```bash
git mv src/pages/PlayerWaiting.test.jsx src/pages/PlayerGame.test.jsx
```

In `src/pages/PlayerGame.test.jsx`:

Change the import and describe block name:

```js
import PlayerGame from './PlayerGame';
```

```js
describe('PlayerGame', () => {
```

Change every `<Route path="/rooms/:roomID/waiting" element={<PlayerWaiting />} />` to:

```jsx
<Route path="/rooms/:roomID/waiting" element={<PlayerGame />} />
```

Add the new mock alongside the existing one and give it a distinct return value so tests can branch on it later:

```js
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchRoomReferenceForRoom: jest.fn(),
    fetchPlayerReferenceForRoom: jest.fn(),
}));
```

In `beforeEach`, add:

```js
fetchPlayerReferenceForRoom.mockReturnValue('player-ref');
```

(also add `fetchPlayerReferenceForRoom` to the import from `dbCalls` at the top of the file, alongside `fetchRoomReferenceForRoom`).

In every existing test's `onSnapshot.mockImplementation`, branch on the ref so only `'room-ref'` gets the room-shaped response — e.g. the first test becomes:

```js
onSnapshot.mockImplementation((ref, callback) => {
    if (ref === 'room-ref') {
        callback({ exists: () => true, data: () => ({ gameStarted: false }) });
    }
    return () => {};
});
```

Apply the same `if (ref === 'room-ref') { ... }` guard to the other four `mockImplementation` bodies in this file (the "gameStarted flips true", "room no longer exists", "permission error", and "Leave" tests) — each currently calls `callback(...)` unconditionally; wrap that same call in the guard, changing nothing else about what each test asserts.

- [ ] **Step 3: Update `App.js`**

```js
import PlayerGame from './pages/PlayerGame';
```

(replaces the `PlayerWaiting` import, `App.js:12`)

```jsx
<Route
    path="/rooms/:roomID/waiting"
    element={
        <RequireAuth>
            <PlayerGame />
        </RequireAuth>
    }
/>
```

(replaces `App.js:43-50` — path unchanged, component swapped)

- [ ] **Step 4: Run the moved test file and confirm all 5 existing tests still pass**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, 5 tests (same 5 as `PlayerWaiting.test.jsx` had, unchanged behavior).

- [ ] **Step 5: Run the full suite and build to confirm the rename didn't break anything elsewhere**

Run: `npx jest --selectProjects unit dom && npm run build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx src/App.js
git status
```

(confirm `PlayerWaiting.js`/`PlayerWaiting.test.jsx` show as deleted, then:)

```bash
git add -u
git commit -m "Rename PlayerWaiting to PlayerGame ahead of in-game view work"
```

---

## Task 3: Subscribe to the player doc once the game starts; render the target(s)

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `fetchPlayerReferenceForRoom(playerName, roomID)` (Task 1), `onSnapshot` (already imported in `PlayerGame.js`).
- Produces: internal `playerData` state (`{ isAlive, targets } | null`), consumed by this same task's render logic and extended by Tasks 4-6.

- [ ] **Step 1: Write the failing test**

Add to `src/pages/PlayerGame.test.jsx`, inside the `describe('PlayerGame', ...)` block:

```js
it('subscribes to the player doc once gameStarted is true and shows the target', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
        } else if (ref === 'player-ref') {
            callback({ data: () => ({ isAlive: true, targets: ['Bob'] }) });
        }
        return () => {};
    });

    renderWaiting();

    expect(screen.getByText('Your target: Bob')).toBeInTheDocument();
});

it('does not subscribe to the player doc while still waiting for the host', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: false }) });
        }
        return () => {};
    });

    renderWaiting();

    expect(fetchPlayerReferenceForRoom).not.toHaveBeenCalled();
});
```

(add `fetchPlayerReferenceForRoom` to the existing `import { fetchRoomReferenceForRoom } from '../components/firebase_calls/dbCalls';` line if Task 2 didn't already add it there.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: FAIL — `Your target: Bob` not found (no target rendering exists yet); second test passes vacuously since no code calls `fetchPlayerReferenceForRoom` at all yet, which is not a meaningful red — leave it for now, Step 4 will make it a real assertion once the subscription exists.

- [ ] **Step 3: Implement**

In `src/pages/PlayerGame.js`:

```js
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
} from '../components/firebase_calls/dbCalls';
```

Add state, alongside the existing `gameStarted` state:

```js
const [playerData, setPlayerData] = useState(null);
```

Add a second `useEffect`, after the existing room-subscription `useEffect`:

```js
// Only starts once the game has actually begun — no need to read the
// player's own doc while still in the waiting room, and it keeps the
// waiting screen's read footprint unchanged from before this doc.
useEffect(() => {
    if (!roomID || !gameStarted) return undefined;
    const playerRef = fetchPlayerReferenceForRoom(playerName, roomID);
    const unsubscribe = onSnapshot(playerRef, (snapshot) => {
        setPlayerData(snapshot.data());
    });
    return () => unsubscribe();
}, [roomID, gameStarted, playerName]);
```

Replace the existing single `<Text>` line —

```jsx
<Text mb={6}>{gameStarted ? 'The game has started!' : 'Waiting for the host to start...'}</Text>
```

— with two separate conditional blocks (kept separate because Tasks 4 and 5 each extend only one of them):

```jsx
{
    !gameStarted && <Text mb={6}>Waiting for the host to start...</Text>;
}
{
    gameStarted && playerData?.isAlive && (
        <Text mb={6}>{`Your target: ${playerData.targets.join(', ')}`}</Text>
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, both new tests.

- [ ] **Step 5: Confirm the "does not subscribe" test is a real check, not a vacuous pass**

Temporarily change the effect's guard from `if (!roomID || !gameStarted) return undefined;` to `if (!roomID) return undefined;` (i.e. remove the `gameStarted` check), rerun:

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: FAIL on `does not subscribe to the player doc while still waiting for the host` — proves the test actually catches a premature subscription.

Restore the guard to `if (!roomID || !gameStarted) return undefined;` and rerun to confirm both tests pass again.

- [ ] **Step 6: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Show the player's target once the game starts"
```

---

## Task 4: "Waiting for your target..." when `targets` is empty

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `playerData` state from Task 3.
- Produces: nothing new consumed elsewhere — a render-only branch.

- [ ] **Step 1: Write the failing test**

```js
it('shows a placeholder when alive but not yet assigned a target', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
        } else if (ref === 'player-ref') {
            callback({ data: () => ({ isAlive: true, targets: [] }) });
        }
        return () => {};
    });

    renderWaiting();

    expect(screen.getByText('Waiting for your target...')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: FAIL — with the current code, `playerData.targets.join(', ')` renders an empty string, not the placeholder text, so `'Waiting for your target...'` isn't found.

- [ ] **Step 3: Implement**

In `src/pages/PlayerGame.js`, replace the alive-target block added in Task 3 —

```jsx
{
    gameStarted && playerData?.isAlive && (
        <Text mb={6}>{`Your target: ${playerData.targets.join(', ')}`}</Text>
    );
}
```

— with:

```jsx
{
    gameStarted && playerData?.isAlive && (
        <Text mb={6}>
            {playerData.targets.length > 0
                ? `Your target: ${playerData.targets.join(', ')}`
                : 'Waiting for your target...'}
        </Text>
    );
}
```

The `{!gameStarted && <Text mb={6}>Waiting for the host to start...</Text>}` block from Task 3 is untouched by this step.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, plus all prior `PlayerGame` tests still pass (run the whole file, not just the new test).

- [ ] **Step 5: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Show a placeholder while a started game hasn't assigned a target yet"
```

---

## Task 5: Eliminated state

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `playerData.isAlive` from Task 3.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

```js
it('shows an eliminated message instead of a target once isAlive is false', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
        } else if (ref === 'player-ref') {
            callback({ data: () => ({ isAlive: false, targets: [] }) });
        }
        return () => {};
    });

    renderWaiting();

    expect(screen.getByText("You've been eliminated")).toBeInTheDocument();
    expect(
        screen.getByText(/you may be revived if the host assigns you a revival mission/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/your target/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: FAIL — nothing renders eliminated-state text yet (the `isAlive` guard on the target block simply renders nothing when false).

- [ ] **Step 3: Implement**

In `src/pages/PlayerGame.js`, add an eliminated branch alongside the alive branch built in Tasks 3-4:

```jsx
{
    gameStarted && playerData && !playerData.isAlive && (
        <>
            <Heading size="md" mb={2}>
                You&apos;ve been eliminated
            </Heading>
            <Text mb={6}>You may be revived if the host assigns you a revival mission.</Text>
        </>
    );
}
```

Place this immediately after the alive-target block from Task 4 (the one starting `{gameStarted && playerData?.isAlive && ...}`), inside the same `<Flex>` — as a sibling `<>...</>`, not nested inside it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, plus the full `PlayerGame` file still green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Show an eliminated state instead of a target once isAlive is false"
```

---

## Task 6: Player-doc subscription errors clear the session and redirect home

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `clearPlayerSession`, `navigate` (both already used by the existing room-subscription error handler in this file).
- Produces: nothing new consumed elsewhere — this task extracts a small shared helper both `onSnapshot` error callbacks call.

- [ ] **Step 1: Write the failing test**

```js
it('clears the session and redirects home when the player-doc subscription reports a permission error', async () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback, errorCallback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
        } else if (ref === 'player-ref') {
            errorCallback({
                code: 'permission-denied',
                message: 'Missing or insufficient permissions.',
            });
        }
        return () => {};
    });

    renderWaiting();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(readPlayerSession()).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: FAIL — the player-doc `onSnapshot` call from Task 3 has no third (error) argument, so `errorCallback` is never invoked and the screen never redirects.

- [ ] **Step 3: Implement**

In `src/pages/PlayerGame.js`, extract the existing inline error-handling body (currently the second argument's callback body at the room subscription's error path) into a shared function defined above both effects:

```js
// Shared by both subscriptions below: a permission error or the watched
// doc disappearing both mean this session no longer belongs here (room
// deleted, or — for the player doc — the GM removed this player from the
// roster), so both bounce the same way a deleted room already does.
const handleSubscriptionError = (err) => {
    console.error('Error watching room:', err);
    clearPlayerSession();
    navigate('/', { replace: true });
};
```

Update the existing room-subscription `useEffect`'s error callback to call it:

```js
const unsubscribe = onSnapshot(
    roomRef,
    (snapshot) => {
        if (!snapshot.exists()) {
            clearPlayerSession();
            navigate('/', { replace: true });
            return;
        }
        setGameStarted(snapshot.data()?.gameStarted ?? false);
    },
    handleSubscriptionError
);
```

Add the same third argument to the player-doc subscription from Task 3:

```js
const unsubscribe = onSnapshot(
    playerRef,
    (snapshot) => {
        setPlayerData(snapshot.data());
    },
    handleSubscriptionError
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerGame`
Expected: PASS, plus the full `PlayerGame` file still green (including the pre-existing "permission error" test for the room subscription — confirms the extraction didn't change that behavior).

- [ ] **Step 5: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Handle player-doc subscription errors the same way as room errors"
```

---

## Task 7: Docs and final gate

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/testing.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — documentation only.

- [ ] **Step 1: Update `docs/architecture.md`**

Change the routes table row (`docs/architecture.md:89`):

```
| `/rooms/:roomID/waiting`        | `PlayerGame`     | Post-join landing for a self-registered player; shows their target once the game starts, or an eliminated state | ✅      |
```

- [ ] **Step 2: Update `docs/testing.md`**

Run the real suite and copy its actual output — do not hand-type counts:

```bash
npx jest --selectProjects unit dom
```

Update the illustrative `$ npm test` block and the module table's `PlayerWaiting.test.jsx` row (`docs/testing.md:35,74`) to reference `PlayerGame.test.jsx` with its real, current test count and a description covering the new target/eliminated states, and update the total suite/test counts shown in the doc to match this run's real output.

- [ ] **Step 3: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four succeed with zero warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/testing.md
git commit -m "Document the player target/status view"
```
