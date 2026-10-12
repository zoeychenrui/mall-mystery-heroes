# Mission Edit and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Missions can currently be created and completed, but never
edited or deleted. Add both, with retroactive score adjustment when a
completed mission's point value is edited, and a type-change guard once
anyone has completed it.

**Architecture:** A pure decision function (`planScoreAdjustment`) decides
what score adjustment an edit implies; two new thin `dbCalls.js` functions
handle the Firestore writes; a new `TaskEditModal` component owns the edit
form and orchestrates decide-then-write; `TaskAccordion` gains Edit/Delete
buttons that open it (and, for delete, a confirmation dialog).

**Tech Stack:** React, Chakra UI, Firebase Firestore client SDK, Jest +
Testing Library (`unit` project for the pure function, `dom` project for
components, `integration` project against the real Firestore emulator for
the new `dbCalls.js` functions).

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`,
  `npm test`, `npm run build`) must pass before any task is considered
  done.
- TDD: write the failing test first, per CLAUDE.md — applies to every
  task.
- Task 2's real correctness gate is `npm run test:emulator` (starts the
  Firestore emulator and runs `*.integration.test.js`) — `npm test` does
  not run it at all, so a green `npm test` on that task proves nothing
  about the actual Firestore behavior.
- No changes to `TaskCreation.js`, `TaskCreationModal.js`, `TaskList.js`
  (its live `onSnapshot` subscription already reflects an edit or delete
  the moment it lands — no changes needed there), `TaskListModal.js`, or
  `ChatInput.js`'s `/mission` command handling.
- Changing a mission's `taskType` is blocked once `completedBy.length > 0`
  — retroactively reversing a revival or un-scoring a type-changed mission
  is explicitly out of scope.
- No title-uniqueness re-check on edit.

---

### Task 1: `planScoreAdjustment` — the pure edit-to-score-delta decision

**Files:**

- Create: `src/game/missionEdit.js`
- Test: `src/game/missionEdit.test.js`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `planScoreAdjustment(oldTask, newTask)` — a named export,
  pure function, `(oldTask: {taskType, pointValue, completedBy}, newTask:
{taskType, pointValue}) => {delta: number, players: string[]} | null`.
  Task 3 imports and calls this directly.

- [ ] **Step 1: Write the failing tests**

Create `src/game/missionEdit.test.js`:

```js
const { planScoreAdjustment } = require('./missionEdit');

describe('planScoreAdjustment', () => {
    it('returns the delta and affected players when a Task point value changes with existing completions', () => {
        const oldTask = { taskType: 'Task', pointValue: 10, completedBy: ['alice', 'bob'] };
        const newTask = { taskType: 'Task', pointValue: 15 };

        expect(planScoreAdjustment(oldTask, newTask)).toEqual({
            delta: 5,
            players: ['alice', 'bob'],
        });
    });

    it('returns null when the point value is unchanged', () => {
        const oldTask = { taskType: 'Task', pointValue: 10, completedBy: ['alice'] };
        const newTask = { taskType: 'Task', pointValue: 10 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });

    it('returns null when the mission is not a Task', () => {
        const oldTask = { taskType: 'Revival Mission', pointValue: 0, completedBy: ['alice'] };
        const newTask = { taskType: 'Revival Mission', pointValue: 0 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });

    it('returns null for a Revival Mission even if its point value somehow changed', () => {
        const oldTask = { taskType: 'Revival Mission', pointValue: 0, completedBy: ['alice'] };
        const newTask = { taskType: 'Revival Mission', pointValue: 5 };

        expect(planScoreAdjustment(oldTask, newTask)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/game/missionEdit.test.js`
Expected: FAIL — `Cannot find module './missionEdit'` (the file doesn't
exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/game/missionEdit.js`:

```js
/**
 * Decides what player score adjustment, if any, results from editing a
 * mission's pointValue. Performs no I/O — the caller applies the result
 * via dbCalls.updatePointsForPlayer, which is additive (Firestore
 * increment()), so `delta` is added directly, once per name in `players`.
 *
 * Returns null when no adjustment is needed: the mission isn't (or
 * didn't stay) a 'Task' — a Revival Mission's completion revives a
 * player rather than awarding points, so its pointValue is never
 * score-relevant — or the pointValue didn't actually change.
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * targetGraph.js's convention in this directory.
 */
const planScoreAdjustment = (oldTask, newTask) => {
    if (newTask.taskType !== 'Task') return null;
    const delta = newTask.pointValue - oldTask.pointValue;
    if (delta === 0) return null;
    return { delta, players: oldTask.completedBy };
};

module.exports = { planScoreAdjustment };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/game/missionEdit.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

All four must pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/missionEdit.js src/game/missionEdit.test.js
git commit -m "Add planScoreAdjustment, the pure decision for mission-edit score deltas"
```

---

### Task 2: `updateTaskForRoom` and `deleteTaskForRoom`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/components/firebase_calls/dbCalls.integration.test.js`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `updateTaskForRoom(index: number, updates: object, roomID:
string) => Promise<void>` and `deleteTaskForRoom(index: number, roomID:
string) => Promise<void>` — both named exports from `dbCalls.js`. Task 3
  and Task 4 import these directly.

`fetchReferenceByIndexForTask` already exists in `dbCalls.js` (find it by
that name) — it queries the `tasks` subcollection by `taskIndex` and
throws `new Error('Task not found')` if nothing matches. `updateDoc` and
`deleteDoc` are already imported at the top of `dbCalls.js` — no new
imports needed.

- [ ] **Step 1: Write the failing tests**

In `src/components/firebase_calls/dbCalls.integration.test.js`, add
`addTaskForRoom`, `deleteTaskForRoom`, `fetchReferenceByIndexForTask`, and
`updateTaskForRoom` to the existing top-of-file import list from
`./dbCalls` (it currently imports `addChatMessageForRoom`,
`addLogForRoom`, `addPhotoForRoom`, `addPlayerMessageForRoom`, `endGame`,
`fetchAliveRosterForRoom`, `fetchActiveRoomForHost`,
`fetchAllPlayersForRoom`, `fetchAssassinsForPlayer`,
`fetchLogsQueryByAscendingTimestampForRoom`,
`fetchPhotosQueryByAscendingTimestampForRoom`, `fetchPlayerForRoom`,
`fetchPlayerMessagesQueryForRoom`, `fetchTaskIndexThenIncrement`,
`updateIsAliveForPlayer`, `updateIsCompleteToTrueForTaskByIndex`,
`updatePointsForPlayer` — add the four new names to that same list,
alphabetically, without touching the existing ones). Add `getDoc` to the
existing `import { doc, getDoc, getDocs, terminate, Timestamp } from
'firebase/firestore';` line if it's not already there (it already is —
confirm, don't duplicate).

Add these two new `describe` blocks anywhere among the file's other
top-level `describe` blocks (e.g. right after the existing
`describe('fetchTaskIndexThenIncrement', ...)` block):

```js
describe('updateTaskForRoom', () => {
    it('updates the fields of an existing task, leaving others untouched', async () => {
        await seedRoom(ROOM, []);
        await addTaskForRoom(
            {
                title: 'Find the clue',
                titleTrimmedLowerCase: 'findtheclue',
                description: 'Look around',
                pointValue: 10,
                taskType: 'Task',
                maxCompletions: null,
                dateCreated: '12:00 PM',
                isComplete: false,
                completedBy: [],
                taskIndex: 1,
            },
            ROOM
        );

        await updateTaskForRoom(1, { pointValue: 20 }, ROOM);

        const taskRef = await fetchReferenceByIndexForTask(1, ROOM);
        const taskSnapshot = await getDoc(taskRef);
        expect(taskSnapshot.data().pointValue).toBe(20);
        expect(taskSnapshot.data().title).toBe('Find the clue');
    });

    it('throws when the task index does not exist', async () => {
        await seedRoom(ROOM, []);

        await expect(updateTaskForRoom(999, { pointValue: 5 }, ROOM)).rejects.toThrow(
            'Task not found'
        );
    });
});

describe('deleteTaskForRoom', () => {
    it('deletes an existing task', async () => {
        await seedRoom(ROOM, []);
        await addTaskForRoom(
            {
                title: 'Find the clue',
                titleTrimmedLowerCase: 'findtheclue',
                description: 'Look around',
                pointValue: 10,
                taskType: 'Task',
                maxCompletions: null,
                dateCreated: '12:00 PM',
                isComplete: false,
                completedBy: [],
                taskIndex: 1,
            },
            ROOM
        );

        await deleteTaskForRoom(1, ROOM);

        await expect(fetchReferenceByIndexForTask(1, ROOM)).rejects.toThrow('Task not found');
    });

    it('throws when the task index does not exist', async () => {
        await seedRoom(ROOM, []);

        await expect(deleteTaskForRoom(999, ROOM)).rejects.toThrow('Task not found');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:emulator`
Expected: FAIL on all 4 new tests — `updateTaskForRoom is not a function`
/ `deleteTaskForRoom is not a function` (neither exists yet in `dbCalls.js`).

- [ ] **Step 3: Write the implementation**

In `src/components/firebase_calls/dbCalls.js`, find
`fetchReferenceByIndexForTask` and add these two new functions
immediately after it:

```js
export const updateTaskForRoom = async (index, updates, roomID) => {
    const taskDocRef = await fetchReferenceByIndexForTask(index, roomID);
    await updateDoc(taskDocRef, updates);
};

export const deleteTaskForRoom = async (index, roomID) => {
    const taskDocRef = await fetchReferenceByIndexForTask(index, roomID);
    await deleteDoc(taskDocRef);
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:emulator`
Expected: PASS — all tests in `dbCalls.integration.test.js`, including
the 4 new ones. Paste the full, real emulator output in your report (per
this task's real correctness gate) — not a bare summary.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

All four must pass, in addition to `npm run test:emulator` above.

- [ ] **Step 6: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js src/components/firebase_calls/dbCalls.integration.test.js
git commit -m "Add updateTaskForRoom and deleteTaskForRoom to dbCalls"
```

---

### Task 3: `TaskEditModal` — the edit form and decide-then-write orchestration

**Files:**

- Create: `src/components/task_components/TaskEditModal.js`
- Test: `src/components/task_components/TaskEditModal.test.jsx`

**Interfaces:**

- Consumes: `planScoreAdjustment` from `../../game/missionEdit` (Task 1,
  `(oldTask, newTask) => {delta, players} | null`). `updateTaskForRoom`
  and `updatePointsForPlayer` from `../firebase_calls/dbCalls` (Task 2 +
  pre-existing; `updatePointsForPlayer(player: string, points: number,
roomID: string) => Promise<void>`, additive).
- Produces: `TaskEditModal` — a default export, React component, props
  `{isOpen: boolean, onClose: () => void, task: {taskIndex, title,
description, taskType, pointValue, maxCompletions, completedBy},
roomID: string}`. Task 4 imports and renders this directly.

Current full content of `src/components/task_components/TaskCreationModal.js`
(reference for Modal chrome — do not modify this file):

```jsx
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import React, { useRef } from 'react';
import TaskCreation from './TaskCreation';
import { taskContext } from '../Contexts';

const TaskCreationModal = ({ isOpen, onClose, handleNewTaskAdded }) => {
    const titleInputRef = useRef(null);

    return (
        <Modal isOpen={isOpen} onClose={onClose} initialFocusRef={titleInputRef}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Create a Mission</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <taskContext.Provider value={{ handleNewTaskAdded }}>
                        <TaskCreation ref={titleInputRef} />
                    </taskContext.Provider>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskCreationModal;
```

`TaskEditModal` is a single self-contained file (unlike
`TaskCreationModal`/`TaskCreation`'s split) — it owns the `Modal` chrome
and the form fields directly, since its editing logic is small enough not
to warrant a separate presentational component (YAGNI).

- [ ] **Step 1: Write the failing tests**

Create `src/components/task_components/TaskEditModal.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskEditModal edits an existing mission and, when its pointValue
 * changes on a Task with existing completions, retroactively adjusts
 * those players' scores by the delta
 * (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
 * Explicit dbCalls mock factory, not auto-mock — see ChatInput.test.jsx
 * for why.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskEditModal from './TaskEditModal';
import { updateTaskForRoom, updatePointsForPlayer } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    updateTaskForRoom: jest.fn(),
    updatePointsForPlayer: jest.fn(),
}));

const onClose = jest.fn();

const baseTask = {
    taskIndex: 1,
    title: 'Find the clue',
    description: 'Look around',
    taskType: 'Task',
    pointValue: 10,
    maxCompletions: null,
    completedBy: [],
};

const mountModal = (task = baseTask) =>
    render(
        <ChakraProvider>
            <TaskEditModal isOpen onClose={onClose} task={task} roomID="room-a" />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    updateTaskForRoom.mockResolvedValue(undefined);
    updatePointsForPlayer.mockResolvedValue(undefined);
});

describe('TaskEditModal', () => {
    it('submits updateTaskForRoom with the edited field values', async () => {
        mountModal();

        await userEvent.clear(screen.getByDisplayValue('Find the clue'));
        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the second clue');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ title: 'Find the second clue' }),
            'room-a'
        );
        expect(onClose).toHaveBeenCalled();
    });

    it('does not show a score-adjustment notice when pointValue is unchanged', async () => {
        mountModal({ ...baseTask, completedBy: ['alice', 'bob'] });

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.queryByText(/adjust/i)).not.toBeInTheDocument();
        expect(updatePointsForPlayer).not.toHaveBeenCalled();
    });

    it('shows a score-adjustment notice and applies it to every completing player when pointValue changes', async () => {
        mountModal({ ...baseTask, pointValue: 10, completedBy: ['alice', 'bob'] });

        await userEvent.clear(screen.getByDisplayValue('10'));
        await userEvent.type(screen.getByLabelText(/point value/i), '15');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(
            await screen.findByText(/adjust 2 players. scores by \+5 each/i)
        ).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(updateTaskForRoom).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ pointValue: 15 }),
            'room-a'
        );
        expect(updatePointsForPlayer).toHaveBeenCalledWith('alice', 5, 'room-a');
        expect(updatePointsForPlayer).toHaveBeenCalledWith('bob', 5, 'room-a');
        expect(onClose).toHaveBeenCalled();
    });

    it('disables the task type select once anyone has completed the mission', () => {
        mountModal({ ...baseTask, completedBy: ['alice'] });

        expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('does not disable the task type select when nobody has completed the mission yet', () => {
        mountModal({ ...baseTask, completedBy: [] });

        expect(screen.getByRole('combobox')).toBeEnabled();
    });

    it('shows an error and keeps the modal open when updateTaskForRoom rejects', async () => {
        updateTaskForRoom.mockRejectedValue(new Error('network down'));
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});
```

(This test file asserts the specific UX described in Step 3 below —
`getByLabelText(/point value/i)` and the exact "adjust N player(s)'
scores by ±X each" copy and a distinct "Confirm" button for the
score-adjustment notice. If you judge a different concrete UX serves the
spec's requirements just as well while writing Step 3, update these tests
to match your actual implementation — the spec's requirement is the
behavior, not this exact markup, but whatever you build must have a
`Save` button, a way to see the mission's fields pre-filled, a way to
target the point-value field specifically by an accessible label, and a
distinct confirmation step before the score adjustment actually applies.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/components/task_components/TaskEditModal.test.jsx`
Expected: FAIL — `Cannot find module './TaskEditModal'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/task_components/TaskEditModal.js`:

```jsx
import React, { useState } from 'react';
import {
    Alert,
    AlertIcon,
    Button,
    Flex,
    FormLabel,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    NumberDecrementStepper,
    NumberIncrementStepper,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    Select,
    Text,
} from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import { updatePointsForPlayer, updateTaskForRoom } from '../firebase_calls/dbCalls';
import { planScoreAdjustment } from '../../game/missionEdit';

// Self-contained: owns both the Modal chrome and the form fields, unlike
// TaskCreationModal/TaskCreation's split — editing's field set is small
// enough not to warrant a separate presentational component. Not a reuse
// of TaskCreation.js: no dupe-check, no new taskIndex, isComplete/
// completedBy are preserved untouched
// (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
const TaskEditModal = ({ isOpen, onClose, task, roomID }) => {
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [taskType, setTaskType] = useState(task.taskType);
    const [pointValue, setPointValue] = useState(String(task.pointValue));
    const [maxCompletions, setMaxCompletions] = useState(
        task.maxCompletions === null || task.maxCompletions === undefined
            ? ''
            : String(task.maxCompletions)
    );
    const [error, setError] = useState(null);
    const [pendingAdjustment, setPendingAdjustment] = useState(null);
    const createAlert = CreateAlert();
    const hasCompletions = task.completedBy.length > 0;

    const buildUpdates = () => ({
        title,
        description,
        taskType,
        pointValue: Number(pointValue),
        maxCompletions: maxCompletions ? Number(maxCompletions) : null,
    });

    const applyUpdate = async (updates, adjustment) => {
        try {
            await updateTaskForRoom(task.taskIndex, updates, roomID);
            if (adjustment) {
                for (const player of adjustment.players) {
                    await updatePointsForPlayer(player, adjustment.delta, roomID);
                }
            }
            setPendingAdjustment(null);
            onClose();
        } catch (submitError) {
            console.error('Error saving mission edit:', submitError);
            setError(submitError.message);
            createAlert('error', 'Error saving mission', submitError.message, 1500);
        }
    };

    const handleSave = () => {
        setError(null);
        const updates = buildUpdates();
        const adjustment = planScoreAdjustment(task, updates);
        if (adjustment) {
            setPendingAdjustment({ updates, adjustment });
            return;
        }
        applyUpdate(updates, null);
    };

    const handleConfirmAdjustment = () => {
        applyUpdate(pendingAdjustment.updates, pendingAdjustment.adjustment);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Edit Mission</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <Flex direction="column" gap={2}>
                        <Input
                            placeholder="Task Title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                        <Input
                            placeholder="Description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                        <Select
                            value={taskType}
                            onChange={(event) => setTaskType(event.target.value)}
                            isDisabled={hasCompletions}
                        >
                            <option value="Task">Task</option>
                            <option value="Revival Mission">Revival Mission</option>
                        </Select>
                        <FormLabel htmlFor="edit-point-value">Point Value</FormLabel>
                        <NumberInput
                            id="edit-point-value"
                            value={pointValue}
                            onChange={setPointValue}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper color="white" />
                                <NumberDecrementStepper color="white" />
                            </NumberInputStepper>
                        </NumberInput>
                        <NumberInput value={maxCompletions} onChange={setMaxCompletions} min={0}>
                            <NumberInputField placeholder="Max completions" />
                            <NumberInputStepper>
                                <NumberIncrementStepper color="white" />
                                <NumberDecrementStepper color="white" />
                            </NumberInputStepper>
                        </NumberInput>
                        {error && (
                            <Alert status="error">
                                <AlertIcon />
                                {error}
                            </Alert>
                        )}
                        {pendingAdjustment && (
                            <Alert status="warning">
                                <AlertIcon />
                                <Text>
                                    This will adjust {pendingAdjustment.adjustment.players.length}{' '}
                                    player
                                    {pendingAdjustment.adjustment.players.length === 1 ? '' : 's'}
                                    &apos; scores by{' '}
                                    {pendingAdjustment.adjustment.delta > 0 ? '+' : ''}
                                    {pendingAdjustment.adjustment.delta} each.
                                </Text>
                            </Alert>
                        )}
                    </Flex>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    {pendingAdjustment ? (
                        <Button colorScheme="green" onClick={handleConfirmAdjustment}>
                            Confirm
                        </Button>
                    ) : (
                        <Button colorScheme="blue" onClick={handleSave}>
                            Save
                        </Button>
                    )}
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskEditModal;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/components/task_components/TaskEditModal.test.jsx`
Expected: PASS. If any test fails on a markup/copy mismatch against Step
3's actual implementation, adjust the test to match your implementation's
real behavior — the important thing is that the underlying behavior (see
the note after Step 1's code block) is genuinely covered, not the exact
strings.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

All four must pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/task_components/TaskEditModal.js src/components/task_components/TaskEditModal.test.jsx
git commit -m "Add TaskEditModal for editing an existing mission"
```

---

### Task 4: Wire Edit/Delete into `TaskAccordion`

**Files:**

- Modify: `src/components/task_components/TaskAccordion.js`
- Test: `src/components/task_components/TaskAccordion.test.jsx` (new file
  — none currently exists for this component)

**Interfaces:**

- Consumes: `TaskEditModal` from Task 3 (default export, props `{isOpen,
onClose, task, roomID}`). `deleteTaskForRoom` from
  `../firebase_calls/dbCalls` (Task 2, `(index, roomID) =>
Promise<void>`). `gameContext` from `../Contexts` (already exists,
  provides `roomID` among other fields).
- Produces: nothing consumed elsewhere — this is the last task in this
  plan.

Current full content of `src/components/task_components/TaskAccordion.js`:

```jsx
import {
    AccordionIcon,
    AccordionButton,
    AccordionItem,
    AccordionPanel,
    Text,
} from '@chakra-ui/react';
import React from 'react';

const TaskAccordion = (props) => {
    const task = props.task;

    return (
        <AccordionItem key={task.title} fontSize="md">
            <AccordionButton>
                <Text as="span" flex="1" textAlign="left" m="4px">
                    {task.taskIndex}. {task.title}
                </Text>
                <Text m="4px" mr="10px">
                    {task.pointValue}
                </Text>
                <AccordionIcon />
            </AccordionButton>
            <AccordionPanel>
                <Text pb="12px">Description: {task.description}</Text>
                <Text pb="12px">Task Type: {task.taskType}</Text>
                <Text pb="12px">
                    Completions: {task.completedBy.length}
                    {task.maxCompletions ? ` / ${task.maxCompletions}` : ''}
                </Text>
                <Text pb="12px">
                    {task.completedBy.length === '0' || !task.isComplete
                        ? 'Incomplete'
                        : `Completed By: ${task.completedBy.length === '0' ? 'None' : task.completedBy.join(', ')}`}
                </Text>
            </AccordionPanel>
        </AccordionItem>
    );
};

export default TaskAccordion;
```

For reference, `src/components/lobby_components/PlayerRemove.js` (as it
exists after this session's batch-A confirmation-dialog work) already has
the exact AlertDialog confirmation pattern this task's Delete button
needs — read that file directly before writing this task's diff, to match
its `useDisclosure`/`cancelRef`/`AlertDialogContent bg="#202030"`/
`AlertDialogHeader color="red"`/"Go Back"(red)/"Confirm"(green) structure
precisely. `src/components/header_components/ResetTargetsButton.js`
similarly shows this repo's `useContext(gameContext)` pattern for reading
`roomID` directly in a component that doesn't otherwise receive it as a
prop.

**Important cross-file check:** `src/components/task_components/TaskList.test.jsx`
(read it before starting) mounts the real `TaskAccordion` (not stubbed)
inside `gameContext.Provider value={{roomID: 'room-a'}}`. Its two existing
tests don't assert on the absence of other buttons, so adding Edit/Delete
buttons should be additive-safe — but you must actually run
`TaskList.test.jsx` as part of this task's gate and confirm both its
tests still pass, not just assume it.

- [ ] **Step 1: Write the failing tests**

Create `src/components/task_components/TaskAccordion.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskAccordion now owns Edit (opens TaskEditModal) and Delete (opens an
 * inline confirmation dialog, matching PlayerRemove.js's pattern) for
 * each mission
 * (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
 * TaskEditModal is stubbed — it has its own dedicated test file
 * (TaskEditModal.test.jsx) — matching how PlayerGame.test.jsx stubs
 * MessageFeed/MessageComposer.
 */
import React from 'react';
import { ChakraProvider, Accordion } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskAccordion from './TaskAccordion';
import { gameContext } from '../Contexts';
import { deleteTaskForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    deleteTaskForRoom: jest.fn(),
}));
jest.mock(
    './TaskEditModal',
    () => (props) => (props.isOpen ? <div>task-edit-modal-stub task={props.task.title}</div> : null)
);

const baseTask = {
    taskIndex: 1,
    title: 'Find the clue',
    description: 'Look around',
    taskType: 'Task',
    pointValue: 10,
    maxCompletions: null,
    isComplete: false,
    completedBy: [],
};

const mountAccordion = (task = baseTask) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <Accordion allowToggle defaultIndex={0}>
                    <TaskAccordion task={task} />
                </Accordion>
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    deleteTaskForRoom.mockResolvedValue(undefined);
});

describe('TaskAccordion', () => {
    it('opens TaskEditModal with the current task when Edit is clicked', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

        expect(screen.getByText(/task-edit-modal-stub/)).toBeInTheDocument();
        expect(screen.getByText(/Find the clue/)).toBeInTheDocument();
    });

    it('opens a confirmation dialog when Delete is clicked, without deleting immediately', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(screen.getByText(/delete find the clue/i)).toBeInTheDocument();
        expect(deleteTaskForRoom).not.toHaveBeenCalled();
    });

    it('mentions the completion count in the confirmation dialog when the mission has completions', async () => {
        mountAccordion({ ...baseTask, completedBy: ['alice', 'bob'] });

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(screen.getByText(/2 player/i)).toBeInTheDocument();
    });

    it('does not mention completions in the confirmation dialog when nobody has completed the mission', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(screen.queryByText(/player.*completed/i)).not.toBeInTheDocument();
    });

    it('calls deleteTaskForRoom only after Confirm is clicked', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(deleteTaskForRoom).toHaveBeenCalledWith(1, 'room-a');
    });

    it('deletes nothing when Go Back is clicked', async () => {
        mountAccordion();

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await userEvent.click(screen.getByRole('button', { name: 'Go Back' }));

        expect(deleteTaskForRoom).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/components/task_components/TaskAccordion.test.jsx`
Expected: FAIL — no Edit/Delete buttons exist yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of
`src/components/task_components/TaskAccordion.js`:

```jsx
import {
    AccordionIcon,
    AccordionButton,
    AccordionItem,
    AccordionPanel,
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Button,
    Text,
    useDisclosure,
} from '@chakra-ui/react';
import React, { useContext, useRef, useState } from 'react';
import { gameContext } from '../Contexts';
import { deleteTaskForRoom } from '../firebase_calls/dbCalls';
import CreateAlert from '../CreateAlert';
import TaskEditModal from './TaskEditModal';

const TaskAccordion = (props) => {
    const task = props.task;
    const { roomID } = useContext(gameContext);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
    const cancelRef = useRef();
    const createAlert = CreateAlert();

    const handleConfirmDelete = async () => {
        try {
            await deleteTaskForRoom(task.taskIndex, roomID);
        } catch (error) {
            console.error('Error deleting mission:', error);
            createAlert('error', 'Error deleting mission', error.message, 1500);
        } finally {
            onDeleteClose();
        }
    };

    return (
        <AccordionItem key={task.title} fontSize="md">
            <AccordionButton>
                <Text as="span" flex="1" textAlign="left" m="4px">
                    {task.taskIndex}. {task.title}
                </Text>
                <Text m="4px" mr="10px">
                    {task.pointValue}
                </Text>
                <AccordionIcon />
            </AccordionButton>
            <AccordionPanel>
                <Text pb="12px">Description: {task.description}</Text>
                <Text pb="12px">Task Type: {task.taskType}</Text>
                <Text pb="12px">
                    Completions: {task.completedBy.length}
                    {task.maxCompletions ? ` / ${task.maxCompletions}` : ''}
                </Text>
                <Text pb="12px">
                    {task.completedBy.length === '0' || !task.isComplete
                        ? 'Incomplete'
                        : `Completed By: ${task.completedBy.length === '0' ? 'None' : task.completedBy.join(', ')}`}
                </Text>
                <Button size="sm" mr={2} onClick={() => setIsEditOpen(true)}>
                    Edit
                </Button>
                <Button size="sm" colorScheme="red" onClick={onDeleteOpen}>
                    Delete
                </Button>
            </AccordionPanel>
            <TaskEditModal
                isOpen={isEditOpen}
                onClose={() => setIsEditOpen(false)}
                task={task}
                roomID={roomID}
            />
            <AlertDialog
                isOpen={isDeleteOpen}
                leastDestructiveRef={cancelRef}
                onClose={onDeleteClose}
            >
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Delete {task.title}? This cannot be undone.
                        {task.completedBy.length > 0 && (
                            <Text mt={2}>
                                {task.completedBy.length} player
                                {task.completedBy.length === 1 ? '' : 's'} already completed this
                                mission.
                            </Text>
                        )}
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onDeleteClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={handleConfirmDelete}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AccordionItem>
    );
};

export default TaskAccordion;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/components/task_components/TaskAccordion.test.jsx`
Expected: PASS, 6 tests.

Then run: `npx jest src/components/task_components/TaskList.test.jsx`
Expected: PASS, both existing tests unaffected — confirm this for real,
per the cross-file check above.

- [ ] **Step 5: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

All four must pass. Confirm `npm test`'s full output shows both
`TaskAccordion.test.jsx` and `TaskList.test.jsx` passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/task_components/TaskAccordion.js src/components/task_components/TaskAccordion.test.jsx
git commit -m "Add Edit and Delete to TaskAccordion"
```

---

## Self-Review Notes

- **Spec coverage:** "Both edit and delete" → Tasks 3 (edit) and 4
  (delete). "UI lives inside TaskAccordion's panel" → Task 4. "Retroactive
  score recalculation via delta" → Task 1's `planScoreAdjustment`,
  consumed by Task 3. "Type-change blocked once completed" → Task 3's
  `isDisabled={hasCompletions}` on the type Select. "Delete always
  allowed, confirmed via AlertDialog, mentions completion count" → Task 4. "No title-uniqueness re-check on edit" → Task 3 has no dupe-check
  call anywhere, confirmed absent from its implementation.
- **Placeholder scan:** none found — every step has complete code or an
  explicit run command with an expected result.
- **Type consistency:** `planScoreAdjustment`'s signature
  (`(oldTask, newTask) => {delta, players} | null`) is identical between
  Task 1's produce and Task 3's consume. `updateTaskForRoom`/`deleteTaskForRoom`'s
  `(index, ..., roomID)` parameter order is identical across Task 2's
  produce and Tasks 3/4's consume. `TaskEditModal`'s prop names
  (`isOpen`, `onClose`, `task`, `roomID`) match between Task 3's produce
  and Task 4's consume/render.
