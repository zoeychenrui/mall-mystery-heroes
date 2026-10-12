# Mission UI moves from a permanent panel to on-demand modals (improvements item 15, follow-up)

## Problem

Earlier this session, `improvements.md` item 15 ("the mission feature is
half-disconnected") was resolved by uncommenting `TaskExecution` — the
mission creation form (`TaskCreation`) and mission list (`TaskList`) — as a
permanent panel in `GameMasterView`'s right-hand column, alongside
`PhotosDisplay`.

Once actually visible, the layout didn't work: the panel pushed below the
players/logs boxes instead of sitting beside them, since `photosBox` and
`taskBox` together claimed more height than their parent had (a bug fixed
in passing), and even fixed, a permanently-visible creation form plus task
list crowds a screen that's supposed to be dominated by the kill-photo
queue during actual gameplay — missions are something a GM sets up
occasionally, not something that needs to stay on screen.

## Decisions made (confirmed with the user before this was written)

1. **Creation moves into a modal**, patterned after the existing
   `RemapPlayerModal` — a Chakra `Modal` already used in this codebase,
   opened by a game-event handler passed through `executionContext`/local
   state, not a permanently-rendered panel.
2. **A new `/mission view` command** opens a second modal to look at active
   and completed missions, replacing the permanent `TaskList` panel the
   same way.
3. **The creation modal closes automatically** once a mission is
   successfully created — not left open for creating several in a row.
4. **The view modal is read-only.** Looking at missions only; marking one
   done or closing it out stays exclusively the job of the existing
   `/mission done <player> <index>` and `/mission end <index>` commands.
   The view modal does not grow buttons for those actions.

## Components

`TaskCreation.js` and `TaskList.js` keep doing exactly what they do
today — form validation and submission, and the live active/completed
tasks subscription, respectively. Neither changes internally. Only what
renders them changes, so `TaskCreation.test.jsx` and `TaskList.test.jsx`
(written earlier this session) need no changes.

Two new components in `src/components/task_components/`:

- **`TaskCreationModal.js`** — a `Modal`/`ModalOverlay`/`ModalContent` shell
  (same Chakra pieces `RemapPlayerModal` uses) taking `isOpen`, `onClose`,
  and `handleNewTaskAdded` props, rendering `<TaskCreation />` in the
  `ModalBody` wrapped in `taskContext.Provider` with `{ handleNewTaskAdded }`
  as its value (the same context wiring that lived in `GameMasterView`'s
  JSX before this change, moved one level lower, into this component — not
  eliminated). `TaskCreationModal` itself holds no state; whether it's open
  and what happens on a successful creation are both owned by
  `GameMasterView`, same as `RemapPlayerModal` today.
- **`TaskListModal.js`** — the same shell shape, rendering `<TaskList />` in
  the `ModalBody`. No footer actions beyond a Close button (mirrors
  `RemapPlayerModal`'s footer).

`TaskExecution.js` — the component that glued `TaskCreation` and `TaskList`
into one side-by-side panel — has no remaining purpose (nothing renders
both together anymore) and is deleted.

Chakra's `Modal` does not render its children into the DOM while
`isOpen={false}` (same as `RemapPlayerModal` today), so `TaskList`'s
top-level `fetchTasksQueryForRoom` call and its `onSnapshot` subscription
only start once the view modal is actually opened, and tear down via its
existing cleanup when it closes. No new lazy-loading logic needed — this
falls out of the existing component behavior for free.

## `GameMasterView.js` changes

- Two new pieces of state: `showTaskCreationModal`, `showTaskListModal`
  (booleans, same shape as the existing `showRemapModal`).
- Two new handlers, added to `executionContextProviderValues` alongside
  `handleSetShowMessageToTrue`:
    - `handleShowMissionCreation` — sets `showTaskCreationModal` to `true`.
    - `handleShowMissionList` — sets `showTaskListModal` to `true`.
- `handleNewTaskAdded` (already exists, already called by `TaskCreation` on
  success) additionally sets `showTaskCreationModal` to `false` — this is
  the entire mechanism for "closes automatically on success." No change
  needed inside `TaskCreation.js`.
- `<TaskCreationModal isOpen={showTaskCreationModal} onClose={() =>
setShowTaskCreationModal(false)} handleNewTaskAdded={handleNewTaskAdded}
/>` and `<TaskListModal isOpen={showTaskListModal} onClose={() =>
setShowTaskListModal(false)} />` render unconditionally in the JSX (same
  pattern as `RemapPlayerModal` today) — not inside the right-hand column,
  since they no longer occupy layout space.
- The right-hand column (`rightHandStack`) goes back to containing only
  `PhotosDisplay`, at (approximately) full height — the `taskBox`/`photosBox`
  flex-split introduced by the panel restore is removed along with the
  panel.

## Command wiring (`ChatInput.js` / `src/game/commands.js`)

`/mission` is already a known top-level command with an `args[0]`
sub-switch (`done`, `end`). Two new cases join it:

```js
case 'start':
    handleShowMissionCreation();
    break;
case 'view':
    handleShowMissionList();
    break;
```

`handleShowMissionCreation`/`handleShowMissionList` are destructured from
`executionContext` alongside the switch's other handlers. Neither needs
Firestore access or roster validation — they're pure UI-state toggles — so
neither needs to sit inside the outer `try/catch` for any dbCalls-related
reason, but stays inside it anyway since it's already wrapping the whole
switch and there's no reason to carve out an exception.

No changes to `src/game/commands.js` (`KNOWN_COMMANDS`,
`UNIMPLEMENTED_COMMANDS`) — `/mission` is already known, and `start`/`view`
are sub-arguments handled entirely inside `ChatInput.js`, the same way
`done`/`end` already are.

## Testing

- **`TaskCreationModal.test.jsx`** (new): renders `TaskCreation`'s fields
  when `isOpen`, nothing when not; the Close button calls the `onClose`
  prop (`TaskCreationModal` doesn't own open/close state, so this is the
  full extent of what it can prove about closing — actually auto-closing
  after a successful creation is `GameMasterView`'s `handleNewTaskAdded`
  flipping its own state, no different in kind from its other untested
  one-line state setters like `handleAddNewTargets`); a successful task
  creation calls the `handleNewTaskAdded` prop with the new task, proving
  `TaskCreationModal` wires that prop into `taskContext` correctly (not a
  retest of `TaskCreation.test.jsx`'s own validation/dupe-check coverage,
  which stays exactly as it is).
- **`TaskListModal.test.jsx`** (new): renders `TaskList`'s content when
  open, nothing when not; the Close button calls `onClose`.
- **`ChatInput.test.jsx`**: two new cases in the existing `/mission`
  describe block — `/mission start` calls `handleShowMissionCreation`;
  `/mission view` calls `handleShowMissionList`. Both mocked handlers, same
  pattern as the file's existing `executionHandlers` mock object.
- **`GameMasterView.test.jsx`**: `TaskExecution`'s stub is replaced with
  stubs for `TaskCreationModal`/`TaskListModal` (same reasoning as the
  existing `ChatInput`/`PhotosDisplay`/`ResetTargetsButton` stubs — keeps
  this file focused on `GameMasterView`'s own logic). No new test cases
  needed here: the open-a-modal-from-a-command flow is exercised by
  `ChatInput.test.jsx` (command → handler call) and
  `TaskCreationModal.test.jsx`/`TaskListModal.test.jsx` (handler's `isOpen`
  effect → correct content) independently; wiring the same
  `executionContext` value through both is not new logic worth a third,
  harder-to-write integration test.

## Docs

- `docs/commands.md` — add `/mission start` and `/mission view` to the
  command reference, alongside the existing `/mission done`/`/mission end`
  entries.
- `docs/improvements.md` item 15 — updated to reflect that the "restored"
  panel from earlier this session was superseded by this modal-based
  design within the same session, before ever shipping in its panel form.
  The underlying restore-vs-remove decision (restore) still stands; only
  its presentation changed.
- `docs/data-model.md` — no schema changes; the `tasks` collection shape is
  untouched by this design.

## Out of scope

- Any trigger for the modals besides the two chat commands (e.g. a header
  button) — not requested.
- Making the view modal interactive (completing/closing missions from
  within it) — explicitly decided against above.
- Changing anything about `/mission done`/`/mission end`'s own logic or
  validation.
