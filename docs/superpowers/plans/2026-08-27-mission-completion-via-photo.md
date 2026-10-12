# Mission Completion via Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GM approve a submitted photo as evidence of a mission completion from the same dropdown they already use to approve kills, instead of typing `/mission done` in chat.

**Architecture:** Extract the mission-completion logic that currently lives entirely inside `ChatInput.js`'s `/mission done` handler into one pure decision function plus one shared orchestration function, then call that shared function from both `ChatInput.js` (unchanged behavior, refactored implementation) and a new branch inside `PhotosDisplay.js`'s photo-approval flow (new behavior).

**Tech Stack:** React (CRA), Firebase client SDK (Firestore), Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md`

## Global Constraints

- Every task's correctness gate is the standard four-step gate from this repo's CLAUDE.md: `npm run format`, `npm run lint` (already runs with `--max-warnings=0`), `npm test`, `npm run build`. Run the full gate, not just the touched test file, before a task is considered done — this session has repeatedly found full-suite-only regressions that isolated test runs missed.
- Task 5 additionally requires `npm run test:emulator` to pass — it is the only task touching a Cloud Function (`functions/callableFunctions/submitKillPhoto.js`). `npm run test:emulator` re-runs `functions/scripts/sync-shared-game-logic.js` automatically as a pretest step; run it again manually if you change anything under `functions/` outside that command.
- `src/game/missionCompletion.js` must be pure: no Firebase imports, no React imports, no `Math.random()`. Use CommonJS `module.exports`, matching `src/game/missionEdit.js` and `src/game/remapPlan.js`'s convention in this directory.
- `src/components/completeMission.js` throws on any invalid attempt or write failure — it must never catch its own errors, matching `src/components/executeKill.js`'s convention. Each caller (`ChatInput.js`, `PhotosDisplay.js`) keeps its own existing `try`/`catch` and alert style.
- Never import `dbCalls.js` or `utils/firebase.js` from a `.test.js` file under `src/game/` — `src/utils/firebaseEnv.js` throws under `NODE_ENV=test` unless emulators are enabled.

---

### Task 1: `src/game/missionCompletion.js` — pure decision logic

**Files:**

- Create: `src/game/missionCompletion.js`
- Create: `src/game/missionCompletion.test.js`

**Interfaces:**

- Produces: `planMissionCompletion(task, playerName, { isPlayerDead })` → `{ error: string } | { awardsPoints: number | null, revivesPlayer: boolean, autoEnds: boolean }`. `task` shape: `{ taskIndex, title, taskType, pointValue, isComplete, completedBy: string[], maxCompletions }`.
- Produces: `openMissionsForPlayer(missions, playerName)` → filtered array, same shape/order as `missions`, minus any mission with `isComplete: true` or where `playerName` is already in `completedBy`.
- Both are consumed by Task 2's `src/components/completeMission.js` and Task 4's `PhotosDisplay.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/game/missionCompletion.test.js`:

```js
const { planMissionCompletion, openMissionsForPlayer } = require('./missionCompletion');

describe('planMissionCompletion', () => {
    const baseTask = {
        taskIndex: 1,
        title: 'Find the clue',
        taskType: 'Task',
        pointValue: '10',
        isComplete: false,
        completedBy: [],
        maxCompletions: null,
    };

    it('returns an error for a missing task', () => {
        expect(planMissionCompletion(null, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Invalid task index',
        });
    });

    it('returns an error when the mission has already ended', () => {
        const task = { ...baseTask, isComplete: true };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Mission 1 has already ended',
        });
    });

    it('returns an error when this player already completed the mission', () => {
        const task = { ...baseTask, completedBy: ['alice'] };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Player alice has already completed the mission',
        });
    });

    it('returns an error for a Revival Mission attempted by a player who is not dead', () => {
        const task = { ...baseTask, taskType: 'Revival Mission', pointValue: '0' };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false })).toEqual({
            error: 'Player alice is not dead',
        });
    });

    it('returns a plan awarding points for a Task, with revivesPlayer false', () => {
        expect(planMissionCompletion(baseTask, 'alice', { isPlayerDead: false })).toEqual({
            awardsPoints: 10,
            revivesPlayer: false,
            autoEnds: false,
        });
    });

    it('returns a plan reviving the player for a Revival Mission, with awardsPoints null', () => {
        const task = { ...baseTask, taskType: 'Revival Mission', pointValue: '0' };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: true })).toEqual({
            awardsPoints: null,
            revivesPlayer: true,
            autoEnds: false,
        });
    });

    it('sets autoEnds true once this completion meets maxCompletions', () => {
        const task = { ...baseTask, completedBy: ['bob'], maxCompletions: 2 };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false }).autoEnds).toBe(true);
    });

    it('sets autoEnds false when this completion falls short of maxCompletions', () => {
        const task = { ...baseTask, completedBy: [], maxCompletions: 2 };

        expect(planMissionCompletion(task, 'alice', { isPlayerDead: false }).autoEnds).toBe(false);
    });

    it('sets autoEnds false when maxCompletions is unset', () => {
        expect(planMissionCompletion(baseTask, 'alice', { isPlayerDead: false }).autoEnds).toBe(
            false
        );
    });
});

describe('openMissionsForPlayer', () => {
    const missions = [
        { taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] },
        { taskIndex: 2, title: 'Ended mission', isComplete: true, completedBy: ['bob'] },
        { taskIndex: 3, title: 'Already done by alice', isComplete: false, completedBy: ['alice'] },
    ];

    it('excludes a mission that has already ended', () => {
        expect(openMissionsForPlayer(missions, 'carol').map((m) => m.taskIndex)).not.toContain(2);
    });

    it('excludes a mission this player has already completed', () => {
        expect(openMissionsForPlayer(missions, 'alice').map((m) => m.taskIndex)).not.toContain(3);
    });

    it('includes everything else, in the given order', () => {
        expect(openMissionsForPlayer(missions, 'carol').map((m) => m.taskIndex)).toEqual([1]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/game/missionCompletion.test.js`
Expected: FAIL with "Cannot find module './missionCompletion'"

- [ ] **Step 3: Write the implementation**

Create `src/game/missionCompletion.js`. First read `src/game/missionEdit.js` in full to copy its file-header doc-comment style exactly (CommonJS `require`/`module.exports`, a top-of-file `/** ... */` block describing the module's purpose).

```js
/**
 * Decides what a mission completion should do, without performing any of
 * it — matches src/game/missionEdit.js's decide-then-write shape
 * (CLAUDE.md's "Separate deciding from writing"). Shared by
 * ChatInput.js's /mission done command and PhotosDisplay.js's
 * photo-approval flow (src/components/completeMission.js is the I/O
 * shell that calls this and performs the actual writes), so the two
 * paths can never quietly diverge.
 */

/**
 * Returns { error } when the attempt is invalid — a bad index, a mission
 * that has already ended, a player who already completed it, or a
 * Revival Mission attempted by a player who is not dead — checked in
 * that order, before anything is ever written, so an invalid attempt
 * never partially lands. Otherwise returns a plan: `awardsPoints` is the
 * point value to add (a Task's own pointValue, parsed to a number) or
 * null (a Revival Mission never awards points); `revivesPlayer` is true
 * only for a Revival Mission; `autoEnds` is true once this completion
 * would meet or exceed the mission's own optional maxCompletions cap.
 */
const planMissionCompletion = (task, playerName, { isPlayerDead }) => {
    if (!task) return { error: 'Invalid task index' };
    if (task.isComplete) return { error: `Mission ${task.taskIndex} has already ended` };
    if (task.completedBy.includes(playerName)) {
        return { error: `Player ${playerName} has already completed the mission` };
    }
    if (task.taskType === 'Revival Mission' && !isPlayerDead) {
        return { error: `Player ${playerName} is not dead` };
    }

    const completedCount = task.completedBy.length + 1;
    return {
        awardsPoints: task.taskType === 'Task' ? parseInt(task.pointValue) : null,
        revivesPlayer: task.taskType === 'Revival Mission',
        autoEnds: Boolean(task.maxCompletions) && completedCount >= task.maxCompletions,
    };
};

/**
 * Which of `missions` a given player could still complete: not already
 * ended, and not already completed by this player. Feeds the
 * photo-approval dropdown's mission options directly — a mission that
 * would obviously fail planMissionCompletion is never offered as an
 * option in the first place.
 */
const openMissionsForPlayer = (missions, playerName) =>
    missions.filter((mission) => !mission.isComplete && !mission.completedBy.includes(playerName));

module.exports = { planMissionCompletion, openMissionsForPlayer };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/game/missionCompletion.test.js`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean. (`MessageComposer.test.jsx` may fail under full-suite parallel load — this is a known pre-existing flake, confirmed unrelated by running it in isolation: `npx jest src/components/player_messages_components/MessageComposer.test.jsx`. If any _other_ test fails, stop and investigate before continuing.)

- [ ] **Step 6: Commit**

```bash
git add src/game/missionCompletion.js src/game/missionCompletion.test.js
git commit -m "Add pure mission-completion decision logic"
```

---

### Task 2: `src/components/completeMission.js` — shared orchestration

**Files:**

- Create: `src/components/completeMission.js`

**Interfaces:**

- Consumes: `planMissionCompletion` from `../game/missionCompletion` (Task 1). Consumes these existing `src/components/firebase_calls/dbCalls.js` exports (verify each signature by reading that file before writing this task — line numbers below are current as of this plan but may drift): `fetchTaskByIndexForRoom(index, roomID)` (dbCalls.js:111), `fetchPlayersByStatusForRoom(isAlive, roomID)` (dbCalls.js:45), `fetchReferenceByIndexForTask(index, roomID)` (dbCalls.js:280, throws `Error('Task not found')` if missing), `addPlayerToCompletedByForTask(taskDocRef, player)` (dbCalls.js:157), `addPlayerMessageForRoom(message, roomID)` (dbCalls.js:85), `updatePointsForPlayer(player, points, roomID)` (dbCalls.js:123), `updateIsAliveForPlayer(player, isAlive, roomID)` (dbCalls.js:135), `fetchAliveRosterForRoom(roomID)` (dbCalls.js:309, returns `[{name, targets, assassins}]`), `updateIsCompleteToTrueForTaskByIndex(index, roomID)` (dbCalls.js:147). Consumes `normalizePlayerName`/`resolvePlayerDisplayName` from `../game/playerNames`, and `playersNeedingConnections` from `../game/targetGraph`.
- Produces: a factory `CompleteMission(handlers)` — `handlers` is `{ addLog, handleTargetRegeneration, handleAddNewAssassins, handleAddNewTargets, handleSetShowMessageToTrue, handlePlayerRevive }` — returning an async function `(playerName, missionIndex, roomID, players) => Promise<void>` that throws on any invalid attempt or write failure. This is the interface Tasks 3 and 4 both consume. Matches `src/components/RemapPlayers.js`'s exact factory-function shape (`RemapPlayers(handleRemapping, createAlert)` returns `handleRegeneration` — read that file fresh for the pattern before writing this one).

No dedicated test file for this task — `src/components/RemapPlayers.js` has none either (confirmed via `find src/components -iname "RemapPlayers*"`, only the `.js` file exists), because a `.test.js` file outside `src/game/`/`src/utils/`/`functions/` does not match any project's `testMatch` glob in `jest.config.js`, and this isn't a React component so `.test.jsx` doesn't fit either. This function is covered indirectly through Task 3's and Task 4's caller-level tests. Do not create a test file for it.

- [ ] **Step 1: Write the implementation**

Read `src/components/executeKill.js` and `src/components/RemapPlayers.js` in full first, to match the throw-don't-catch convention and the factory-function shape respectively.

Create `src/components/completeMission.js`:

```js
import {
    addPlayerMessageForRoom,
    addPlayerToCompletedByForTask,
    fetchAliveRosterForRoom,
    fetchPlayersByStatusForRoom,
    fetchReferenceByIndexForTask,
    fetchTaskByIndexForRoom,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from './firebase_calls/dbCalls';
import { normalizePlayerName, resolvePlayerDisplayName } from '../game/playerNames';
import { playersNeedingConnections } from '../game/targetGraph';
import { planMissionCompletion } from '../game/missionCompletion';

/**
 * The I/O shell around src/game/missionCompletion.js's planMissionCompletion
 * — matches src/components/RemapPlayers.js's shape (a function of the
 * caller's handlers, returning the actual worker function). Shared by
 * ChatInput.js's /mission done command and PhotosDisplay.js's
 * photo-approval flow, so completing a mission behaves identically no
 * matter which way it was approved
 * (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
 *
 * Throws on any invalid attempt (bad index, ended mission, already
 * completed, Revival Mission attempted by a player who is not dead) or
 * on any write failure — never catches its own errors, matching
 * src/components/executeKill.js's convention. Each caller keeps its own
 * try/catch and alert style.
 */
const CompleteMission = (handlers) => {
    const {
        addLog,
        handleTargetRegeneration,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
        handlePlayerRevive,
    } = handlers;

    return async (playerName, missionIndex, roomID, players) => {
        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);

        let isPlayerDead = false;
        if (task && task.taskType === 'Revival Mission') {
            const deadPlayers = (await fetchPlayersByStatusForRoom(false, roomID)).map(
                normalizePlayerName
            );
            isPlayerDead = deadPlayers.includes(playerName);
        }

        const plan = planMissionCompletion(task, playerName, { isPlayerDead });
        if (plan.error) throw new Error(plan.error);

        const taskDocRef = await fetchReferenceByIndexForTask(missionIndex, roomID);
        const displayName = resolvePlayerDisplayName(playerName, players);

        await addPlayerToCompletedByForTask(taskDocRef, playerName);
        await addLog(`${displayName} completed mission: ${task.title}`, 'green.400');
        await addPlayerMessageForRoom(
            {
                type: 'broadcast',
                recipient: null,
                text: `${displayName} completed mission: ${task.title}`,
                standings: null,
            },
            roomID
        );

        if (plan.awardsPoints !== null) {
            await updatePointsForPlayer(playerName, plan.awardsPoints, roomID);
        }

        if (plan.revivesPlayer) {
            await updateIsAliveForPlayer(playerName, true, roomID);
            handlePlayerRevive(displayName);
            const roster = await fetchAliveRosterForRoom(roomID);
            const { needTargets, needAssassins } = playersNeedingConnections(roster);
            const [targets, assassins] = await handleTargetRegeneration(
                needTargets,
                needAssassins,
                roster.map((player) => player.name),
                roomID
            );
            handleAddNewAssassins(assassins);
            handleAddNewTargets(targets);
            handleSetShowMessageToTrue();
        }

        if (plan.autoEnds) {
            await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
            await addLog(
                `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
                'purple.400'
            );
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: `Mission ${task.title} has been completed!`,
                    standings: null,
                },
                roomID
            );
        }
    };
};

export default CompleteMission;
```

Confirm `playersNeedingConnections` is exported from `src/game/targetGraph.js` under that exact name before writing the import (read that file's exports if unsure).

- [ ] **Step 2: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean (no new tests exist yet to exercise this file directly — this step just confirms it compiles and lints cleanly, and that nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add src/components/completeMission.js
git commit -m "Add shared mission-completion orchestration function"
```

---

### Task 3: Refactor `ChatInput.js`'s `/mission done` to use `completeMission`

**Files:**

- Modify: `src/components/logs_components/ChatInput.js`
- Modify: `src/components/logs_components/ChatInput.test.jsx`

**Interfaces:**

- Consumes: `CompleteMission` from `../completeMission` (Task 2).

- [ ] **Step 1: Read the current `/mission done` block fresh**

Read `src/components/logs_components/ChatInput.js` in full. Find `case 'done':` inside the `case '/mission':` switch (currently starts around line 156). Note that `addLog`, `handlePlayerRevive`, `handleAddNewAssassins`, `handleAddNewTargets`, `handleSetShowMessageToTrue` are already destructured from `xecutionContext` near the top of `handleCommandExecution` (around line 72-85), and `handleTargetRegeneration` is already constructed via `const handleTargetRegeneration = RemapPlayers(handleRemapping, createAlert);` near the top of the function body (around line 95) — all already in scope for the `case 'done':` block, so no new destructuring or context plumbing is needed in this file.

- [ ] **Step 2: Write a new failing test for the bug fix**

Open `src/components/logs_components/ChatInput.test.jsx`. Find the existing `describe('/mission done (bug report: ended missions, missing chat log, completion cap)', ...)` block and its nested `describe('Revival Mission', ...)` block. Add this test inside the outer `/mission done` describe block (not the nested Revival Mission one, since it needs its own task/mock setup distinct from that block's `revivalTask`):

```js
it('rejects completing a Revival Mission for a player who is not dead, without recording the completion (bug fix)', async () => {
    dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({
        title: 'Revive a fallen ally',
        taskType: 'Revival Mission',
        pointValue: '0',
        completedBy: [],
        isComplete: false,
        maxCompletions: 1,
    });
    dbCalls.fetchPlayersByStatusForRoom.mockResolvedValue([]); // nobody is dead

    const commandInput = mountChatInput();
    typeAndSubmit(commandInput, '/mission done bob 1');

    expect(await screen.findByText(/bob is not dead/i)).toBeInTheDocument();
    expect(dbCalls.addPlayerToCompletedByForTask).not.toHaveBeenCalled();
    expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).not.toHaveBeenCalled();
});
```

Read the existing mock setup at the top of `ChatInput.test.jsx` first to confirm `dbCalls.fetchPlayersByStatusForRoom` and `dbCalls.addPlayerToCompletedByForTask` are already in the `jest.mock('../firebase_calls/dbCalls', ...)` factory (they should be, since the existing Revival Mission tests already use `fetchPlayersByStatusForRoom`) — add them to the factory if either is missing, and add `mockResolvedValue`/default behavior to the shared `beforeEach` if not already present, matching this file's existing style.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/components/logs_components/ChatInput.test.jsx -t "rejects completing a Revival Mission for a player who is not dead"`
Expected: FAIL — today's code shows the "is not dead" alert but still calls `addPlayerToCompletedByForTask`, so the `not.toHaveBeenCalled()` assertion fails.

- [ ] **Step 4: Replace the `/mission done` block's body**

In `ChatInput.js`, replace the entire body of `case 'done':` (from `playerName = args[1] ? normalizePlayerName(args[1]) : '';` through its closing `break;`) with:

```js
case 'done':
    playerName = args[1] ? normalizePlayerName(args[1]) : '';
    missionIndex = args[2] ? Number(args[2]) : -1;
    if (missionIndex === -1) {
        createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
        console.error(`${args[2]} is not a valid index`);
        break;
    }

    if (arrayOfPlayerNames.includes(playerName)) {
        const completeMission = CompleteMission({
            addLog,
            handleTargetRegeneration,
            handleAddNewAssassins,
            handleAddNewTargets,
            handleSetShowMessageToTrue,
            handlePlayerRevive,
        });
        await completeMission(playerName, missionIndex, roomID, players);
    } else {
        createAlert('error', 'Error', `Player ${args[1]} is invalid`, 1500);
        console.error(`Player ${args[1]} is invalid.`);
    }
    break;
```

Add `import CompleteMission from '../completeMission';` near the top of `ChatInput.js`, alongside the existing `import RemapPlayers from '../RemapPlayers';`. A thrown error from `completeMission` (invalid index, ended mission, already completed, not-dead-for-revival, or any write failure) now surfaces through the file's existing outer `try`/`catch` (around line 507) as `` `${commandLine} failed: ${error.message}` `` — this is a small, accepted wording change from today's dedicated `createAlert('error', 'Error', '<message>', 1500)` calls for this one sub-command, matching every other command's unexpected-failure path.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx jest src/components/logs_components/ChatInput.test.jsx -t "rejects completing a Revival Mission for a player who is not dead"`
Expected: PASS.

- [ ] **Step 6: Run the full `/mission done` describe block and fix any wording-dependent assertions**

Run: `npx jest src/components/logs_components/ChatInput.test.jsx -t "mission done"`

Every existing test in the `/mission done` describe block (including the nested `Revival Mission` one) must still pass. If any test asserts on the exact alert text for an error case (e.g. `screen.findByText(/mission 1 has already ended/i)`), it should still pass unchanged, since `completeMission` throws the identical message strings `planMissionCompletion` returns — the only wording change is the outer wrapper (`/mission done ... failed: <message>` instead of a bare `<message>`), which these existing tests already match with `.toBeInTheDocument()` on a substring regex, not an exact string — confirm this is actually true by running the tests, and adjust any assertion that turns out to require an exact match rather than a substring match.

- [ ] **Step 7: Run the full ChatInput.test.jsx suite**

Run: `npx jest src/components/logs_components/ChatInput.test.jsx`
Expected: PASS, every test in the file (this file also covers `/kill`, `/openseason`, `/revive`, `/whisper`, `/broadcast`, `/leaderboard`, tab completion, and more — none of those are touched by this task, so they must be unaffected).

- [ ] **Step 8: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean (aside from the known pre-existing `MessageComposer.test.jsx` full-suite flake noted in Task 1).

- [ ] **Step 9: Commit**

```bash
git add src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx
git commit -m "Refactor /mission done to use the shared completeMission function"
```

---

### Task 4: `PhotosDisplay.js` — combined dropdown, mission approval, generic deny, Undo guard

**Files:**

- Modify: `src/components/photos_display_component/PhotosDisplay.js`
- Modify: `src/components/photos_display_component/PhotosDisplay.test.jsx`
- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/game/photoJudgments.js`
- Modify: `src/game/photoJudgments.test.js`

**Interfaces:**

- Consumes: `CompleteMission` from `../completeMission` (Task 2), `openMissionsForPlayer` from `../../game/missionCompletion` (Task 1).
- Produces: `dbCalls.approvePhotoAsMissionForRoom(roomID, photoID, missionIndex)` — no other task consumes this directly, but it is part of this repo's shared `dbCalls.js` surface going forward.

- [ ] **Step 1: Read the current files fresh**

Read `src/components/photos_display_component/PhotosDisplay.js`, `src/components/photos_display_component/PhotosDisplay.test.jsx`, `src/game/photoJudgments.js`, and `src/components/task_components/TaskList.js` in full before making any change — this task touches several files and their exact current line numbers matter.

- [ ] **Step 2: Add `approvePhotoAsMissionForRoom` to `dbCalls.js`**

In `src/components/firebase_calls/dbCalls.js`, add this function directly after the existing `approvePhotoForRoom` function:

```js
// Approves a photo as evidence of a mission completion instead of a kill —
// the sibling of approvePhotoForRoom for the mission branch of
// PhotosDisplay.js's dropdown
// (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
// Persists which mission the photo was approved as, mirroring how
// approvePhotoForRoom persists the resolved `target`.
export const approvePhotoAsMissionForRoom = async (roomID, photoID, missionIndex) => {
    const photoRef = doc(db, 'rooms', roomID, 'photos', photoID);
    await updateDoc(photoRef, { status: 'approved', mission: missionIndex });
};
```

- [ ] **Step 3: Update `photoJudgments.js`'s action derivation and its JSDoc**

In `src/game/photoJudgments.js`, update the function's JSDoc `action` union from `'pass'|'deny'` to `'pass'|'missionPass'|'deny'`, and change the `judged` mapping's `action` line from:

```js
action: photo.status === 'approved' ? 'pass' : 'deny',
```

to:

```js
action:
    photo.status === 'denied' ? 'deny' : photo.mission != null ? 'missionPass' : 'pass',
```

- [ ] **Step 4: Write the failing test for the new `action` value**

Add to `src/game/photoJudgments.test.js`, inside the existing `describe('splitPhotosByStatus', ...)` block, right after the existing `'maps an approved photo to action "pass"'` test:

```js
it('maps an approved photo with a resolved mission to action "missionPass"', () => {
    const photo = { id: '1', status: 'approved', mission: 2, originalPlayerData: null };

    const { judged } = splitPhotosByStatus([photo]);

    expect(judged).toEqual([{ photo, action: 'missionPass', originalPlayerData: null }]);
});
```

- [ ] **Step 5: Run the new test to verify it fails, then passes**

Run: `npx jest src/game/photoJudgments.test.js`
Expected before Step 3's edit: FAIL (`action` would be `'pass'`, not `'missionPass'`). After Step 3's edit: PASS, all 6 tests (5 existing + 1 new). If you completed Step 3 before writing/running this test, verify by temporarily reverting Step 3's edit, confirming the failure, then reapplying it — do not skip seeing the red state.

- [ ] **Step 6: Add the mission subscription and combined dropdown to `PhotosDisplay.js`**

Add to the imports at the top of `PhotosDisplay.js`:

```js
import CompleteMission from '../completeMission';
import RemapPlayers from '../RemapPlayers';
import { openMissionsForPlayer } from '../../game/missionCompletion';
import { fetchTasksQueryForRoom } from '../firebase_calls/dbCalls';
```

(add `fetchTasksQueryForRoom` to the existing `dbCalls` import line rather than a second import statement)

Add a new state variable near the existing `unjudgedPhotos`/`judgedPhotos` state:

```js
const [missions, setMissions] = useState([]);
```

Add a second `onSnapshot` subscription, alongside the existing photos one, mapping snapshot docs directly (matching this file's own existing photos-subscription style, not `TaskList.js`'s fetch-triggered-by-snapshot style — this file only needs the flat list, not an active/completed split):

```js
useEffect(() => {
    const missionsQuery = fetchTasksQueryForRoom(roomID);
    const unsubscribe = onSnapshot(
        missionsQuery,
        (snapshot) => {
            setMissions(snapshot.docs.map((doc) => doc.data()));
        },
        (error) => {
            console.error('Error fetching missions: ', error);
        }
    );

    return () => unsubscribe();
}, [roomID]);
```

Rename the existing `selectedTarget`/`setSelectedTarget` state to `selectedOption`/`setSelectedOption` throughout the file (including the `useEffect` that resets it on `currentPhoto?.id` change), and rename `effectiveTarget` to `effectiveSelection`. Replace the `currentAssassinTargets`/`effectiveTarget` derivation block with:

```js
const currentAssassinTargets = currentPhoto
    ? (players.find(
          (player) =>
              normalizePlayerName(player.name) === normalizePlayerName(currentPhoto.assassin)
      )?.targets ?? [])
    : [];
const currentOpenMissions = currentPhoto
    ? openMissionsForPlayer(missions, currentPhoto.assassin)
    : [];

const combinedOptions = [
    ...currentAssassinTargets.map((target) => ({ value: `target:${target}`, label: target })),
    ...currentOpenMissions.map((mission) => ({
        value: `mission:${mission.taskIndex}`,
        label: mission.title,
    })),
];

const effectiveSelection =
    combinedOptions.length === 1
        ? combinedOptions[0].value
        : combinedOptions.some((option) => option.value === selectedOption)
          ? selectedOption
          : '';
```

Replace the dropdown JSX block (`{currentPhoto && (<Box sx={styles.targetPickerBox}>...`) with:

```jsx
{
    currentPhoto && (
        <Box sx={styles.targetPickerBox}>
            <Text mb={1}>Submitted by {currentPhoto.assassin}</Text>
            {combinedOptions.length > 1 ? (
                <Select
                    aria-label="Select target or mission"
                    placeholder="Choose target or mission"
                    value={effectiveSelection}
                    onChange={(event) => setSelectedOption(event.target.value)}
                >
                    {currentAssassinTargets.length > 0 && (
                        <optgroup label="Kill Target">
                            {currentAssassinTargets.map((target) => (
                                <option key={`target:${target}`} value={`target:${target}`}>
                                    {target}
                                </option>
                            ))}
                        </optgroup>
                    )}
                    {currentOpenMissions.length > 0 && (
                        <optgroup label="Mission">
                            {currentOpenMissions.map((mission) => (
                                <option
                                    key={`mission:${mission.taskIndex}`}
                                    value={`mission:${mission.taskIndex}`}
                                >
                                    {mission.title}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </Select>
            ) : (
                effectiveSelection &&
                (effectiveSelection.startsWith('mission:') ? (
                    <Text>Mission: {currentOpenMissions[0]?.title}</Text>
                ) : (
                    <Text>Target: {currentAssassinTargets[0]}</Text>
                ))
            )}
        </Box>
    );
}
```

Update the Approve button's `opacity`/`cursor`/enabled condition from `effectiveTarget` to `effectiveSelection`.

- [ ] **Step 7: Update `handlePass` to branch on the selection prefix**

Replace `handlePass`'s body (keep its name — it is not exported/referenced by name outside this file) with:

```js
const handlePass = async () => {
    if (visibleUnjudgedPhotos.length === 0) return;
    if (!effectiveSelection) return;
    const [approvingPhoto] = visibleUnjudgedPhotos;
    setOptimisticallyJudgedIds((previous) => [...previous, approvingPhoto.id]);
    setSelectedOption('');

    try {
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
        } else {
            const target = effectiveSelection.slice('target:'.length);
            const { preKillSnapshot, addedTargets, addedAssassins, remapLogs } = await executeKill(
                target,
                approvingPhoto.assassin,
                roomID
            );

            await approvePhotoForRoom(roomID, approvingPhoto.id, target, preKillSnapshot);
            await addLog(`${target} was killed by ${approvingPhoto.assassin}`, 'red.400');
            await addPlayerMessageForRoom(
                {
                    type: 'killResult',
                    recipient: null,
                    text: `${target} was killed by ${approvingPhoto.assassin}`,
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: approvingPhoto.assassin,
                    target,
                    outcome: 'approved',
                },
                roomID
            );

            for (const log of remapLogs) {
                await handleRemapping(log);
            }
            handleAddNewAssassins(addedAssassins);
            handleAddNewTargets(addedTargets);
            handleSetShowMessageToTrue();
        }
    } catch (error) {
        console.error('Error approving photo: ', error);
        setOptimisticallyJudgedIds((previous) => previous.filter((id) => id !== approvingPhoto.id));
        createAlert('error', 'Error approving photo', error.message, 1500);
    }
};
```

Import `approvePhotoAsMissionForRoom` alongside the other `dbCalls` imports at the top of the file. Add `handlePlayerRevive` to this component's existing `useContext(executionContext)` destructuring line (it already destructures `addLog, handleRemapping, handleAddNewAssassins, handleAddNewTargets, handleSetShowMessageToTrue` — add `handlePlayerRevive` to that same list; it is already provided by `GameMasterView.js`'s `executionContextProviderValues`, the same object this component already reads from, so no changes are needed outside this file for it to be available).

- [ ] **Step 8: Update `handleDeny`'s wording**

In `handleDeny`, change both the `addLog` call and the `addPlayerMessageForRoom` call's `text` field from `` `${denyingPhoto.assassin}'s kill attempt was denied` `` to `` `${denyingPhoto.assassin}'s photo submission was denied` ``.

- [ ] **Step 9: Add the Undo guard for mission approvals**

In `handleUndo`, immediately after `const { photo, action } = last;` and before the existing `if (action === 'pass')` block, add:

```js
if (action === 'missionPass') {
    createAlert('info', 'Not Supported', "Undo isn't available for mission completions yet.", 1500);
    return;
}
```

- [ ] **Step 10: Update existing tests broken by the aria-label rename**

The rename from `"Select target"` to `"Select target or mission"` (Step 6) breaks every existing query for the old label. In `PhotosDisplay.test.jsx`, update every `screen.getByLabelText('Select target')` / `screen.queryByLabelText('Select target')` call to `'Select target or mission'` — these appear in the `describe('moderator resolves the target (players no longer pick who they killed)', ...)` block's tests: `'shows no dropdown...'`, `'shows a dropdown listing the assassin's targets...'`, `'uses the picked target for executeKill...'`, `'does nothing when Approve is clicked...'`, `'resets the picked target...'`, `'Deny does not require a target...'`. Also update the two existing tests asserting on `"bob's kill attempt was denied"` text (in `describe('kill outcomes are announced in the room chat', ...)`, the `'posts a killResult chat message when a photo is denied'` test, and the top-of-file `mountWithSnapshot` default players' assassin `bob`) to expect `"bob's photo submission was denied"` instead.

- [ ] **Step 11: Update the mock setup for the new mission subscription and dbCalls export**

`PhotosDisplay.test.jsx` mocks `firebase/firestore`'s `onSnapshot` with a single implementation that captures one `deliverUpdate` callback — this component now calls `onSnapshot` twice (photos, and the new missions subscription). Update `onSnapshot.mockImplementation` (inside `mountWithSnapshot`) to branch on which query it was called with, or track both callbacks separately. One approach: give `mountWithSnapshot` a new optional third parameter `missions = []`, and make the mock deliver an empty/given mission list immediately for any call whose query isn't the photos query:

```js
const mountWithSnapshot = (photoDocs, players = defaultPlayers, missions = []) => {
    let deliverPhotoUpdate;
    onSnapshot.mockImplementation((query, onNext) => {
        if (query === 'photos-query') {
            deliverPhotoUpdate = onNext;
            onNext({
                docs: photoDocs.map((data, i) => ({ id: `photo-${i}`, data: () => data })),
            });
        } else {
            onNext({ docs: missions.map((data) => ({ data: () => data })) });
        }
        return () => {};
    });
    // ... rest unchanged, using deliverPhotoUpdate instead of deliverUpdate
```

This requires `dbCalls.fetchPhotosQueryByAscendingTimestampForRoom` to keep returning the literal string `'photos-query'` (confirm it already does — check the existing `jest.mock('../firebase_calls/dbCalls', ...)` factory) and requires adding `fetchTasksQueryForRoom: jest.fn(() => 'missions-query')` and `approvePhotoAsMissionForRoom: jest.fn()` to that same mock factory, plus `dbCalls.approvePhotoAsMissionForRoom.mockResolvedValue(undefined);` to the `beforeEach`. Every existing call site of `mountWithSnapshot(...)` that doesn't pass a third argument continues to work unchanged (missions defaults to `[]`, so `combinedOptions` behaves exactly as `currentAssassinTargets` did before this task for every pre-existing test).

- [ ] **Step 12: Write the new mission-approval tests**

Add a new `describe` block to `PhotosDisplay.test.jsx`:

```js
describe('approving a photo as a mission completion', () => {
    it('lists open missions grouped separately from kill targets, excluding ended or already-completed ones', async () => {
        mountWithSnapshot(
            [{ status: 'pending', target: null, assassin: 'bob' }],
            [{ name: 'bob', targets: ['alice', 'carol'] }],
            [
                { taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] },
                { taskIndex: 2, title: 'Ended mission', isComplete: true, completedBy: [] },
                { taskIndex: 3, title: 'Already done', isComplete: false, completedBy: ['bob'] },
            ]
        );

        expect(screen.getByRole('option', { name: 'Find the clue' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Ended mission' })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Already done' })).not.toBeInTheDocument();
    });

    it('completes a Task mission and marks the photo approved with the resolved mission index', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({
            title: 'Find the clue',
            taskType: 'Task',
            pointValue: '10',
            completedBy: [],
            isComplete: false,
            maxCompletions: null,
        });
        dbCalls.fetchReferenceByIndexForTask.mockResolvedValue('task-doc-ref');
        mountWithSnapshot(
            [{ status: 'pending', target: null, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(dbCalls.addPlayerToCompletedByForTask).toHaveBeenCalledWith(
                'task-doc-ref',
                'bob'
            )
        );
        expect(dbCalls.updatePointsForPlayer).toHaveBeenCalledWith('bob', 10, 'room-a');
        expect(dbCalls.approvePhotoAsMissionForRoom).toHaveBeenCalledWith('room-a', 'photo-0', 1);
    });

    it('denies a photo with generic wording regardless of category', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Deny'));

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                "bob's photo submission was denied",
                'gray'
            )
        );
    });

    it('shows a not-yet-supported message and performs no write when Undo is clicked on a mission-approved photo', async () => {
        mountWithSnapshot([
            { status: 'approved', mission: 1, assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        expect(
            await screen.findByText(/not available for mission completions/i)
        ).toBeInTheDocument();
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });
});
```

Read the existing `jest.mock('../firebase_calls/dbCalls', ...)` factory first and add `fetchTaskByIndexForRoom`, `fetchReferenceByIndexForTask`, `addPlayerToCompletedByForTask`, `updatePointsForPlayer` to it if not already present (Task 3's `ChatInput.test.jsx` mock factory already has these — mirror the same `jest.fn()` entries here), along with default `beforeEach` resolutions consistent with this file's existing style.

- [ ] **Step 13: Run the tests, fixing anything unexpected**

Run: `npx jest src/components/photos_display_component/PhotosDisplay.test.jsx`
Expected: PASS, every test in the file — both the new ones and every pre-existing one (which must still pass given the renames in Steps 6/10 and the `missions` parameter's default in Step 11).

- [ ] **Step 14: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four clean (aside from the known `MessageComposer.test.jsx` full-suite flake).

- [ ] **Step 15: Commit**

```bash
git add src/components/photos_display_component/PhotosDisplay.js src/components/photos_display_component/PhotosDisplay.test.jsx src/components/firebase_calls/dbCalls.js src/game/photoJudgments.js src/game/photoJudgments.test.js
git commit -m "Let the moderator approve a photo as a mission completion"
```

---

### Task 5: `submitKillPhoto.js`'s new `mission` field, its emulator test, and `docs/data-model.md`

**Files:**

- Modify: `functions/callableFunctions/submitKillPhoto.js`
- Modify: `src/components/submitKillPhoto.integration.test.js`
- Modify: `docs/data-model.md`

**Interfaces:** None — this task is independent of Tasks 1-4 and can run at any point, but should land before or alongside Task 4 in practice since Task 4's tests reference `photo.mission`.

- [ ] **Step 1: Add the field to `submitKillPhoto.js`**

In `functions/callableFunctions/submitKillPhoto.js`, find the `transaction.create(roomRef.collection('photos').doc(), {...})` call and add `mission: null` alongside the existing `target: null`:

```js
transaction.create(roomRef.collection('photos').doc(), {
    url,
    assassin: assassinData.name,
    target: null,
    mission: null,
    timestamp: FieldValue.serverTimestamp(),
    status: 'pending',
    originalPlayerData: null,
});
```

- [ ] **Step 2: Update the emulator test's assertion**

In `src/components/submitKillPhoto.integration.test.js`, find the test `"writes the photo with the caller's own real name as assassin, never a client-supplied one, and no target yet"` and add `mission: null` to its `toMatchObject` assertion:

```js
expect(snapshot.docs[0].data()).toMatchObject({
    assassin: 'alice',
    target: null,
    mission: null,
    url: REALISTIC_URL,
    status: 'pending',
    originalPlayerData: null,
});
```

- [ ] **Step 3: Sync and run the emulator test suite**

```bash
node functions/scripts/sync-shared-game-logic.js
npm run test:emulator
```

Expected: all suites pass, including the updated `submitKillPhoto` test. If it fails, re-check Step 1's exact field placement and re-run — do not proceed until this passes for real against the emulator, not just visually inspected.

- [ ] **Step 4: Update `docs/data-model.md`**

Read the `rooms/{roomID}/photos/{autoId}` field table in `docs/data-model.md` (currently has rows for `url`, `assassin`, `target`, `timestamp`, `status`, `originalPlayerData`, in that order). Add a new row directly after the existing `target` row, matching that row's exact prose style:

```
| `mission`            | `number \| null`                                                                 | `null` at submission and stays `null` forever for a kill approval or a denial — set once, to the mission's `taskIndex`, by `dbCalls.approvePhotoAsMissionForRoom`, when a moderator approves the photo as evidence of a mission completion in `PhotosDisplay.js` rather than a kill (`docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md`).                                                                                                                                                                                                                              |
```

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
git add functions/callableFunctions/submitKillPhoto.js src/components/submitKillPhoto.integration.test.js docs/data-model.md
git commit -m "Record which mission a photo was approved as, when applicable"
```

---

## Final verification

After all 5 tasks are complete:

1. Run the full gate one more time (`npm run format`, `npm run lint`, `npm test`, `npm run build`) and `npm run test:emulator`.
2. Manually re-read `docs/improvements.md` — this feature does not close any existing numbered backlog item, so no entry needs updating there, but confirm nothing in this plan's diff touched a file `docs/improvements.md` references in a way that makes an existing entry stale.
3. Deploy: this plan touches one Cloud Function (`submitKillPhoto`) as well as client code, so the deploy is `firebase deploy --only functions,hosting`, not hosting-only. Verify the live bundle afterward the same way this session has after every prior deploy (fetch `/static/js/main.*.js` from the served HTML, `curl` it, `grep` for a known new string like `"Select target or mission"`, and compare the bundle hash to the local `build/` output) before considering the feature live.
