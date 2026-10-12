# Mission Modal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the permanent mission panel in `GameMasterView` (added earlier this session, but awkward once actually rendered) with two on-demand Chakra modals — one for creating a mission, one for viewing them — triggered by new `/mission start` and `/mission view` commands.

**Architecture:** Two new thin modal-shell components (`TaskCreationModal.js`, `TaskListModal.js`) wrap the existing, unchanged `TaskCreation.js`/`TaskList.js`, following the `RemapPlayerModal.js` pattern already in this codebase (a controlled `Modal` with `isOpen`/`onClose` props, owned by `GameMasterView`'s state). `TaskExecution.js`, which used to glue the two into one panel, is deleted — nothing renders them together anymore.

**Tech Stack:** React, Chakra UI (`Modal`/`ModalOverlay`/`ModalContent`/`ModalHeader`/`ModalCloseButton`/`ModalBody`/`ModalFooter`), Jest + Testing Library (`dom` project), existing `taskContext`/`executionContext`/`gameContext` from `src/components/Contexts.js`.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md` — read it if anything below is ambiguous.
- `TaskCreation.js` and `TaskList.js` do not change internally. `TaskCreation.test.jsx` and `TaskList.test.jsx` do not change.
- The creation modal closes automatically on a successful creation (decided). The view modal is read-only — no complete/close actions inside it (decided).
- `src/game/commands.js` does not change — `/mission` is already a known top-level command; `start`/`view` are sub-arguments handled entirely inside `ChatInput.js`, the same way `done`/`end` already are.
- Every task ends green on: `npm run format`, `npm run lint`, and the relevant Jest project (`npx jest --selectProjects dom <file>`). The final task runs the complete gate: `npm run format`, `npm run format:check`, `npm run lint`, `npm test`, `npm run test:rules`, `npm run test:emulator`, `CI=true npm run build` — this repo has held that bar all session; don't break the streak.
- Commit after each task, following this repo's commit style (see `git log` for examples) — small, focused commits, not one giant one at the end.

---

### Task 1: `TaskCreationModal.js`

**Files:**

- Create: `src/components/task_components/TaskCreationModal.js`
- Create: `src/components/task_components/TaskCreationModal.test.jsx`

**Interfaces:**

- Consumes: `TaskCreation` (default export, `src/components/task_components/TaskCreation.js`, unchanged — reads `taskContext` for `handleNewTaskAdded` and `gameContext` for `roomID`); `taskContext` (`src/components/Contexts.js`).
- Produces: `TaskCreationModal` (default export) — props `{ isOpen: boolean, onClose: () => void, handleNewTaskAdded: (newTask) => void|Promise<void> }`. Task 3 renders this from `GameMasterView`.

- [ ] **Step 1: Write the failing test**

Create `src/components/task_components/TaskCreationModal.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskCreation itself is unchanged and already covered by
 * TaskCreation.test.jsx — this only tests the modal shell around it
 * (docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskCreationModal from './TaskCreationModal';
import { gameContext } from '../Contexts';
import {
    addTaskForRoom,
    checkForTaskDupesForRoom,
    fetchTaskIndexThenIncrement,
} from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addTaskForRoom: jest.fn(),
    checkForTaskDupesForRoom: jest.fn(),
    fetchTaskIndexThenIncrement: jest.fn(),
}));

const handleNewTaskAdded = jest.fn();
const onClose = jest.fn();

const mountModal = (isOpen) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <TaskCreationModal
                    isOpen={isOpen}
                    onClose={onClose}
                    handleNewTaskAdded={handleNewTaskAdded}
                />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    fetchTaskIndexThenIncrement.mockResolvedValue(3);
    checkForTaskDupesForRoom.mockResolvedValue(false);
    addTaskForRoom.mockResolvedValue(undefined);
});

describe('TaskCreationModal', () => {
    it('renders the mission creation form when open', () => {
        mountModal(true);

        expect(screen.getByPlaceholderText('Task Title')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        mountModal(false);

        expect(screen.queryByPlaceholderText('Task Title')).not.toBeInTheDocument();
    });

    it('calls onClose when the Close button is clicked', async () => {
        mountModal(true);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('calls handleNewTaskAdded with the new task on a successful creation', async () => {
        mountModal(true);

        await userEvent.type(screen.getByPlaceholderText('Task Title'), 'Find the clue');
        await userEvent.selectOptions(screen.getByRole('combobox'), 'Revival Mission');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('Task Added')).toBeInTheDocument();
        expect(handleNewTaskAdded).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Find the clue', taskType: 'Revival Mission' })
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom src/components/task_components/TaskCreationModal.test.jsx`
Expected: FAIL — `Cannot find module './TaskCreationModal'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/task_components/TaskCreationModal.js`:

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
import React from 'react';
import TaskCreation from './TaskCreation';
import { taskContext } from '../Contexts';

const TaskCreationModal = ({ isOpen, onClose, handleNewTaskAdded }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Create a Mission</ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    <taskContext.Provider value={{ handleNewTaskAdded }}>
                        <TaskCreation />
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom src/components/task_components/TaskCreationModal.test.jsx`
Expected: PASS, 4/4.

- [ ] **Step 5: Format and lint**

Run: `npm run format && npm run lint`
Expected: both clean (lint: 0 warnings, 0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/components/task_components/TaskCreationModal.js src/components/task_components/TaskCreationModal.test.jsx
git commit -m "Add TaskCreationModal, a modal shell around the existing TaskCreation form"
```

---

### Task 2: `TaskListModal.js`

**Files:**

- Create: `src/components/task_components/TaskListModal.js`
- Create: `src/components/task_components/TaskListModal.test.jsx`

**Interfaces:**

- Consumes: `TaskList` (default export, `src/components/task_components/TaskList.js`, unchanged — reads `gameContext` for `roomID`, subscribes to Firestore on mount).
- Produces: `TaskListModal` (default export) — props `{ isOpen: boolean, onClose: () => void }`. Task 3 renders this from `GameMasterView`.

- [ ] **Step 1: Write the failing test**

Create `src/components/task_components/TaskListModal.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * TaskList itself is unchanged and already covered by TaskList.test.jsx —
 * this only tests the modal shell around it
 * (docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import TaskListModal from './TaskListModal';
import { gameContext } from '../Contexts';
import { fetchTasksByCompletionForRoom } from '../firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchTasksByCompletionForRoom: jest.fn(),
    fetchTasksQueryForRoom: jest.fn(() => 'tasks-query'),
}));

const onClose = jest.fn();

const mountModal = (isOpen) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <TaskListModal isOpen={isOpen} onClose={onClose} />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    fetchTasksByCompletionForRoom.mockResolvedValue({ docs: [] });
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: [] });
        return () => {};
    });
});

describe('TaskListModal', () => {
    it('renders the mission list when open', () => {
        mountModal(true);

        expect(screen.getByText('Active (0)')).toBeInTheDocument();
        expect(screen.getByText('Completed (0)')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        mountModal(false);

        expect(screen.queryByText('Active (0)')).not.toBeInTheDocument();
    });

    it('calls onClose when the Close button is clicked', async () => {
        mountModal(true);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom src/components/task_components/TaskListModal.test.jsx`
Expected: FAIL — `Cannot find module './TaskListModal'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/task_components/TaskListModal.js`:

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
import React from 'react';
import TaskList from './TaskList';

const TaskListModal = ({ isOpen, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl">
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Missions</ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    <TaskList />
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskListModal;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom src/components/task_components/TaskListModal.test.jsx`
Expected: PASS, 3/3.

- [ ] **Step 5: Format and lint**

Run: `npm run format && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/task_components/TaskListModal.js src/components/task_components/TaskListModal.test.jsx
git commit -m "Add TaskListModal, a modal shell around the existing TaskList component"
```

---

### Task 3: Wire the modals into `GameMasterView.js`, delete `TaskExecution.js`

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`
- Delete: `src/components/task_components/TaskExecution.js`

**Interfaces:**

- Consumes: `TaskCreationModal` and `TaskListModal` from Tasks 1–2 (exact prop shapes above).
- Produces: two new entries on `executionContextProviderValues` — `handleShowMissionCreation: () => void` and `handleShowMissionList: () => void` — that Task 5 (`ChatInput.js`) calls by name. These names are load-bearing; Task 5 must match them exactly.

This task is a refactor of existing, already-tested behavior — the "test" is the existing `GameMasterView.test.jsx` suite staying green throughout, plus one updated stub. There's no new user-facing behavior in `GameMasterView.test.jsx` to TDD (Tasks 1–2 already covered the modals' own behavior in isolation; Task 5 covers the command dispatch).

- [ ] **Step 1: Update the `GameMasterView.test.jsx` stub**

In `src/pages/GameMasterView.test.jsx`, find:

```jsx
// TaskExecution (item 15's mission panel) has its own test coverage
// (TaskCreation.test.jsx, TaskList.test.jsx) — stubbed here for the same
// reason ChatInput/PhotosDisplay/ResetTargetsButton are: this file stays
// focused on GameMasterView's own logic.
jest.mock('../components/task_components/TaskExecution', () => () => (
    <div>task-execution-stub</div>
));
```

Replace with:

```jsx
// TaskCreationModal/TaskListModal (item 15's mission modals) have their
// own test coverage (TaskCreationModal.test.jsx, TaskListModal.test.jsx) —
// stubbed here for the same reason ChatInput/PhotosDisplay/ResetTargetsButton
// are: this file stays focused on GameMasterView's own logic.
jest.mock('../components/task_components/TaskCreationModal', () => () => (
    <div>task-creation-modal-stub</div>
));
jest.mock('../components/task_components/TaskListModal', () => () => (
    <div>task-list-modal-stub</div>
));
```

- [ ] **Step 2: Update `GameMasterView.js` imports**

In `src/pages/GameMasterView.js`, replace:

```js
import { HStack, Heading, VStack, Box, Divider } from '@chakra-ui/react';
import TaskExecution from '../components/task_components/TaskExecution';
import HeaderExecution from '../components/header_components/HeaderExecution';
import Log from '../components/logs_components/Log';
import CreateAlert from '../components/CreateAlert';
import {
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchLogsQueryByAscendingTimestampForRoom,
    addLogForRoom,
    updateIsAliveForPlayer,
} from '../components/firebase_calls/dbCalls';
import RemapPlayerModal from '../components/RemapPlayerModal';
import { gameContext, taskContext, executionContext } from '../components/Contexts';
```

with:

```js
import { HStack, Heading, VStack, Box, Divider } from '@chakra-ui/react';
import TaskCreationModal from '../components/task_components/TaskCreationModal';
import TaskListModal from '../components/task_components/TaskListModal';
import HeaderExecution from '../components/header_components/HeaderExecution';
import Log from '../components/logs_components/Log';
import CreateAlert from '../components/CreateAlert';
import {
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchLogsQueryByAscendingTimestampForRoom,
    addLogForRoom,
    updateIsAliveForPlayer,
} from '../components/firebase_calls/dbCalls';
import RemapPlayerModal from '../components/RemapPlayerModal';
import { gameContext, executionContext } from '../components/Contexts';
```

(`taskContext` is no longer imported here — `TaskCreationModal` owns that `Provider` now.)

- [ ] **Step 3: Add the two new state variables**

Replace:

```js
const [showRemapModal, setShowRemapModal] = useState(false);
```

with:

```js
const [showRemapModal, setShowRemapModal] = useState(false);
const [showTaskCreationModal, setShowTaskCreationModal] = useState(false);
const [showTaskListModal, setShowTaskListModal] = useState(false);
```

- [ ] **Step 4: Make `handleNewTaskAdded` close the creation modal, add the two show-handlers**

Replace:

```js
// TaskList (docs/improvements.md item 15) owns its own live subscription
// to the tasks collection, so a new task shows up there without this
// needing to track a parallel copy — this only logs the event.
const handleNewTaskAdded = async (newTask) => {
    await addLog('Added new task: ' + newTask.title, 'yellow.400');
};
```

with:

```js
// TaskList (docs/improvements.md item 15) owns its own live subscription
// to the tasks collection, so a new task shows up there without this
// needing to track a parallel copy — this only logs the event and
// closes the creation modal (docs/superpowers/specs/2026-08-04-
// mission-modal-ui-design.md — creation closes automatically on
// success).
const handleNewTaskAdded = async (newTask) => {
    setShowTaskCreationModal(false);
    await addLog('Added new task: ' + newTask.title, 'yellow.400');
};

const handleShowMissionCreation = () => {
    setShowTaskCreationModal(true);
};

const handleShowMissionList = () => {
    setShowTaskListModal(true);
};
```

- [ ] **Step 5: Add the two new handlers to `executionContextProviderValues`**

Replace:

```js
const executionContextProviderValues = {
    handleKillPlayer,
    handleAddNewAssassins,
    handleAddNewTargets,
    handleRemapping,
    handlePlayerRevive,
    handleTaskCompleted,
    handleSetShowMessageToTrue,
    handleOpenSznstarted,
    handleOpenSznended,
    addLog,
};
```

with:

```js
const executionContextProviderValues = {
    handleKillPlayer,
    handleAddNewAssassins,
    handleAddNewTargets,
    handleRemapping,
    handlePlayerRevive,
    handleTaskCompleted,
    handleSetShowMessageToTrue,
    handleShowMissionCreation,
    handleShowMissionList,
    handleOpenSznstarted,
    handleOpenSznended,
    addLog,
};
```

- [ ] **Step 6: Render the two modals, remove the panel**

Replace:

```jsx
            <Box sx={styles.container}>
                <RemapPlayerModal
                    showRemapModal={showRemapModal}
                    newTargets={newTargets}
                    newAssassins={newAssassins}
                    onClose={() => setShowRemapModal(false)}
                />
```

with:

```jsx
            <Box sx={styles.container}>
                <RemapPlayerModal
                    showRemapModal={showRemapModal}
                    newTargets={newTargets}
                    newAssassins={newAssassins}
                    onClose={() => setShowRemapModal(false)}
                />
                <TaskCreationModal
                    isOpen={showTaskCreationModal}
                    onClose={() => setShowTaskCreationModal(false)}
                    handleNewTaskAdded={handleNewTaskAdded}
                />
                <TaskListModal
                    isOpen={showTaskListModal}
                    onClose={() => setShowTaskListModal(false)}
                />
```

Then replace:

```jsx
<executionContext.Provider value={executionContextProviderValues}>
    <VStack sx={styles.rightHandStack}>
        <Box sx={styles.photosBox}>
            <PhotosDisplay />
        </Box>

        <Box sx={styles.taskBox}>
            <taskContext.Provider value={{ handleNewTaskAdded }}>
                <TaskExecution />
            </taskContext.Provider>
        </Box>
    </VStack>
</executionContext.Provider>
```

with:

```jsx
<executionContext.Provider value={executionContextProviderValues}>
    <VStack sx={styles.rightHandStack}>
        <Box sx={styles.photosBox}>
            <PhotosDisplay />
        </Box>
    </VStack>
</executionContext.Provider>
```

- [ ] **Step 7: Simplify the `taskBox`/`photosBox` styles back to a single-child box**

Replace:

```js
    taskBox: {
        w: { base: '100%', md: '100%' },
        // flex, not a fixed h — see photosBox's comment below, same reason.
        flex: '2',
        minH: '0',
        borderWidth: '2px',
        borderRadius: '2xl',
        overflow: 'auto',
        p: '4px',
        display: 'flex',
        flexDirection: 'column',
    },
    rightHandStack: {
        ml: '10px',
        mr: '16px',
        w: '25%',
        minW: '25%',
        h: { base: '100%', md: '100%' },
    },
    photosBox: {
        w: { base: '100%', md: '100%' },
        // Sized by flex-grow, not a fixed h, so it shares rightHandStack's
        // height with taskBox (docs/improvements.md item 15) rather than
        // each claiming a fixed percentage that together overflow the
        // 100%-tall parent (95% + 60%, before this fix, back when taskBox
        // was still commented out and this never got exercised).
        flex: '3',
        minH: '0',
        overflow: 'auto',
    },
};
```

with:

```js
    rightHandStack: {
        ml: '10px',
        mr: '16px',
        w: '25%',
        minW: '25%',
        h: { base: '100%', md: '100%' },
    },
    photosBox: {
        w: { base: '100%', md: '100%' },
        // PhotosDisplay is the only child of rightHandStack again — the
        // mission panel that used to share this space moved into on-demand
        // modals instead (docs/superpowers/specs/2026-08-04-mission-modal-
        // ui-design.md), so there's no sibling to split height with anymore.
        h: '100%',
    },
};
```

- [ ] **Step 8: Delete the now-unused `TaskExecution.js`**

```bash
grep -rn "TaskExecution" src/ --include=*.js --include=*.jsx
```

Expected: no results (confirms nothing imports it anymore — `GameMasterView.js` no longer does, per Step 3).

```bash
rm src/components/task_components/TaskExecution.js
```

- [ ] **Step 9: Run the test suite**

Run: `npx jest --selectProjects dom src/pages/GameMasterView.test.jsx`
Expected: PASS, 3/3 (existing tests, unchanged behavior — the header count and alive-only roster logic this file actually tests is untouched by this task).

- [ ] **Step 10: Format and lint**

Run: `npm run format && npm run lint`
Expected: both clean. (Lint will catch it if `taskContext` or any other now-unused import was left behind.)

- [ ] **Step 11: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git rm src/components/task_components/TaskExecution.js
git commit -m "Replace the permanent mission panel with the two new modals"
```

---

### Task 4: Wire `/mission start` and `/mission view` in `ChatInput.js`

**Files:**

- Modify: `src/components/logs_components/ChatInput.js`
- Modify: `src/components/logs_components/ChatInput.test.jsx`

**Interfaces:**

- Consumes: `handleShowMissionCreation`, `handleShowMissionList` from `executionContext` — produced by Task 3, same names.
- Produces: nothing new for later tasks — this is the last code task.

- [ ] **Step 1: Write the failing tests**

In `src/components/logs_components/ChatInput.test.jsx`, find the `executionHandlers` object:

```jsx
const executionHandlers = {
    handleKillPlayer: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
    handleRemapping: jest.fn(),
    handleTaskCompleted: jest.fn(),
};
```

Replace with:

```jsx
const executionHandlers = {
    handleKillPlayer: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
    handleRemapping: jest.fn(),
    handleTaskCompleted: jest.fn(),
    handleShowMissionCreation: jest.fn(),
    handleShowMissionList: jest.fn(),
};
```

Then add a new `describe` block — place it directly after the existing `describe('/mission end does not toast success before the write succeeds (improvements item 20)', ...)` block:

```jsx
describe('/mission start and /mission view open the mission modals (improvements item 15)', () => {
    it('/mission start calls handleShowMissionCreation', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission start');

        await waitFor(() => expect(executionHandlers.handleShowMissionCreation).toHaveBeenCalled());
    });

    it('/mission view calls handleShowMissionList', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission view');

        await waitFor(() => expect(executionHandlers.handleShowMissionList).toHaveBeenCalled());
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom src/components/logs_components/ChatInput.test.jsx`
Expected: the two new tests FAIL — `/mission start`/`/mission view` currently fall through to the `/mission` inner switch's `default` case, which calls `createAlert` with `Inavlid argument: start`/`Inavlid argument: view`, never calling `handleShowMissionCreation`/`handleShowMissionList`. `waitFor` will time out waiting for a call that never happens.

- [ ] **Step 3: Add the two new cases**

In `src/components/logs_components/ChatInput.js`, find the destructure that pulls handlers out of `xecutionContext`:

```js
const {
    handleRemapping,
    handleKillPlayer,
    handleSetShowMessageToTrue,
    handleAddNewAssassins,
    handleAddNewTargets,
    handleOpenSznstarted,
    handleOpenSznended,
    handlePlayerRevive,
    handleTaskCompleted,
} = xecutionContext; // retrieve contexts
```

Replace with:

```js
const {
    handleRemapping,
    handleKillPlayer,
    handleSetShowMessageToTrue,
    handleAddNewAssassins,
    handleAddNewTargets,
    handleOpenSznstarted,
    handleOpenSznended,
    handlePlayerRevive,
    handleTaskCompleted,
    handleShowMissionCreation,
    handleShowMissionList,
} = xecutionContext; // retrieve contexts
```

Then find the `/mission` case's inner switch:

```js
                    case 'end':
                        missionIndex = args[1] ? Number(args[1]) : -1;
                        if (missionIndex === -1) {
                            createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
                            console.error(`${args[2]} is not a valid index`);
                            break;
                        }

                        // sanity check mission index — mirrors "/mission
                        // done"'s guard above. Previously missing here, so a
                        // bad index threw on task.title below, after the
                        // success toast had already fired (improvements
                        // item 20).
                        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                        if (!task) {
                            createAlert('error', 'Error', 'Invalid task index', 1500);
                            console.error('invalid task');
                            break;
                        }

                        await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
                        createAlert('info', 'Completed', 'Task has been saved as completed', 1500);
                        handleTaskCompleted(task.title);
                        break;
                    default:
                        createAlert('error', 'Error', `Inavlid argument: ${args[0]}`, 1500);
                        console.error(`Inavlid argument: ${args[0]}`);
                        break;
                }
                break;
```

Replace with (only the two new `case`s are added, between `'end'` and `default`):

```js
                    case 'end':
                        missionIndex = args[1] ? Number(args[1]) : -1;
                        if (missionIndex === -1) {
                            createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
                            console.error(`${args[2]} is not a valid index`);
                            break;
                        }

                        // sanity check mission index — mirrors "/mission
                        // done"'s guard above. Previously missing here, so a
                        // bad index threw on task.title below, after the
                        // success toast had already fired (improvements
                        // item 20).
                        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                        if (!task) {
                            createAlert('error', 'Error', 'Invalid task index', 1500);
                            console.error('invalid task');
                            break;
                        }

                        await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
                        createAlert('info', 'Completed', 'Task has been saved as completed', 1500);
                        handleTaskCompleted(task.title);
                        break;
                    case 'start':
                        handleShowMissionCreation();
                        break;
                    case 'view':
                        handleShowMissionList();
                        break;
                    default:
                        createAlert('error', 'Error', `Inavlid argument: ${args[0]}`, 1500);
                        console.error(`Inavlid argument: ${args[0]}`);
                        break;
                }
                break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom src/components/logs_components/ChatInput.test.jsx`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 5: Format and lint**

Run: `npm run format && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/logs_components/ChatInput.js src/components/logs_components/ChatInput.test.jsx
git commit -m "Add /mission start and /mission view commands"
```

---

### Task 5: Docs

**Files:**

- Modify: `docs/commands.md`
- Modify: `docs/improvements.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the two new subcommands to `docs/commands.md`**

Find:

```md
### `/mission end <index>`

Closes a mission for everyone by setting `isComplete: true`.

The success toast ("Task has been saved as completed") fires **before** the
lookup and write, so it appears even when the index does not exist — in which
case the subsequent `task.title` access throws.

---

## Declared but not implemented
```

Replace with:

```md
### `/mission end <index>`

Closes a mission for everyone by setting `isComplete: true`.

The success toast ("Task has been saved as completed") fires **before** the
lookup and write, so it appears even when the index does not exist — in which
case the subsequent `task.title` access throws.

### `/mission start`

Opens a popup (`TaskCreationModal`) with the mission creation form —
title, description, task type, points — the same form `TaskCreation`
always had. Ignores any extra arguments. Closes automatically once a
mission is created successfully; stays open on a validation error or a
duplicate title so the GM can fix the form without retyping.

### `/mission view`

Opens a read-only popup (`TaskListModal`) listing missions split into
Active/Completed tabs. Marking a mission done or closing it out is still
only done via `/mission done`/`/mission end` — this popup has no actions
of its own (docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md).

---

## Declared but not implemented
```

- [ ] **Step 2: Update `docs/improvements.md` item 15**

Find the end of item 15's resolution — the paragraph immediately before
`Relatedly, endGame sets isGameActive: false...`:

```md
New test coverage: `TaskCreation.test.jsx` (create end to end and clears the
form, duplicate rejected, validation, a rejected write shows an error toast
rather than the silent unhandled-rejection risk this same item's own text
flagged) and `TaskList.test.jsx` (active/completed split by count and
content, doesn't crash when the fetch rejects). Neither component had any
test before this — they were unreachable dead code.
```

Add a new paragraph directly after it (before the `**Not addressed:**` paragraph):

```md
**Follow-up, same session:** the panel form above never actually worked as
a layout — see `docs/superpowers/specs/2026-08-04-mission-modal-ui-design.md`.
`TaskCreation`/`TaskList` stayed exactly as described above; `TaskExecution`
(the component that combined them into one panel) was deleted, replaced by
`TaskCreationModal`/`TaskListModal` — two on-demand popups triggered by new
`/mission start`/`/mission view` commands, following the existing
`RemapPlayerModal` pattern. The restore-vs-remove decision itself didn't
change; only how the restored feature is presented did.
```

- [ ] **Step 3: Format**

Run: `npm run format && npm run format:check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/commands.md docs/improvements.md
git commit -m "Document /mission start and /mission view"
```

---

### Task 6: Full validation gate

**Files:** none (verification only).

- [ ] **Step 1: Format check**

Run: `npm run format:check`
Expected: "All matched files use Prettier code style!"

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Unit + dom tests**

Run: `npm test`
Expected: all suites pass, including the 2 new (`TaskCreationModal.test.jsx`, `TaskListModal.test.jsx`) and the 2 new cases in `ChatInput.test.jsx`. `GameMasterView.test.jsx` and `TaskCreation.test.jsx`/`TaskList.test.jsx` still pass unchanged.

- [ ] **Step 4: Rules tests**

Run: `npm run test:rules`
Expected: 17/17 pass (untouched by this feature — no rules changes).

- [ ] **Step 5: Emulator tests**

Run: `npm run test:emulator`
Expected: all pass (untouched by this feature — no `dbCalls.js`/Cloud Function changes).

- [ ] **Step 6: Production build**

Run: `CI=true npm run build`
Expected: "Compiled successfully."

- [ ] **Step 7: Confirm no dangling references**

```bash
grep -rn "TaskExecution" . --include=*.js --include=*.jsx --include=*.md 2>/dev/null
```

Expected: no results anywhere in the repo (code or docs) — Task 3 deleted the file, Task 5 didn't reintroduce the name.

- [ ] **Step 8: Final commit (if anything changed during this task)**

Only if `git status` shows changes (e.g., `npm run format` touched something in Step 1):

```bash
git add -A
git commit -m "Fix formatting caught by the final validation pass"
```
