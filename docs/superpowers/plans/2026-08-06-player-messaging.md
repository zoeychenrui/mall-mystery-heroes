# Player Messaging (/whisper, /broadcast, /leaderboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/whisper`, `/broadcast`, and `/leaderboard` from no-op stubs into real commands, writing to a new `playerMessages` Firestore subcollection that prepares the write-side half of the contract for a future player-facing mobile app.

**Architecture:** A new `rooms/{roomID}/playerMessages` subcollection (mirroring how `photos` was already prepped for a mobile app that doesn't exist yet — this is the mirror case, written now, read later). Each command validates its arguments the same way every existing `ChatInput.js` command does, writes one `playerMessages` document, then logs a GM-facing confirmation to the existing chat log. Firestore rules scope the new collection to the host, same interim compromise `photos` already uses.

**Tech Stack:** React (Create React App), Firebase Firestore (client SDK via `dbCalls.js`), Jest + React Testing Library, `@firebase/rules-unit-testing` for rules tests.

## Global Constraints

- Player names in any GM-facing log/toast text must show actual stored casing, not the normalized lowercase matching key — use `resolvePlayerDisplayName(name, players)` from `src/game/playerNames.js` (already implemented; do not reimplement).
- Every `dbCalls.js` write function follows the `add…For…`/`update…For…`/`fetch…For…` naming convention already established in that file.
- `src/game/` modules are pure — no Firebase import, no React import, no `Math.random()` without an injectable `rng`.
- 4-space indentation, Prettier-formatted (`npm run format`), ESLint clean with `--max-warnings=0` (`npm run lint`).
- Every new/changed test must be confirmed RED against the pre-fix code before the implementation makes it GREEN, per this repo's TDD convention — write the test, run it, watch it fail for the right reason, then implement.
- Run the full gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) before any commit in this plan; run `npm run test:rules` specifically after Task 3, and again at the end.
- Never import `dbCalls.js` or `utils/firebase.js` into a `.test.js`/`.test.jsx` unit/component test — mock `dbCalls.js` via an explicit factory, matching every existing test file in this repo.

---

## File Structure

- **Create** `src/game/leaderboard.js` — pure standings-sorting logic.
- **Create** `src/game/leaderboard.test.js` — its tests.
- **Modify** `src/components/firebase_calls/dbCalls.js` — add `addPlayerMessageForRoom`.
- **Modify** `firestore.rules` — add the `playerMessages` match block.
- **Modify** `test/firestore.rules.test.js` — add its rules test block.
- **Modify** `src/game/commands.js` — remove `/whisper`, `/broadcast`, `/leaderboard` from `UNIMPLEMENTED_COMMANDS` (one line removed per command, across Tasks 4–6).
- **Modify** `src/components/logs_components/ChatInput.js` — add the three `case` branches; add the three new imports.
- **Modify** `src/components/logs_components/ChatInput.test.jsx` — add per-command test coverage; shrink and eventually delete the now-obsolete "toasts not implemented" `it.each`.
- **Modify** `src/game/commandCompletion.js` — add `candidatesForSlot` cases for the three commands.
- **Modify** `src/game/commandCompletion.test.js` — add per-command completion tests; shrink and eventually delete the now-obsolete "does not suggest arguments" `it.each`.
- **Modify** `docs/commands.md`, `docs/data-model.md`, `docs/architecture.md` — move the three commands into the real documentation; document the new collection.

---

### Task 1: Pure leaderboard standings logic

**Files:**

- Create: `src/game/leaderboard.js`
- Test: `src/game/leaderboard.test.js`

**Interfaces:**

- Produces: `buildLeaderboardStandings(players: Array<{name, score, isAlive}>) => Array<{name, score, isAlive}>`, sorted by `score` descending, dead players included (not filtered). Task 6 (`/leaderboard`) imports this from `../../game/leaderboard`.

- [ ] **Step 1: Write the failing test**

Create `src/game/leaderboard.test.js`:

```js
import { buildLeaderboardStandings } from './leaderboard';

describe('buildLeaderboardStandings', () => {
    it('sorts players by score descending', () => {
        const players = [
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Bob', score: 10, isAlive: true },
            { name: 'Carol', score: 0, isAlive: true },
        ];

        expect(buildLeaderboardStandings(players)).toEqual([
            { name: 'Bob', score: 10, isAlive: true },
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Carol', score: 0, isAlive: true },
        ]);
    });

    it('includes dead players rather than filtering them out', () => {
        const players = [
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Bob', score: 10, isAlive: false },
        ];

        const standings = buildLeaderboardStandings(players);

        expect(standings.find((p) => p.name === 'Bob')).toEqual({
            name: 'Bob',
            score: 10,
            isAlive: false,
        });
    });

    it('returns an empty array for an empty roster', () => {
        expect(buildLeaderboardStandings([])).toEqual([]);
    });

    it('does not mutate the input array', () => {
        const players = [
            { name: 'Alice', score: 5, isAlive: true },
            { name: 'Bob', score: 10, isAlive: true },
        ];
        const original = [...players];

        buildLeaderboardStandings(players);

        expect(players).toEqual(original);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern=leaderboard`
Expected: FAIL — `Cannot find module './leaderboard'`

- [ ] **Step 3: Write the implementation**

Create `src/game/leaderboard.js`:

```js
/**
 * Builds the standings snapshot for /leaderboard send
 * (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).
 * Pure — no Firebase, no React. Dead players are included, not filtered,
 * matching PlayersList's own display convention (everyone shown,
 * alive/dead visually distinguished, not everyone-alive-only).
 */
export const buildLeaderboardStandings = (players) =>
    [...players]
        .sort((a, b) => b.score - a.score)
        .map((player) => ({
            name: player.name,
            score: player.score,
            isAlive: player.isAlive,
        }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit --testPathPattern=leaderboard`
Expected: PASS, 4 tests

- [ ] **Step 5: Lint and format**

Run: `npm run format && npx eslint src/game/leaderboard.js src/game/leaderboard.test.js --max-warnings=0`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add src/game/leaderboard.js src/game/leaderboard.test.js
git commit -m "Add buildLeaderboardStandings, pure sorting logic for /leaderboard send"
```

---

### Task 2: `dbCalls.addPlayerMessageForRoom`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js:59-67` (immediately after the existing `addLogForRoom` function)

**Interfaces:**

- Produces: `addPlayerMessageForRoom(message: {type, recipient, text, standings}, roomID: string) => Promise<void>` — writes to `rooms/{roomID}/playerMessages`, stamping `timestamp: serverTimestamp()`. Tasks 4–6 call this from `ChatInput.js`.
- Consumes: `db` (already imported at the top of this file), `collection`, `addDoc`, `serverTimestamp` (already imported at the top of this file — see the existing `import` block).

This function is not unit-testable in isolation — `dbCalls.js` touches the real Firestore SDK, and per `docs/testing.md` / `CLAUDE.md`, `dbCalls.js` is never imported into a unit/component test. It is exercised two ways: indirectly, via `ChatInput.test.jsx`'s mock in Tasks 4–6, and for real, via the Firestore rules test in Task 3 (which writes directly to the emulator, not through this function, but proves the collection accepts exactly this shape).

- [ ] **Step 1: Add the function**

In `src/components/firebase_calls/dbCalls.js`, immediately after the existing `addLogForRoom` function (ends at line 67 with `};`), insert:

```js
// Adds a player-facing message to the room's playerMessages subcollection —
// the write-side half of a contract with the player mobile app that
// doesn't exist yet (docs/superpowers/specs/2026-08-06-player-messaging-
// mobile-prep-design.md), the same interim shape `photos` already uses.
// `message` is `{ type, recipient, text, standings }` — see the spec for
// which fields apply to which `type`.
export const addPlayerMessageForRoom = async (message, roomID) => {
    const messagesRef = collection(db, 'rooms', roomID, 'playerMessages');
    await addDoc(messagesRef, { ...message, timestamp: serverTimestamp() });
};
```

- [ ] **Step 2: Lint and format**

Run: `npm run format && npx eslint src/components/firebase_calls/dbCalls.js --max-warnings=0`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js
git commit -m "Add dbCalls.addPlayerMessageForRoom"
```

---

### Task 3: Firestore rules for `playerMessages`

**Files:**

- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Produces: `rooms/{roomId}/playerMessages/{messageId}` — readable and writable only by `isHostOfExistingRoom(roomId)` (the function is already defined earlier in `firestore.rules`; do not redefine it).

- [ ] **Step 1: Write the failing rules test**

Append to the end of `test/firestore.rules.test.js` (after the existing `photos` `describe` block, which currently ends the file):

```js
describe('rooms/{roomId}/playerMessages/{messageId} (interim: host-only, see firestore.rules comment)', () => {
    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'x',
                standings: null,
            })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'x',
                standings: null,
            })
        );
    });
});
```

- [ ] **Step 2: Run the rules test to verify it fails**

Run: `npm run test:rules`
Expected: FAIL — the "allows the host to write" case fails, since no `match /playerMessages/{messageId}` block exists yet, so the default-deny rule applies to hosts too.

- [ ] **Step 3: Add the rules block**

In `firestore.rules`, find the existing `photos` block:

```
      // Interim scope — see file header.
      match /photos/{photoId} {
        allow read: if isSignedIn();
        allow write: if isHostOfExistingRoom(roomId);
      }
    }
  }
}
```

Replace it with:

```
      // Interim scope — see file header.
      match /photos/{photoId} {
        allow read: if isSignedIn();
        allow write: if isHostOfExistingRoom(roomId);
      }

      // Interim scope, same reasoning as photos above — see file header.
      match /playerMessages/{messageId} {
        allow read: if isSignedIn();
        allow write: if isHostOfExistingRoom(roomId);
      }
    }
  }
}
```

Also update the file header comment, which currently reads:

```
//   - `photos` is scoped to the host, not "the mobile app's identity" as
//     item 2 originally called for — no such app exists yet (item 33).
//     Revisit once it does.
```

Change it to:

```
//   - `photos` and `playerMessages` are scoped to the host, not "the
//     mobile app's identity" as item 2 originally called for — no such
//     app exists yet (item 33). Revisit once it does.
```

- [ ] **Step 4: Run the rules test to verify it passes**

Run: `npm run test:rules`
Expected: PASS, all tests including the two new ones

- [ ] **Step 5: Format**

Run: `npm run format`
Expected: clean (Prettier formats `.rules` files too — verify `firestore.rules` wasn't reformatted unexpectedly beyond the new block)

- [ ] **Step 6: Commit**

```bash
git add firestore.rules test/firestore.rules.test.js
git commit -m "Add Firestore rules for rooms/{roomId}/playerMessages"
```

---

### Task 4: Implement `/whisper`

**Files:**

- Modify: `src/game/commands.js:22` — remove `'/whisper'` from `UNIMPLEMENTED_COMMANDS`
- Modify: `src/components/logs_components/ChatInput.js` — imports, and a new `case '/whisper':` in the switch
- Modify: `src/components/logs_components/ChatInput.test.jsx` — new tests; shrink the "toasts not implemented" `it.each`
- Modify: `src/game/commandCompletion.js` — `candidatesForSlot` case for `/whisper`
- Modify: `src/game/commandCompletion.test.js` — new tests; shrink the "does not suggest arguments" `it.each`

**Interfaces:**

- Consumes: `addPlayerMessageForRoom` (Task 2), `resolvePlayerDisplayName` (already exists, `src/game/playerNames.js`), `normalizePlayerName` (already exists, same file).
- Produces: nothing new consumed by later tasks — `/broadcast` (Task 5) and `/leaderboard` (Task 6) are independent commands, not dependent on `/whisper`'s implementation.

**Command shape:** `/whisper [player] [message]`. Player must be in the roster (same pattern as every other player-targeting command). Message is everything after the player token, joined with spaces — not just `args[1]`, since a message is free text, not a lookup key that needs bracket syntax.

#### Part A — ChatInput.js

- [ ] **Step 1: Write the failing ChatInput test**

In `src/components/logs_components/ChatInput.test.jsx`, add `addPlayerMessageForRoom: jest.fn(),` to the `jest.mock('../firebase_calls/dbCalls', ...)` factory (alphabetical position — right after `addPlayerToCompletedByForTask`):

```js
jest.mock('../firebase_calls/dbCalls', () => ({
    addPlayerMessageForRoom: jest.fn(),
    addPlayerToCompletedByForTask: jest.fn(),
    fetchAlivePlayerNamesForRoom: jest.fn(),
    fetchPlayersByStatusForRoom: jest.fn(),
    fetchReferenceByIndexForTask: jest.fn(),
    fetchTaskByIndexForRoom: jest.fn(),
    fetchTasksByCompletionForRoom: jest.fn(),
    setOpenSznOfPlayerToValueForRoom: jest.fn(),
    updateIsAliveForPlayer: jest.fn(),
    updateIsCompleteToTrueForTaskByIndex: jest.fn(),
    updatePointsForPlayer: jest.fn(),
}));
```

Then add a new `describe` block, placed after the existing `describe('chat log messages show a player's actual stored casing...')` block (search for that heading to find the spot):

```js
describe('/whisper (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)', () => {
    it('writes a playerMessages doc and logs a confirmation', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/whisper alice watch your back');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'whisper',
                    recipient: 'Alice',
                    text: 'watch your back',
                    standings: null,
                },
                'room-a'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Whisper sent to Alice: "watch your back"',
            'teal.400'
        );
    });

    it('rejects a whisper to a player not on the roster', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/whisper nobody hi');

        expect(await screen.findByText(/player nobody is invalid/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });

    it('rejects a whisper with a blank message', async () => {
        const commandInput = mountChatInput([{ name: 'Alice', isAlive: true }]);
        typeAndSubmit(commandInput, '/whisper alice');

        expect(await screen.findByText(/whisper message cannot be blank/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});
```

Then shrink the existing "toasts not implemented" test. Find:

```js
    it.each(['/broadcast hello', '/leaderboard', '/whisper alice hi'])(
        '%s toasts "not implemented" instead of silently doing nothing',
        async (command) => {
```

Change the array to remove `'/whisper alice hi'`:

```js
    it.each(['/broadcast hello', '/leaderboard'])(
        '%s toasts "not implemented" instead of silently doing nothing',
        async (command) => {
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput -t "whisper"`
Expected: FAIL — `/whisper` still hits the `UNIMPLEMENTED_COMMANDS` short-circuit, so it toasts "not implemented" instead of writing/logging anything; the "rejects a whisper to a player not on the roster" and "blank message" cases also fail since no validation branch exists yet to produce those specific messages.

- [ ] **Step 3: Remove `/whisper` from `UNIMPLEMENTED_COMMANDS`**

In `src/game/commands.js`, change:

```js
export const UNIMPLEMENTED_COMMANDS = ['/broadcast', '/leaderboard', '/whisper'];
```

to:

```js
export const UNIMPLEMENTED_COMMANDS = ['/broadcast', '/leaderboard'];
```

- [ ] **Step 4: Implement the case**

In `src/components/logs_components/ChatInput.js`, update the import block:

```js
import {
    addPlayerMessageForRoom,
    addPlayerToCompletedByForTask,
    fetchAlivePlayerNamesForRoom,
    fetchPlayersByStatusForRoom,
    fetchReferenceByIndexForTask,
    fetchTaskByIndexForRoom,
    fetchTasksByCompletionForRoom,
    setOpenSznOfPlayerToValueForRoom,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from '../firebase_calls/dbCalls';
```

Then, in the `switch (commandLine) { ... }` block, immediately before the `default:` case (right after the `/revive` case's closing `break;`), insert:

```js

            case '/whisper':
                const whisperPlayerName = args[0] ? normalizePlayerName(args[0]) : '';
                const whisperMessage = args.slice(1).join(' ').trim();
                if (arrayOfPlayerNames.includes(whisperPlayerName)) {
                    if (whisperMessage) {
                        const whisperRecipientName = resolvePlayerDisplayName(
                            whisperPlayerName,
                            players
                        );
                        await addPlayerMessageForRoom(
                            {
                                type: 'whisper',
                                recipient: whisperRecipientName,
                                text: whisperMessage,
                                standings: null,
                            },
                            roomID
                        );
                        await addLog(
                            `Whisper sent to ${whisperRecipientName}: "${whisperMessage}"`,
                            'teal.400'
                        );
                    } else {
                        createAlert('error', 'Error', 'Whisper message cannot be blank', 1500);
                        console.error('Whisper message cannot be blank');
                    }
                } else {
                    createAlert('error', 'Error', `Player ${args[0]} is invalid`, 1500);
                    console.error(`Player ${args[0]} is invalid.`);
                }
                break;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput`
Expected: PASS, full file — including the shrunk `it.each` (now just `/broadcast hello` and `/leaderboard`, both still correctly unimplemented at this point)

#### Part B — Tab-completion

- [ ] **Step 6: Write the failing completion test**

In `src/game/commandCompletion.test.js`, add a new `describe` block after the existing `describe('complete — /openseason', ...)` block:

```js
describe('complete — /whisper', () => {
    it('completes the player slot', () => {
        const result = complete('/whisper B', { players });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('does not suggest anything for the message slot — free text', () => {
        const result = complete('/whisper bob hel', { players });
        expect(result).toEqual({ applied: false });
    });
});
```

(`players` here is the existing top-of-file fixture: `[{ name: 'Alice Smith', isAlive: true }, { name: 'Alex', isAlive: true }, { name: 'Bob', isAlive: false }]`.)

Then shrink the existing "unimplemented commands" test. Find:

```js
describe('complete — unimplemented commands only complete the command word', () => {
    it.each(['/whisper', '/broadcast', '/leaderboard'])(
```

Change the array to remove `'/whisper'`:

```js
describe('complete — unimplemented commands only complete the command word', () => {
    it.each(['/broadcast', '/leaderboard'])(
```

- [ ] **Step 7: Run to verify the new tests fail**

Run: `npx jest --selectProjects unit --testPathPattern=commandCompletion -t "whisper"`
Expected: FAIL — `/whisper` has no `case` in `candidatesForSlot` yet, so `complete('/whisper B', ...)` returns `{ applied: false }` instead of offering `Bob`.

- [ ] **Step 8: Implement the completion case**

In `src/game/commandCompletion.js`, in `candidatesForSlot`'s `switch (command)`, add a case (position doesn't matter functionally; place it near `/kill`'s case for readability, since both use `playerNames`):

```js
        case '/whisper':
            return slotIndex === 1 ? playerNames(players) : null;
```

- [ ] **Step 9: Run to verify the tests pass**

Run: `npx jest --selectProjects unit --testPathPattern=commandCompletion`
Expected: PASS, full file

- [ ] **Step 10: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green

- [ ] **Step 11: Commit**

```bash
git add src/game/commands.js src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx src/game/commandCompletion.js src/game/commandCompletion.test.js
git commit -m "Implement /whisper: private player-facing message + Tab-completion"
```

---

### Task 5: Implement `/broadcast`

**Files:**

- Modify: `src/game/commands.js` — remove `'/broadcast'` from `UNIMPLEMENTED_COMMANDS`
- Modify: `src/components/logs_components/ChatInput.js` — new `case '/broadcast':`
- Modify: `src/components/logs_components/ChatInput.test.jsx` — new tests; shrink the `it.each` further
- Modify: `src/game/commandCompletion.js` — `candidatesForSlot` case for `/broadcast`
- Modify: `src/game/commandCompletion.test.js` — new tests; shrink the `it.each` further

**Interfaces:**

- Consumes: `addPlayerMessageForRoom` (Task 2). No dependency on Task 4's `/whisper` code.

**Command shape:** `/broadcast [message]`. No player argument — every token is part of the message.

#### Part A — ChatInput.js

- [ ] **Step 1: Write the failing ChatInput test**

Add to `src/components/logs_components/ChatInput.test.jsx`, after the `/whisper` `describe` block added in Task 4:

```js
describe('/broadcast (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)', () => {
    it('writes a playerMessages doc and logs a confirmation', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/broadcast the game has started');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: 'the game has started',
                    standings: null,
                },
                'room-a'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Broadcast sent: "the game has started"',
            'teal.400'
        );
    });

    it('rejects a blank broadcast', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/broadcast');

        expect(await screen.findByText(/broadcast message cannot be blank/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});
```

Then shrink the `it.each` again. Find:

```js
    it.each(['/broadcast hello', '/leaderboard'])(
```

Change to:

```js
    it.each(['/leaderboard'])(
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput -t "broadcast"`
Expected: FAIL — `/broadcast` is still on `UNIMPLEMENTED_COMMANDS`.

- [ ] **Step 3: Remove `/broadcast` from `UNIMPLEMENTED_COMMANDS`**

In `src/game/commands.js`, change:

```js
export const UNIMPLEMENTED_COMMANDS = ['/broadcast', '/leaderboard'];
```

to:

```js
export const UNIMPLEMENTED_COMMANDS = ['/leaderboard'];
```

- [ ] **Step 4: Implement the case**

In `src/components/logs_components/ChatInput.js`, insert immediately after the `/whisper` case added in Task 4 (still before `default:`):

```js

            case '/broadcast':
                const broadcastMessage = args.join(' ').trim();
                if (broadcastMessage) {
                    await addPlayerMessageForRoom(
                        {
                            type: 'broadcast',
                            recipient: null,
                            text: broadcastMessage,
                            standings: null,
                        },
                        roomID
                    );
                    await addLog(`Broadcast sent: "${broadcastMessage}"`, 'teal.400');
                } else {
                    createAlert('error', 'Error', 'Broadcast message cannot be blank', 1500);
                    console.error('Broadcast message cannot be blank');
                }
                break;
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput`
Expected: PASS, full file

#### Part B — Tab-completion

- [ ] **Step 6: Write the failing completion test**

Add to `src/game/commandCompletion.test.js`, after the `/whisper` block added in Task 4:

```js
describe('complete — /broadcast', () => {
    it('does not suggest anything for the message slot — free text', () => {
        const result = complete('/broadcast hel', { players });
        expect(result).toEqual({ applied: false });
    });
});
```

Shrink the `it.each` again. Find:

```js
    it.each(['/broadcast', '/leaderboard'])(
```

Change to:

```js
    it.each(['/leaderboard'])(
```

- [ ] **Step 7: Run to verify tests pass without further changes**

Run: `npx jest --selectProjects unit --testPathPattern=commandCompletion`
Expected: PASS. This is the one case in this plan where no `candidatesForSlot` change is needed — `/broadcast` has no player/literal slot to suggest, only free text, and `candidatesForSlot`'s `default: return null;` already produces `{ applied: false }` correctly once `/broadcast` is off `UNIMPLEMENTED_COMMANDS`. The test in Step 6 is what confirms this rather than assuming it.

- [ ] **Step 8: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green

- [ ] **Step 9: Commit**

```bash
git add src/game/commands.js src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx src/game/commandCompletion.test.js
git commit -m "Implement /broadcast: player-facing message to everyone"
```

---

### Task 6: Implement `/leaderboard`

**Files:**

- Modify: `src/game/commands.js` — remove `'/leaderboard'` from `UNIMPLEMENTED_COMMANDS` (the array becomes empty — leave it as `[]`, do not delete the export)
- Modify: `src/components/logs_components/ChatInput.js` — new import, new `case '/leaderboard':`
- Modify: `src/components/logs_components/ChatInput.test.jsx` — new tests; delete the now-empty `it.each` block entirely
- Modify: `src/game/commandCompletion.js` — `candidatesForSlot` case for `/leaderboard`
- Modify: `src/game/commandCompletion.test.js` — new tests; delete the now-empty `describe('complete — unimplemented commands...')` block entirely

**Interfaces:**

- Consumes: `addPlayerMessageForRoom` (Task 2), `buildLeaderboardStandings` (Task 1).

**Command shape:** `/leaderboard send` — no custom message; `args[0]` must be the literal `send` (case-insensitive), matching `/openseason`'s `start`/`end` literal-argument pattern.

#### Part A — ChatInput.js

- [ ] **Step 1: Write the failing ChatInput test**

Add to `src/components/logs_components/ChatInput.test.jsx`, after the `/broadcast` block added in Task 5:

```js
describe('/leaderboard (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)', () => {
    it('writes the current standings and logs a confirmation', async () => {
        const commandInput = mountChatInput([
            { name: 'Alice', isAlive: true, score: 10 },
            { name: 'Bob', isAlive: false, score: 20 },
        ]);
        typeAndSubmit(commandInput, '/leaderboard send');

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'leaderboard',
                    recipient: null,
                    text: null,
                    standings: [
                        { name: 'Bob', score: 20, isAlive: false },
                        { name: 'Alice', score: 10, isAlive: true },
                    ],
                },
                'room-a'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Leaderboard sent to all players',
            'teal.400'
        );
    });

    it('rejects an invalid argument', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/leaderboard nonsense');

        expect(await screen.findByText(/nonsense is not a valid input/i)).toBeInTheDocument();
        expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    });
});
```

Then delete the now-empty `it.each` block entirely. Find and remove:

```js
it.each(['/leaderboard'])(
    '%s toasts "not implemented" instead of silently doing nothing',
    async (command) => {
        const [commandLine] = command.split(' ');
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, command);

        expect(
            await screen.findByText(new RegExp(`${commandLine} is not implemented yet`, 'i'))
        ).toBeInTheDocument();
    }
);
```

(The `describe('silent no-ops now give feedback (improvements item 21)', ...)` block that wraps it stays — it still has the `/revive` test above this. Only the `it.each` itself is removed.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput -t "leaderboard"`
Expected: FAIL — `/leaderboard` is still on `UNIMPLEMENTED_COMMANDS`.

- [ ] **Step 3: Remove `/leaderboard` from `UNIMPLEMENTED_COMMANDS`**

In `src/game/commands.js`, change:

```js
export const UNIMPLEMENTED_COMMANDS = ['/leaderboard'];
```

to:

```js
export const UNIMPLEMENTED_COMMANDS = [];
```

- [ ] **Step 4: Implement the case**

In `src/components/logs_components/ChatInput.js`, add the import:

```js
import { buildLeaderboardStandings } from '../../game/leaderboard';
```

(Place it near the other `../../game/` imports — next to `import { parseCommand, UNIMPLEMENTED_COMMANDS } from '../../game/commands';`.)

Then insert the case immediately after the `/broadcast` case added in Task 5 (still before `default:`):

```js

            case '/leaderboard':
                arg = args[0] ? args[0].toLowerCase() : '';
                if (arg === 'send') {
                    const standings = buildLeaderboardStandings(players);
                    await addPlayerMessageForRoom(
                        { type: 'leaderboard', recipient: null, text: null, standings },
                        roomID
                    );
                    await addLog('Leaderboard sent to all players', 'teal.400');
                } else {
                    createAlert('error', 'Error', `${args[0]} is not a valid input`, 1500);
                    console.error(`${args[0]} is not a valid input`);
                }
                break;
```

(`arg` is already declared as `let arg;` near the top of `handleCommandExecution` and reused across cases — do not redeclare it.)

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput`
Expected: PASS, full file

#### Part B — Tab-completion

- [ ] **Step 6: Write the failing completion test**

Add to `src/game/commandCompletion.test.js`, after the `/broadcast` block added in Task 5:

```js
describe('complete — /leaderboard', () => {
    it('completes the literal "send" argument', () => {
        const result = complete('/leaderboard s', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('send');
    });
});
```

Then delete the now-empty `describe('complete — unimplemented commands only complete the command word', ...)` block entirely — by this point its `it.each` array is `['/leaderboard']`, and removing that last entry leaves nothing meaningful to test (there are no longer any `UNIMPLEMENTED_COMMANDS` — the array is `[]` after Step 3 above). Find and remove the whole block:

```js
describe('complete — unimplemented commands only complete the command word', () => {
    it.each(['/leaderboard'])('does not suggest arguments for %s', (command) => {
        const result = complete(`${command} al`, { players });
        expect(result).toEqual({ applied: false });
    });
});
```

- [ ] **Step 7: Run to verify the new test fails**

Run: `npx jest --selectProjects unit --testPathPattern=commandCompletion -t "leaderboard"`
Expected: FAIL — `candidatesForSlot` has no `/leaderboard` case yet.

- [ ] **Step 8: Implement the completion case**

In `src/game/commandCompletion.js`, `candidatesForSlot`'s `switch (command)`, add:

```js
        case '/leaderboard':
            return slotIndex === 1 ? ['send'] : null;
```

- [ ] **Step 9: Run to verify all completion tests pass**

Run: `npx jest --selectProjects unit --testPathPattern=commandCompletion`
Expected: PASS, full file

- [ ] **Step 10: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green. `UNIMPLEMENTED_COMMANDS` is now `[]` — confirm `npm run lint` doesn't flag it as an unused/pointless export (it's still imported and checked in both `ChatInput.js` and `commandCompletion.js`, so it stays live code, just always empty for now).

- [ ] **Step 11: Commit**

```bash
git add src/game/commands.js src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx src/game/commandCompletion.js src/game/commandCompletion.test.js
git commit -m "Implement /leaderboard: sends live standings to all players"
```

---

### Task 7: Documentation

**Files:**

- Modify: `docs/commands.md`
- Modify: `docs/data-model.md`
- Modify: `docs/architecture.md`

**Interfaces:** None — documentation only, no code.

- [ ] **Step 1: Update `docs/commands.md`**

Remove the entire "Declared but not implemented" section:

```markdown
## Declared but not implemented

Tab only completes the command word itself for these — never their
arguments (`commandCompletion.js` checks `UNIMPLEMENTED_COMMANDS` before
offering anything else). They pass the whitelist check, so they consume the
input and clear the box, but their `case` bodies are empty `// TO DO` stubs.
**They fail silently.**

| Command        | Suggested syntax              |
| -------------- | ----------------------------- |
| `/broadcast`   | `/broadcast [message]`        |
| `/leaderboard` | `/leaderboard send`           |
| `/whisper`     | `/whisper [player] [message]` |

All three imply an out-of-band delivery channel to players — most likely the
Discord bot hinted at by the unused `DISCORD_TOKEN` in `.env`.

---
```

In its place (still before the `## Implementation note` section that followed it), add three new entries to the "Implemented commands" section — append them after the existing `### /mission view` entry:

```markdown
### `/whisper <player> <message>`

Sends a private, player-facing message — visible (once a player-facing
mobile app exists to show it) only to the named player. Writes to
`rooms/{roomID}/playerMessages`
(docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).

| Check                                                    | Failure                           |
| -------------------------------------------------------- | --------------------------------- |
| Player in roster                                         | `Player {name} is invalid`        |
| Message (everything after the player token) is non-empty | `Whisper message cannot be blank` |

Logs a GM-facing confirmation to chat: `Whisper sent to {name}: "{message}"`.

### `/broadcast <message>`

Sends a player-facing message visible to every player, once a mobile app
exists to show it. Same `playerMessages` write as `/whisper`, with
`recipient: null`.

| Check                | Failure                             |
| -------------------- | ----------------------------------- |
| Message is non-empty | `Broadcast message cannot be blank` |

Logs: `Broadcast sent: "{message}"`.

### `/leaderboard send`

Packages the live roster's current standings (sorted by score descending,
dead players included) and sends that snapshot as a player-facing message.
Takes no custom text — the second word must be the literal `send`.

| Check                                                  | Failure                      |
| ------------------------------------------------------ | ---------------------------- |
| Second argument is literally `send` (case-insensitive) | `{arg} is not a valid input` |

Logs: `Leaderboard sent to all players`.

---
```

Also update the "Parser caveats" section's Tab-completion description, which currently says (search for this exact text):

```
- **Tab completion is shell-style, one argument at a time**
```

Immediately after that paragraph (it ends with a sentence about mission indices being fetched on demand), no change is needed there — that section already describes the mechanism generically, not per-command. Skip this sub-step; it was a false lead during planning. (This note exists so the plan executor doesn't go looking for a change that isn't needed.)

- [ ] **Step 2: Update `docs/data-model.md`**

Add a new section immediately after the existing `## rooms/{roomID}/photos/{autoId}` section (search for its content, ending just before the `---` that precedes `## Firebase Storage`):

```markdown
## `rooms/{roomID}/playerMessages/{autoId}`

Player-facing messages from `/whisper`, `/broadcast`, and `/leaderboard`
(docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).
**Designed to be read by a player-facing mobile app**, not by this
codebase — the mirror case of `photos` above, which is designed to be
_written_ by that same not-yet-existing app. Nothing in this repository
reads a `playerMessages` document; today this collection has a writer
(`dbCalls.addPlayerMessageForRoom`) but no reader at all, except manual
inspection.

| Field       | Type                                        | Notes                                                                                                           |
| ----------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `type`      | `'whisper' \| 'broadcast' \| 'leaderboard'` | Discriminates which of the other fields is populated.                                                           |
| `recipient` | `string \| null`                            | The player's real (display) name. Populated only for `'whisper'`; `null` means "everyone."                      |
| `text`      | `string \| null`                            | Free-text body. Populated for `'whisper'`/`'broadcast'`; `null` for `'leaderboard'`.                            |
| `standings` | `Array<{name, score, isAlive}> \| null`     | Populated only for `'leaderboard'` — structured, not pre-rendered text, so a real client can render its own UI. |
| `timestamp` | `Timestamp`                                 | `serverTimestamp()`.                                                                                            |

---
```

- [ ] **Step 3: Update `docs/architecture.md`**

Find the existing mobile-app paragraph (search for `does not currently exist, anywhere`):

```
- **A player-facing mobile app — does not currently exist, anywhere**
  ([improvements.md](./improvements.md) item 33). It is never referenced in
  code, but its existence is implied: the `photos` collection is designed to
  be read by such an app but is never written by anything in this repository
  — nothing in `dbCalls.js` writes a photo document (the test helper that
  once did was dead code, deleted per item 14). `firestore.rules`'s `photos`
  block is scoped to the host rather than to a distinct mobile-app identity
  for the same reason (item 2). Until this app exists, kill-proof photos
  have no way to enter Firestore except manual/emulator seeding.
```

Replace with:

```
- **A player-facing mobile app — does not currently exist, anywhere**
  ([improvements.md](./improvements.md) item 33). It is never referenced in
  code, but its existence is implied by two collections prepped for it, in
  opposite directions: `photos` is designed to be *read* by such an app but
  is never *written* by anything in this repository — nothing in
  `dbCalls.js` writes a photo document (the test helper that once did was
  dead code, deleted per item 14). `playerMessages`
  (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md)
  is the mirror case: written by `/whisper`, `/broadcast`, and
  `/leaderboard`, but never read by anything in this repository either.
  `firestore.rules` scopes both collections to the host rather than to a
  distinct mobile-app identity, for the same reason (item 2). Until this
  app exists, kill-proof photos have no way to enter Firestore except
  manual/emulator seeding, and player messages have no way to leave it
  except manual/emulator inspection.
```

Also find the paragraph about `/broadcast`, `/leaderboard`, `/whisper` and the Discord token (search for `Something Discord-related`):

```
- **Something Discord-related — unconfirmed, not just unbuilt.** `.env`
  carries a `DISCORD_TOKEN` that no code in this repository reads.
  Presumably a bot that broadcasts game events; the unimplemented
  `/broadcast`, `/leaderboard`, and `/whisper` commands are the likely
  intended integration point, but this is inference from a stray env var,
  not a documented design.
```

Replace with:

```
- **Something Discord-related — unconfirmed, still unbuilt.** `.env`
  carries a `DISCORD_TOKEN` that no code in this repository reads. This was
  previously guessed to be the real integration point for `/broadcast`,
  `/leaderboard`, and `/whisper`, on no more evidence than the stray env
  var — those three commands are now implemented and target the
  `playerMessages` collection / a future mobile app instead
  (docs/superpowers/specs/2026-08-06-player-messaging-mobile-prep-design.md).
  The Discord token itself remains unread by any code here, its purpose
  still unconfirmed.
```

- [ ] **Step 4: Format**

Run: `npm run format`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add docs/commands.md docs/data-model.md docs/architecture.md
git commit -m "Docs: document /whisper, /broadcast, /leaderboard and playerMessages"
```

---

### Task 8: Final validation gate

**Files:** None modified — verification only.

- [ ] **Step 1: Full gate**

Run in order:

```bash
npm run format
npm run format:check
npm run lint
npm test -- --watchAll=false
npm run test:rules
CI=true npm run build
```

Expected: every command exits 0. `npm run test:rules` needs the Firestore emulator, which `test:rules` starts itself via `firebase emulators:exec` — no manual emulator setup needed.

- [ ] **Step 2: Optional — verify live against the running app**

If a dev server + emulators are available (`npm run firebase:emulate` in one terminal, `npm start` in another), sign up, host a room, add a player, and manually run `/whisper <player> hello`, `/broadcast hi everyone`, and `/leaderboard send` in the chat bar. Confirm each produces the expected chat log line and no console errors. Check the Firestore emulator UI (`localhost:4000`) to confirm each write landed in `rooms/{roomID}/playerMessages` with the expected shape. This step has caught real bugs earlier in this project (a modal-focus race, a stale-suggestion bug) that the test suite alone missed — worth doing if the environment is available, but not blocking if it isn't.

- [ ] **Step 3: Update `improvements.md` if relevant**

Check `docs/improvements.md` for any existing item referencing `/whisper`/`/broadcast`/`/leaderboard` as unimplemented (searched during planning — none found; these commands were only ever discussed in `docs/commands.md`'s "declared but not implemented" table and in passing in a few other items' prose, not as their own numbered backlog entry). If a search at execution time turns up a numbered item this work resolves, mark it `✅ Resolved` with a short summary pointing at the spec, following this file's existing convention. If none exists, skip this step — do not invent a new backlog entry for work that's already complete.

- [ ] **Step 4: Final commit (if Step 3 produced changes)**

```bash
git add docs/improvements.md
git commit -m "Docs: note player-messaging resolution in improvements.md"
```
