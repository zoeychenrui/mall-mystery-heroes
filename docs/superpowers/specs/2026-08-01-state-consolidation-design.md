# State consolidation: players and logs (improvements items 13 + 22)

## Problem

`GameMasterView` keeps its own player and log state, fetched once on mount and
mutated optimistically by handler functions, while `PlayersList` and
`PhotosDisplay` subscribe live via `onSnapshot`. These disagree:

- The header's `Players (N)` count comes from React Router state
  (`useLocation().state.arrayOfPlayers`), frozen at the moment `Lobby`
  navigated to `GameMasterView`. A reload loses it (`Players (0)`).
- `GameMasterView`'s `arrayOfAlivePlayers` is fetched once and then mutated by
  hand inside `handleKillPlayer`/`handlePlayerRevive`. It feeds
  `ResetTargetsButton`. A second GM's actions in another tab are invisible to
  it until reload.
- `PlayersList` independently subscribes to the same underlying player data
  `GameMasterView` is trying to track by hand, one level down in the tree.
- `logs` lives as an array field on the room document, written via
  `arrayUnion` and re-fetched/appended locally by `GameMasterView.addLog`.
  Firestore caps documents at 1 MiB and rewrites the whole document per
  message; `arrayUnion` also silently drops two messages with identical
  `{time, log, color}` (deep-equality dedup), which can genuinely happen
  within the same second.

Investigation found the actual scope narrower than the backlog's own
description: `arrayOfDeadPlayers`, `arrayOfTasks`, and `completedTasks` are
write-only in `GameMasterView` today — set but never read (the task ones feed
a commented-out mission panel, item 15's territory, untouched here).
`arrayOfAlivePlayers` and `logList` are the two pieces of state that are
actually read and rendered, and are the two this design fixes.

## Design

### Players

`GameMasterView` subscribes via `onSnapshot` to
`fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID)` — the same query
`PlayersList` already uses — and holds the result as its only player state:

```js
const [players, setPlayers] = useState([]);
```

Everything else is derived inline, no separate state:

- Header count: `players.length`
- `ResetTargetsButton`'s roster: `players.filter((p) => p.isAlive).map((p) => p.name)`

`PlayersList` stops subscribing itself and becomes presentational — it takes
`players` as a prop and keeps its existing per-player rendering logic
(color by `isAlive`/`openSeason`) unchanged.

`handleKillPlayer` and `handlePlayerRevive` drop their manual
`setArrayOfAlivePlayers`/`setArrayOfDeadPlayers` calls — the subscription
re-renders once the underlying write (already happening elsewhere: kills go
through `executeKill`, revives call `updateIsAliveForPlayer`) lands.
`PhotosDisplay.handleUndo` drops the same two calls for the same reason.
`setArrayOfAlivePlayers`/`setArrayOfDeadPlayers` are removed from
`executionContextProviderValues` entirely — nothing needs to set them once
they don't exist as state.

`handleUndoRevive` is deleted, not ported. It has zero live callers today
(already `eslint-disable`d in the source as "never wired to any UI") and its
entire body manipulated the local player-array state this design removes.
Porting dead code to a pattern it will never exercise isn't useful; deleting
it removes the now-also-unused `UnmapPlayers()` import/call in
`GameMasterView` (its only caller).

`Lobby.js` stops passing `arrayOfPlayers` via router `navigate` state to
`GameMasterView` — nothing reads it anymore.

**Alternatives considered:** Keeping `PlayersList`'s subscription and adding
a second one in `GameMasterView` was rejected — two live listeners on the
same query double the reads for no benefit and don't collapse "three
sources" into one. A shared context/hook (`usePlayers(roomID)`) was
rejected as more machinery than the three consumers (`GameMasterView`,
`PlayersList`, `ResetTargetsButton` via prop) justify right now; no other
context in this codebase wraps a subscription like this yet, and adding one
for three consumers is premature.

### Logs

`logs` moves from an array field on the room document to a
`rooms/{roomID}/logs/{autoId}` subcollection, mirroring `photos`'s existing
shape: `time` (display string, unchanged — `Log.js` needs zero changes),
`log`, `color`, plus a `timestamp: serverTimestamp()` field used only for
`orderBy`, matching `fetchPhotosQueryByAscendingTimestampForRoom`'s pattern
exactly.

New `dbCalls.js` functions:

```js
export const fetchLogsQueryByAscendingTimestampForRoom = (roomID) => {
    const logsCollectionRef = collection(db, 'rooms', roomID, 'logs');
    return query(logsCollectionRef, orderBy('timestamp', 'asc'));
};

export const addLogForRoom = async (newLog, color, roomID) => {
    const logsCollectionRef = collection(db, 'rooms', roomID, 'logs');
    await addDoc(logsCollectionRef, {
        time: new Date().toLocaleTimeString(),
        log: newLog,
        color,
        timestamp: serverTimestamp(),
    });
};
```

`addLogForRoom` replaces `updateLogsForRoom` — renamed, not just
reimplemented, because an `addDoc` into a subcollection isn't an "update" in
this codebase's naming convention (`add…For…` = creates a new document,
matching `addPlayerForRoom`/`addTaskForRoom`; `update…For…` = writes to an
existing one). It returns nothing — nothing needs the written entry back,
since the subscription is what updates the UI now. `fetchAllLogsForRoom`
(one-time array read) is deleted; nothing calls it once `GameMasterView`
subscribes instead.

`GameMasterView.addLog` becomes:

```js
const addLog = async (newLog, color) => {
    try {
        await addLogForRoom(newLog, color, roomID);
    } catch (error) {
        console.error('Error adding log: ', error);
        createAlert('warning', 'Log not saved', error.message, 1500);
    }
};
```

No `setLogList` — the `logs` subcollection subscription updates `Log.js`'s
input automatically once the write lands, the same way `PhotosDisplay`
already gets this for free from its own subscription.

**No migration path for existing `logs` array data.** A "room" in this app is
a fresh per-game object — hosting a new game always creates a new room ID
(`DashBoard.handleHostRoom`) — so there's no long-lived room whose history
needs preserving across this schema change. `DashBoard.js`'s room-creation
write drops the now-pointless `logs: []` field it currently writes (same
reasoning as the `hostId`/`isGameActive` dead-field cleanup in item 14);
`test/emulatorHelpers.js`'s `seedRoom` and `test/firestore.rules.test.js`'s
seed data drop it too.

### `firestore.rules`

A new `logs/{logId}` match block, identical in shape to the existing
`tasks`/`players` blocks (host-only write, any signed-in read) — required,
since rules deny by default and there is currently no rule matching this new
subcollection path at all:

```
match /logs/{logId} {
  allow read: if isSignedIn();
  allow write: if isHostOfExistingRoom(roomId);
}
```

## Testing

- **`src/game/`**: no new pure module. The only derivations
  (`players.length`, `players.filter(...).map(...)`) are one-liners with no
  branching worth extracting and separately unit-testing — matches this
  codebase's existing bar for what goes in `src/game/` (game rules and
  parsing, not trivial data reshapes).
- **`PlayersList.test.jsx`** (new): now presentational, testable with a
  `players` prop and zero Firestore mocking — asserts rendering (name,
  score, target list) and the `isAlive`/`openSeason` color logic.
- **`GameMasterView.test.jsx`** (new): mocks `onSnapshot` the same way
  `PhotosDisplay.test.jsx` does, to pin the header count and the alive-roster
  list passed to `ResetTargetsButton` deriving correctly from a mocked
  snapshot — this is what the standing `CLAUDE.md` warning against
  "component tests asserting game-state outcomes" was blocking on.
- **`dbCalls.integration.test.js`**: new tests for `addLogForRoom` (writes a
  doc with the right fields) and `fetchLogsQueryByAscendingTimestampForRoom`
  (returns entries in ascending timestamp order) against the emulator.
- **`test/firestore.rules.test.js`**: new block for `rooms/{roomId}/logs`,
  mirroring the existing `tasks` block (denies unauthenticated read, denies
  non-host write, allows host write).

## Out of scope

- `arrayOfTasks`/`completedTasks` — write-only, feed the commented-out
  mission panel (item 15). Left exactly as-is.
- The redundant `updateIsAliveForPlayer` call in `ChatInput.js`'s `/revive`
  and `/mission done` revival branches (both call it directly, then also
  call `handlePlayerRevive`, which — before this change — called it again).
  Harmless (idempotent) and pre-existing, unrelated to the three-sources
  bug. Not touched here.
- `handleNewTaskAdded` — also dead (its `taskContext.Provider` is inside
  commented-out JSX), but that's item 15's territory, not this one's.
