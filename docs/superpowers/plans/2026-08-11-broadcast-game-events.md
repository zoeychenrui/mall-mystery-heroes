# Broadcast game events to players' chat feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill, revive, open-season start/end, and mission-lifecycle events (created, completed, ended) reach players' chat feed, not just the GM's own console log.

**Architecture:** At 9 existing `addLog(...)` call sites (7 in `src/pages/GameMasterView.js`, 2 in `src/components/logs_components/ChatInput.js`), add a parallel `addPlayerMessageForRoom({ type: 'broadcast', recipient: null, text: <same string>, standings: null }, roomID)` call, reusing the exact text already passed to `addLog`. `GameMasterView.js`'s handlers aren't reachable from `GameMasterView.test.jsx` today (its `ChatInput` stub only reads `gameContext`, not `executionContext`) — Task 1 extends that stub to capture `executionContext` so the handlers can be invoked and asserted on directly. `ChatInput.test.jsx` already covers all `ChatInput.js` call sites this plan touches.

**Tech Stack:** React (CRA), Firebase Firestore client SDK, Jest + React Testing Library (jsdom project).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`).
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js`.
- Write the test first and watch it fail, for every behavioral change.
- Reuse the GM log's exact text verbatim for the player broadcast — no separate player-facing copy (`docs/superpowers/specs/2026-08-11-broadcast-game-events-design.md`, "Decisions made").
- Every new write is `{ type: 'broadcast', recipient: null, standings: null }` — no new `playerMessages` field, no new message type, no `firestore.rules` change.
- No change to what the GM console itself logs, displays, or to `/whisper`/`/broadcast`/`/leaderboard send`'s existing behavior.

---

## Task 1: Test infrastructure — expose `executionContext` in `GameMasterView.test.jsx`, then `handleKillPlayer`

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `addPlayerMessageForRoom` (already exists in `dbCalls.js`, exported for `ChatInput.js`'s `/whisper`/`/broadcast`/`/leaderboard`).
- Produces: a `capturedExecutionContext` test hook in `GameMasterView.test.jsx` (module-scope variable, populated by the `ChatInput` mock on every render), reused by Tasks 2-5 to invoke `handleOpenSznstarted`/`handleOpenSznended`/`handlePlayerRevive`/`handleNewTaskAdded`/`handleTaskCompleted` directly. Also produces the pattern (one `addPlayerMessageForRoom` call per `addLog` call) Tasks 2-5 repeat.

None of `GameMasterView.js`'s handlers (`handleKillPlayer`, `handleOpenSznstarted`, etc.) are reachable from `GameMasterView.test.jsx` today — they're only ever consumed by `ChatInput`/`PhotosDisplay`, both stubbed out in that test file, and the `ChatInput` stub (`GameMasterView.test.jsx:52-59`) currently reads only `gameContext`, not `executionContext`. This task extends that stub once so every later task in this plan can call a handler directly and assert on both `addLogForRoom` and `addPlayerMessageForRoom`.

- [ ] **Step 1: Write the failing test**

In `src/pages/GameMasterView.test.jsx`, make three changes:

First, add `addPlayerMessageForRoom: jest.fn(),` to the existing `jest.mock('../components/firebase_calls/dbCalls', ...)` factory (`GameMasterView.test.jsx:39-46`), so the full block reads:

```js
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom: jest.fn(() => 'players-query'),
    fetchLogsQueryByAscendingTimestampForRoom: jest.fn(() => 'logs-query'),
    fetchRoomReferenceForRoom: jest.fn(() => 'room-ref'),
    addLogForRoom: jest.fn(),
    addPlayerMessageForRoom: jest.fn(),
    updateIsAliveForPlayer: jest.fn(),
    endGame: jest.fn(),
}));
```

Second, replace the `ChatInput` mock (`GameMasterView.test.jsx:52-59`) with a version that also captures `executionContext`:

```js
let capturedExecutionContext;
jest.mock('../components/logs_components/ChatInput', () => {
    const { useContext } = require('react');
    const { gameContext, executionContext } = require('../components/Contexts');
    return () => {
        const { isGameActive } = useContext(gameContext);
        capturedExecutionContext = useContext(executionContext);
        return <div>chat-input-stub isGameActive={String(isGameActive)}</div>;
    };
});
```

Third, add a new import at the top of the file — `import { addLogForRoom, addPlayerMessageForRoom } from '../components/firebase_calls/dbCalls';` — and this new test, in a new `describe` block placed after the existing `describe("isGameActive is read, not just written ...")` block:

```jsx
describe('game events are broadcast to players, not just logged to the GM console', () => {
    it('broadcasts a kill to players with the same text as the GM log', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleKillPlayer('Alice', 'Bob', false);
        });

        expect(addLogForRoom).toHaveBeenCalledWith('Alice was killed by Bob', 'red.400', 'room-a');
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Alice was killed by Bob',
                standings: null,
            },
            'room-a'
        );
    });

    it('broadcasts both the open-season-ended and the kill when a kill happens during open season', async () => {
        mockPlayersSnapshot([]);

        mountGameMasterView();

        await act(async () => {
            await capturedExecutionContext.handleKillPlayer('Alice', 'Bob', true);
        });

        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'open season has ended for Alice',
                standings: null,
            },
            'room-a'
        );
        expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Alice was killed by Bob',
                standings: null,
            },
            'room-a'
        );
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: FAIL — `capturedExecutionContext.handleKillPlayer` throws (`capturedExecutionContext` is `undefined` before the stub is extended) or, once the stub is extended, `addPlayerMessageForRoom` is never called (only `addLogForRoom` is) since `handleKillPlayer` doesn't call it yet.

- [ ] **Step 3: Write minimal implementation**

In `src/pages/GameMasterView.js`, add `addPlayerMessageForRoom` to the existing `dbCalls` import (`GameMasterView.js:12-18`):

```js
import {
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchRoomReferenceForRoom,
    addLogForRoom,
    addPlayerMessageForRoom,
    updateIsAliveForPlayer,
} from '../components/firebase_calls/dbCalls';
```

Replace `handleKillPlayer` (`GameMasterView.js:110-116`):

```js
const handleKillPlayer = async (killedPlayerName, assassinName, openSznstatus) => {
    if (openSznstatus === true) {
        handleOpenSznended(killedPlayerName);
        await addLog('open season has ended for ' + killedPlayerName, 'pink.400');
        await addPlayerMessageForRoom(
            {
                type: 'broadcast',
                recipient: null,
                text: 'open season has ended for ' + killedPlayerName,
                standings: null,
            },
            roomID
        );
    }
    await addLog(killedPlayerName + ' was killed by ' + assassinName, 'red.400');
    await addPlayerMessageForRoom(
        {
            type: 'broadcast',
            recipient: null,
            text: killedPlayerName + ' was killed by ' + assassinName,
            standings: null,
        },
        roomID
    );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: PASS, both new tests, plus every pre-existing `GameMasterView` test still passes (the `ChatInput` stub's added `executionContext` read doesn't change what it renders).

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Broadcast kills to players' chat feed"
```

---

## Task 2: Broadcast open season start/end

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `capturedExecutionContext`, `addLogForRoom`/`addPlayerMessageForRoom` mocks (Task 1).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('game events are broadcast to players, ...')` block in `src/pages/GameMasterView.test.jsx`:

```jsx
it('broadcasts open season starting', async () => {
    mockPlayersSnapshot([]);

    mountGameMasterView();

    await act(async () => {
        await capturedExecutionContext.handleOpenSznstarted('Alice');
    });

    expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Alice has open season on them',
            standings: null,
        },
        'room-a'
    );
});

it('broadcasts open season ending', async () => {
    mockPlayersSnapshot([]);

    mountGameMasterView();

    await act(async () => {
        await capturedExecutionContext.handleOpenSznended('Alice');
    });

    expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'open season has ended for Alice',
            standings: null,
        },
        'room-a'
    );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: FAIL — `addPlayerMessageForRoom` is not called by either handler yet.

- [ ] **Step 3: Implement**

In `src/pages/GameMasterView.js`, replace `handleOpenSznstarted` and `handleOpenSznended` (`GameMasterView.js:118-124`):

```js
const handleOpenSznstarted = async (openSznplayer) => {
    await addLog(openSznplayer + ' has open season on them', 'lightblue');
    await addPlayerMessageForRoom(
        {
            type: 'broadcast',
            recipient: null,
            text: openSznplayer + ' has open season on them',
            standings: null,
        },
        roomID
    );
};

const handleOpenSznended = async (openSznplayer) => {
    await addLog('open season has ended for ' + openSznplayer, 'pink.400');
    await addPlayerMessageForRoom(
        {
            type: 'broadcast',
            recipient: null,
            text: 'open season has ended for ' + openSznplayer,
            standings: null,
        },
        roomID
    );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: PASS, both new tests plus all of Task 1's.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Broadcast open season start/end to players' chat feed"
```

---

## Task 3: Broadcast a revive

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `capturedExecutionContext`, `addLogForRoom`/`addPlayerMessageForRoom` mocks, `updateIsAliveForPlayer` mock (all Task 1/pre-existing).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Add to the same `describe` block:

```jsx
it('broadcasts a revive', async () => {
    mockPlayersSnapshot([]);

    mountGameMasterView();

    await act(async () => {
        await capturedExecutionContext.handlePlayerRevive('Alice');
    });

    expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
        { type: 'broadcast', recipient: null, text: 'Alice was revived', standings: null },
        'room-a'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: FAIL — `addPlayerMessageForRoom` is not called by `handlePlayerRevive` yet.

- [ ] **Step 3: Implement**

In `src/pages/GameMasterView.js`, replace `handlePlayerRevive` (`GameMasterView.js:128-131`):

```js
const handlePlayerRevive = async (revivedPlayerName) => {
    await updateIsAliveForPlayer(revivedPlayerName, true, roomID);
    await addLog(revivedPlayerName + ' was revived', 'blue.300');
    await addPlayerMessageForRoom(
        {
            type: 'broadcast',
            recipient: null,
            text: revivedPlayerName + ' was revived',
            standings: null,
        },
        roomID
    );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: PASS, new test plus all prior tests in this file.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Broadcast revives to players' chat feed"
```

---

## Task 4: Broadcast a mission being added and a mission being manually ended

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `capturedExecutionContext`, `addLogForRoom`/`addPlayerMessageForRoom` mocks (Task 1).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to the same `describe` block:

```jsx
it('broadcasts a new mission being added', async () => {
    mockPlayersSnapshot([]);

    mountGameMasterView();

    await act(async () => {
        await capturedExecutionContext.handleNewTaskAdded({ title: 'Find the clue' });
    });

    expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Added new task: Find the clue',
            standings: null,
        },
        'room-a'
    );
});

it('broadcasts a mission being manually ended', async () => {
    mockPlayersSnapshot([]);

    mountGameMasterView();

    await act(async () => {
        await capturedExecutionContext.handleTaskCompleted('Find the clue');
    });

    expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Completed task: Find the clue',
            standings: null,
        },
        'room-a'
    );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: FAIL — neither handler calls `addPlayerMessageForRoom` yet.

- [ ] **Step 3: Implement**

In `src/pages/GameMasterView.js`, replace `handleNewTaskAdded` and `handleTaskCompleted` (`GameMasterView.js:139-142` and `:153-156`):

```js
const handleNewTaskAdded = async (newTask) => {
    setShowTaskCreationModal(false);
    await addLog('Added new task: ' + newTask.title, 'yellow.400');
    await addPlayerMessageForRoom(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Added new task: ' + newTask.title,
            standings: null,
        },
        roomID
    );
};
```

```js
const handleTaskCompleted = async (task) => {
    setCompletedTasks((completedTasks) => [...completedTasks, task]);
    await addLog('Completed task: ' + task, 'green.400');
    await addPlayerMessageForRoom(
        { type: 'broadcast', recipient: null, text: 'Completed task: ' + task, standings: null },
        roomID
    );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: PASS, both new tests plus all prior tests in this file.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Broadcast mission creation and manual mission end to players' chat feed"
```

---

## Task 5: Broadcast a mission completion and completion-cap auto-end

**Files:**

- Modify: `src/components/logs_components/ChatInput.js`
- Modify: `src/components/logs_components/ChatInput.test.jsx`

**Interfaces:**

- Consumes: `addPlayerMessageForRoom` (already imported in `ChatInput.js`).
- Produces: nothing new consumed elsewhere. This is the plan's final task.

`ChatInput.test.jsx` already has direct coverage of both call sites (the `describe('/mission done (bug report: ended missions, missing chat log, completion cap)', ...)` block), unlike `GameMasterView.js`'s handlers — no new test infrastructure needed here, only new assertions added to existing tests.

- [ ] **Step 1: Write the failing tests**

In `src/components/logs_components/ChatInput.test.jsx`, add one assertion to two existing tests inside the `describe('/mission done (bug report: ended missions, missing chat log, completion cap)', ...)` block.

Change the test `'logs the completion to chat using the player\'s actual stored casing, not "bob"'` (currently `ChatInput.test.jsx:269-281`) from:

```jsx
it('logs the completion to chat using the player\'s actual stored casing, not "bob"', async () => {
    dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask });

    const commandInput = mountChatInput();
    typeAndSubmit(commandInput, '/mission done bob 1');

    await waitFor(() =>
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Bob completed mission: Find the clue',
            'green.400'
        )
    );
});
```

to:

```jsx
it('logs the completion to chat using the player\'s actual stored casing, not "bob"', async () => {
    dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask });

    const commandInput = mountChatInput();
    typeAndSubmit(commandInput, '/mission done bob 1');

    await waitFor(() =>
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Bob completed mission: Find the clue',
            'green.400'
        )
    );
    expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Bob completed mission: Find the clue',
            standings: null,
        },
        'room-a'
    );
});
```

Change the test `'auto-ends the mission and announces it once the completion cap is reached'` (currently `ChatInput.test.jsx:283-296`) from:

```jsx
it('auto-ends the mission and announces it once the completion cap is reached', async () => {
    dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask, maxCompletions: 1 });

    const commandInput = mountChatInput();
    typeAndSubmit(commandInput, '/mission done bob 1');

    await waitFor(() =>
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).toHaveBeenCalledWith(1, 'room-a')
    );
    expect(executionHandlers.addLog).toHaveBeenCalledWith(
        'Mission "Find the clue" auto-ended — reached its 1-completion cap',
        'purple.400'
    );
});
```

to:

```jsx
it('auto-ends the mission and announces it once the completion cap is reached', async () => {
    dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask, maxCompletions: 1 });

    const commandInput = mountChatInput();
    typeAndSubmit(commandInput, '/mission done bob 1');

    await waitFor(() =>
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).toHaveBeenCalledWith(1, 'room-a')
    );
    expect(executionHandlers.addLog).toHaveBeenCalledWith(
        'Mission "Find the clue" auto-ended — reached its 1-completion cap',
        'purple.400'
    );
    expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'broadcast',
            recipient: null,
            text: 'Mission "Find the clue" auto-ended — reached its 1-completion cap',
            standings: null,
        },
        'room-a'
    );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput`
Expected: FAIL — both new assertions fail, since `addPlayerMessageForRoom` is not yet called from either code path (`dbCalls.addPlayerMessageForRoom` mock has 0 calls matching that shape).

- [ ] **Step 3: Implement**

In `src/components/logs_components/ChatInput.js`, add a call immediately after the existing `addLog` call at the mission-completion success path (`ChatInput.js:235-238`):

```js
await addLog(
    `${resolvePlayerDisplayName(playerName, players)} completed mission: ${task.title}`,
    'green.400'
);
await addPlayerMessageForRoom(
    {
        type: 'broadcast',
        recipient: null,
        text: `${resolvePlayerDisplayName(playerName, players)} completed mission: ${task.title}`,
        standings: null,
    },
    roomID
);
```

Add a call immediately after the existing `addLog` call in the completion-cap auto-end branch (`ChatInput.js:249-252`):

```js
await addLog(
    `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
    'purple.400'
);
await addPlayerMessageForRoom(
    {
        type: 'broadcast',
        recipient: null,
        text: `Mission "${task.title}" auto-ended — reached its ${task.maxCompletions}-completion cap`,
        standings: null,
    },
    roomID
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=ChatInput`
Expected: PASS, both amended tests plus every other test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx
git commit -m "Broadcast mission completion and completion-cap auto-end to players' chat feed"
```

---

## Task 6: Docs and final gate

**Files:**

- Modify: `docs/testing.md`
- Modify: `docs/commands.md` (only if it describes `/mission done`, kill, revive, or open season in terms that would go stale — verify first)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — documentation only.

- [ ] **Step 1: Check `docs/commands.md` for stale claims**

Read `docs/commands.md`. If it describes what happens on a kill, revive, mission completion, mission creation, mission auto-end, or open season start/end in a way that says or implies players never see these events (e.g. anything echoing the pre-this-plan reality that only the GM console shows them), update it to note the event is now also broadcast to players' chat feed. If `docs/commands.md` doesn't describe these events at that level of detail (e.g. it only documents `/kill`/`/revive`/`/openseason`/`/mission` as GM command syntax, not their downstream effects), no change is needed — do not add new content that isn't already the kind of thing this doc covers.

- [ ] **Step 2: Update `docs/testing.md`**

Run the real suite and copy its actual output — do not hand-type counts:

```bash
npx jest --selectProjects unit dom
```

Update the illustrative `$ npm test` block and the module table's `GameMasterView.test.jsx` and `ChatInput.test.jsx` rows (adding a short note that they now also cover broadcasting these events to players) with this run's real test counts, and update the doc's total suite/test counts to match.

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
git add docs/testing.md docs/commands.md
git commit -m "Document broadcasting game events to players' chat feed"
```

(Omit `docs/commands.md` from the `git add` if Step 1 found no change was needed there.)
