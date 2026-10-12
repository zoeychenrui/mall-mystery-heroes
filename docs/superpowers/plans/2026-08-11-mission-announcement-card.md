# New-mission announcement card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new mission shows up in players' chat feed as a "New Mission!" card (title, description, type, points, participant limit) instead of a plain "Added new task: X" text line.

**Architecture:** A new `playerMessages` type, `'mission'`, carries a `mission: {title, description, taskType, pointValue, maxCompletions}` field — the same pattern the existing `'leaderboard'` type already uses for its `standings` field. `MessageFeed.js` gets a new render branch for it. `GameMasterView.js`'s `handleNewTaskAdded` sends this shape instead of its current plain-text broadcast; its `addLog` call (the GM's own console) is untouched.

**Tech Stack:** React (CRA), Firebase Firestore client SDK, Jest + React Testing Library (jsdom project).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`).
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js`.
- Write the test first and watch it fail, for every behavioral change.
- Mission-creation only — completion/end broadcasts stay plain text (`docs/superpowers/specs/2026-08-11-mission-announcement-card-design.md`, "Decisions made").
- The new structured message _replaces_ the current plain-text broadcast for mission creation, not both. `handleNewTaskAdded`'s `addLog` call (the GM's own console log) must stay byte-for-byte unchanged.
- Follow `addLog`/`broadcast`'s existing error-isolation pattern (`GameMasterView.js`) — a failed player-facing write must never block or fail the primary action, same reasoning as those two existing helpers.

---

## Task 1: `MessageFeed` — render a `'mission'` message as a card

**Files:**

- Modify: `src/components/player_messages_components/MessageFeed.js`
- Modify: `src/components/player_messages_components/MessageFeed.test.jsx`

**Interfaces:**

- Consumes: `messages` state (existing).
- Produces: nothing new consumed elsewhere — a render-only branch, sibling to the existing `'leaderboard'` branch.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/player_messages_components/MessageFeed.test.jsx`, inside the `describe('MessageFeed', ...)` block:

```jsx
it('renders a mission message as a "New Mission!" card with unlimited participants', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'mission',
                    recipient: null,
                    text: null,
                    standings: null,
                    mission: {
                        title: 'Find the clue',
                        description: 'Look under the food court table',
                        taskType: 'Task',
                        pointValue: '10',
                        maxCompletions: null,
                    },
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(screen.getByText('New Mission!')).toBeInTheDocument();
    expect(screen.getByText('Find the clue')).toBeInTheDocument();
    expect(screen.getByText('Look under the food court table')).toBeInTheDocument();
    expect(screen.getByText('Task · 10 points · Unlimited players')).toBeInTheDocument();
});

it('renders a mission message with a participant limit', () => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({
            docs: asMessageDocs([
                {
                    type: 'mission',
                    recipient: null,
                    text: null,
                    standings: null,
                    mission: {
                        title: 'Revive a fallen hero',
                        description: 'Say the secret phrase',
                        taskType: 'Revival Mission',
                        pointValue: 0,
                        maxCompletions: 3,
                    },
                },
            ]),
        });
        return () => {};
    });

    mountFeed();

    expect(
        screen.getByText('Revival Mission · 0 points · Limited to 3 players')
    ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: FAIL — neither `'New Mission!'` nor the details line exists yet; a `'mission'`-type message currently falls into the default (`whisper`/`broadcast`) text branch and renders `message.text`, which is `null`.

- [ ] **Step 3: Implement**

In `src/components/player_messages_components/MessageFeed.js`, replace:

```jsx
{
    message.type === 'leaderboard' ? (
        <Box bg="gray.700" borderRadius="md" p={2}>
            <Text fontWeight="bold" mb={1}>
                Leaderboard
            </Text>
            <List styleType="none">
                {(message.standings ?? []).map((entry) => (
                    <ListItem key={entry.name}>
                        {entry.name}: {entry.score}
                        {!entry.isAlive ? ' (eliminated)' : ''}
                    </ListItem>
                ))}
            </List>
        </Box>
    ) : (
        <Text
            bg={message.type === 'whisper' ? 'whiteAlpha.100' : 'gray.700'}
            border={message.type === 'whisper' ? '1px dashed' : undefined}
            borderColor={message.type === 'whisper' ? 'gray.400' : undefined}
            borderRadius="md"
            p={2}
            display="inline-block"
        >
            <Text as="span">{message.text}</Text>
        </Text>
    );
}
```

with:

```jsx
{
    message.type === 'leaderboard' ? (
        <Box bg="gray.700" borderRadius="md" p={2}>
            <Text fontWeight="bold" mb={1}>
                Leaderboard
            </Text>
            <List styleType="none">
                {(message.standings ?? []).map((entry) => (
                    <ListItem key={entry.name}>
                        {entry.name}: {entry.score}
                        {!entry.isAlive ? ' (eliminated)' : ''}
                    </ListItem>
                ))}
            </List>
        </Box>
    ) : message.type === 'mission' ? (
        <Box bg="gray.700" borderRadius="md" p={2}>
            <Text fontWeight="bold" mb={1}>
                New Mission!
            </Text>
            <Text fontWeight="semibold">{message.mission.title}</Text>
            <Text mb={1}>{message.mission.description}</Text>
            <Text fontSize="sm" color="gray.400">
                {message.mission.taskType} · {message.mission.pointValue} points ·{' '}
                {message.mission.maxCompletions
                    ? `Limited to ${message.mission.maxCompletions} players`
                    : 'Unlimited players'}
            </Text>
        </Box>
    ) : (
        <Text
            bg={message.type === 'whisper' ? 'whiteAlpha.100' : 'gray.700'}
            border={message.type === 'whisper' ? '1px dashed' : undefined}
            borderColor={message.type === 'whisper' ? 'gray.400' : undefined}
            borderRadius="md"
            p={2}
            display="inline-block"
        >
            <Text as="span">{message.text}</Text>
        </Text>
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=MessageFeed`
Expected: PASS, both new tests plus all 7 pre-existing `MessageFeed` tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageFeed.js src/components/player_messages_components/MessageFeed.test.jsx
git commit -m "Render mission-creation broadcasts as a New Mission! card"
```

---

## Task 2: `handleNewTaskAdded` sends the structured mission message

**Files:**

- Modify: `src/pages/GameMasterView.js`
- Modify: `src/pages/GameMasterView.test.jsx`

**Interfaces:**

- Consumes: `addPlayerMessageForRoom` (already imported), the `'mission'` render branch (Task 1, exercised via a real Firestore write here, not directly).
- Produces: nothing new consumed elsewhere — this is the plan's final code task.

- [ ] **Step 1: Write the failing test**

In `src/pages/GameMasterView.test.jsx`, replace the existing test `'broadcasts a new mission being added'` (currently asserting the old plain-text shape) with:

```jsx
it('broadcasts a new mission being added as a structured mission message', async () => {
    mockPlayersSnapshot([]);

    mountGameMasterView();

    await act(async () => {
        await capturedExecutionContext.handleNewTaskAdded({
            title: 'Find the clue',
            description: 'Look under the food court table',
            taskType: 'Task',
            pointValue: '10',
            maxCompletions: null,
        });
    });

    expect(addLogForRoom).toHaveBeenCalledWith(
        'Added new task: Find the clue',
        'yellow.400',
        'room-a'
    );
    expect(addPlayerMessageForRoom).toHaveBeenCalledWith(
        {
            type: 'mission',
            recipient: null,
            text: null,
            standings: null,
            mission: {
                title: 'Find the clue',
                description: 'Look under the food court table',
                taskType: 'Task',
                pointValue: '10',
                maxCompletions: null,
            },
        },
        'room-a'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: FAIL — `handleNewTaskAdded` still calls `broadcast('Added new task: ' + newTask.title)`, so `addPlayerMessageForRoom` is called with the old `{ type: 'broadcast', ... text: 'Added new task: Find the clue' ... }` shape, not the new `'mission'` shape.

- [ ] **Step 3: Implement**

In `src/pages/GameMasterView.js`, add a second broadcast helper as a sibling to `broadcast` (right after it, before `handleKillPlayer`):

```js
// Sibling to broadcast(text) above, same error-isolation reasoning — this
// one carries structured mission data instead of free text (see the
// 'mission' render branch in MessageFeed.js).
const broadcastMission = async (mission) => {
    try {
        await addPlayerMessageForRoom(
            { type: 'mission', recipient: null, text: null, standings: null, mission },
            roomID
        );
    } catch (error) {
        console.error('Error broadcasting to players: ', error);
    }
};
```

Replace `handleNewTaskAdded`:

```js
const handleNewTaskAdded = async (newTask) => {
    setShowTaskCreationModal(false);
    await addLog('Added new task: ' + newTask.title, 'yellow.400');
    await broadcastMission({
        title: newTask.title,
        description: newTask.description,
        taskType: newTask.taskType,
        pointValue: newTask.pointValue,
        maxCompletions: newTask.maxCompletions,
    });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=GameMasterView`
Expected: PASS, the amended test plus every other test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameMasterView.js src/pages/GameMasterView.test.jsx
git commit -m "Send a structured mission message when a mission is created"
```

---

## Task 3: Docs and final gate

**Files:**

- Modify: `docs/data-model.md`
- Modify: `docs/testing.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — documentation only.

- [ ] **Step 1: Update `docs/data-model.md`**

Find the `## rooms/{roomID}/playerMessages/{autoId}` section's field table (it currently lists `type`, `recipient`, `text`, `standings`, `timestamp`). Add a `mission` row:

| Field     | Type                                                                 | Notes                                                                                                                                 |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mission` | `{title, description, taskType, pointValue, maxCompletions} \| null` | Populated only for `type: 'mission'` — a new mission's full detail card, sent when the GM creates one. `null` for every other `type`. |

Also update the `type` row's notes (currently listing `'whisper' \| 'broadcast' \| 'leaderboard'`) to include `'mission'` in the enumerated values.

- [ ] **Step 2: Update `docs/testing.md`**

Run the real suite and copy its actual output — do not hand-type counts:

```bash
npx jest --selectProjects unit dom
```

Update the illustrative `$ npm test` block and the `MessageFeed.test.jsx`/`GameMasterView.test.jsx` module-table rows (mentioning the new mission-card coverage) with this run's real counts, and update the doc's total suite/test counts to match.

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
git add docs/data-model.md docs/testing.md
git commit -m "Document the mission-announcement card"
```
