# Player Game-Over Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the GM manually ends a game, every player's screen switches
to a game-over view (physical "return to the starting area" instruction,
top-3 standings, a "View Leaderboard" button for the full ranked list)
instead of silently continuing to show whatever it last showed.

**Architecture:** `src/pages/PlayerGame.js` already subscribes live to the
room doc; it gains a read of the room's existing `isGameActive` field and,
once that flips false, a second live subscription to the full player
roster (gated so it costs nothing during normal gameplay). Two new
presentational components render the result: `GameOverScreen` (top 3 +
button) and `LeaderboardModal` (full ranked list, opened by the button).
Ranking reuses the existing, already-tested `buildLeaderboardStandings`.

**Tech Stack:** React, Chakra UI, Firestore `onSnapshot`, Jest + Testing
Library (jsdom `dom` project) and Firestore Rules emulator tests (`rules`
project, `firebase/rules-unit-testing`).

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`, `npm test`,
  `npm run build`) must pass before any task is considered done.
- TDD: write the failing test first, per CLAUDE.md.
- The rules task's real correctness gate is `npm run test:rules` (starts
  the Firestore emulator and runs `test/**/*.rules.test.js`) — `npm test`
  does not run rules tests at all, so a green `npm test` on that task
  proves nothing about the actual change.
- No changes to `firestore.rules` — the permission this plan depends on
  already exists; only a missing test is being added.
- No changes to `src/game/leaderboard.js` or `src/components/firebase_calls/dbCalls.js`
  — `buildLeaderboardStandings` and `fetchAllPlayersQueryForRoom` already
  exist and are already used elsewhere.
- No changes to `src/pages/GameMasterView.js` or any other GM-facing file
  — out of scope per the design spec.

---

### Task 1: `LeaderboardModal` — the full ranked-list modal

**Files:**

- Create: `src/components/game_end_components/LeaderboardModal.js`
- Test: `src/components/game_end_components/LeaderboardModal.test.jsx`

**Interfaces:**

- Consumes: nothing from other tasks in this plan.
- Produces: `LeaderboardModal` — a default export, React component, props
  `{isOpen: boolean, onClose: () => void, standings: {name: string, score:
number, isAlive: boolean}[]}`. Task 2 imports and renders this directly.

- [ ] **Step 1: Write the failing tests**

Create `src/components/game_end_components/LeaderboardModal.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * LeaderboardModal is presentational: GameOverScreen owns isOpen state and
 * hands down the full standings array, already sorted by
 * buildLeaderboardStandings
 * (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeaderboardModal from './LeaderboardModal';

const onClose = jest.fn();
const standings = [
    { name: 'alice', score: 30, isAlive: true },
    { name: 'bob', score: 20, isAlive: false },
];

const mountModal = (props = {}) =>
    render(
        <ChakraProvider>
            <LeaderboardModal isOpen onClose={onClose} standings={standings} {...props} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('LeaderboardModal', () => {
    it('renders every player in standings, in order, with their score', () => {
        mountModal();

        expect(screen.getByText('1. alice — 30')).toBeInTheDocument();
        expect(screen.getByText(/2\. bob — 20/)).toBeInTheDocument();
    });

    it('marks an eliminated player as eliminated', () => {
        mountModal();

        expect(screen.getByText(/bob — 20 \(eliminated\)/)).toBeInTheDocument();
    });

    it('does not mark an alive player as eliminated', () => {
        mountModal();

        expect(screen.queryByText(/alice.*eliminated/)).not.toBeInTheDocument();
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('renders nothing when isOpen is false', () => {
        mountModal({ isOpen: false });

        expect(screen.queryByText('Leaderboard')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/components/game_end_components/LeaderboardModal.test.jsx`
Expected: FAIL — `Cannot find module './LeaderboardModal'` (the file
doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/game_end_components/LeaderboardModal.js`:

```jsx
import React from 'react';
import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Text,
    VStack,
} from '@chakra-ui/react';

// Presentational — GameOverScreen owns isOpen state and hands down the
// full standings array, already sorted by buildLeaderboardStandings
// (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
// Matches KillPhotoModal's Modal structure and dark-theme styling.
const LeaderboardModal = ({ isOpen, onClose, standings }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Leaderboard</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <VStack align="stretch" spacing={1}>
                        {standings.map((player, index) => (
                            <Text key={player.name} color={player.isAlive ? 'white' : '#b3b3b3'}>
                                {index + 1}. {player.name} — {player.score}
                                {!player.isAlive && ' (eliminated)'}
                            </Text>
                        ))}
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default LeaderboardModal;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/components/game_end_components/LeaderboardModal.test.jsx`
Expected: PASS, 5 tests.

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
git add src/components/game_end_components/LeaderboardModal.js src/components/game_end_components/LeaderboardModal.test.jsx
git commit -m "Add LeaderboardModal, the full ranked-list view for game over"
```

---

### Task 2: `GameOverScreen` — the top-3 view with a View Leaderboard button

**Files:**

- Create: `src/components/game_end_components/GameOverScreen.js`
- Test: `src/components/game_end_components/GameOverScreen.test.jsx`

**Interfaces:**

- Consumes: `LeaderboardModal` from Task 1 — default export, props
  `{isOpen, onClose, standings}`.
- Produces: `GameOverScreen` — a default export, React component, one prop
  `{standings: {name: string, score: number, isAlive: boolean}[]}`
  (already sorted descending by score). Task 3 imports and renders this
  directly.

- [ ] **Step 1: Write the failing tests**

Create `src/components/game_end_components/GameOverScreen.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * GameOverScreen is presentational: PlayerGame.js computes standings (via
 * buildLeaderboardStandings) and passes them down once the room's
 * isGameActive flips false
 * (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameOverScreen from './GameOverScreen';

const standings = [
    { name: 'alice', score: 30, isAlive: true },
    { name: 'bob', score: 20, isAlive: false },
    { name: 'carol', score: 10, isAlive: true },
    { name: 'dave', score: 5, isAlive: false },
];

const mountScreen = (props = {}) =>
    render(
        <ChakraProvider>
            <GameOverScreen standings={standings} {...props} />
        </ChakraProvider>
    );

describe('GameOverScreen', () => {
    it('shows the game-over heading and the return-to-starting-area instruction', () => {
        mountScreen();

        expect(screen.getByText('Game Over')).toBeInTheDocument();
        expect(screen.getByText('Please head back to the starting area.')).toBeInTheDocument();
    });

    it('shows only the top 3 standings', () => {
        mountScreen();

        expect(screen.getByText('1. alice — 30')).toBeInTheDocument();
        expect(screen.getByText('2. bob — 20')).toBeInTheDocument();
        expect(screen.getByText('3. carol — 10')).toBeInTheDocument();
        expect(screen.queryByText(/dave/)).not.toBeInTheDocument();
    });

    it('does not show the leaderboard modal until View Leaderboard is clicked', () => {
        mountScreen();

        expect(screen.queryByText('Leaderboard')).not.toBeInTheDocument();
    });

    it('opens the leaderboard modal, showing every player, when View Leaderboard is clicked', async () => {
        mountScreen();

        await userEvent.click(screen.getByRole('button', { name: 'View Leaderboard' }));

        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        expect(screen.getByText(/dave/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/components/game_end_components/GameOverScreen.test.jsx`
Expected: FAIL — `Cannot find module './GameOverScreen'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/game_end_components/GameOverScreen.js`:

```jsx
import React, { useState } from 'react';
import { Button, Heading, Text, VStack } from '@chakra-ui/react';
import LeaderboardModal from './LeaderboardModal';

// Shown in place of PlayerGame's normal waiting/target/eliminated states
// once the GM has ended the game. Presentational — standings is already
// sorted by buildLeaderboardStandings before it reaches here
// (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
const GameOverScreen = ({ standings }) => {
    const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
    const topThree = standings.slice(0, 3);

    return (
        <VStack align="stretch" spacing={4} mb={4}>
            <Heading size="md">Game Over</Heading>
            <Text>Please head back to the starting area.</Text>
            <VStack align="stretch" spacing={1}>
                {topThree.map((player, index) => (
                    <Text key={player.name}>
                        {index + 1}. {player.name} — {player.score}
                    </Text>
                ))}
            </VStack>
            <Button onClick={() => setIsLeaderboardOpen(true)} alignSelf="flex-start">
                View Leaderboard
            </Button>
            <LeaderboardModal
                isOpen={isLeaderboardOpen}
                onClose={() => setIsLeaderboardOpen(false)}
                standings={standings}
            />
        </VStack>
    );
};

export default GameOverScreen;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/components/game_end_components/GameOverScreen.test.jsx`
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
git add src/components/game_end_components/GameOverScreen.js src/components/game_end_components/GameOverScreen.test.jsx
git commit -m "Add GameOverScreen, the top-3 view shown when a game ends"
```

---

### Task 3: Wire `PlayerGame.js` to show `GameOverScreen` once the game has ended

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Test: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `GameOverScreen` from Task 2 (default export, prop `standings`).
  `fetchAllPlayersQueryForRoom` (already exists, `src/components/firebase_calls/dbCalls.js`
  — `(roomID: string) => CollectionReference`). `buildLeaderboardStandings`
  (already exists, `src/game/leaderboard.js` — `(players: {name, score,
isAlive}[]) => {name, score, isAlive}[]`, sorted descending by score).
- Produces: nothing new for later tasks — this is the last code task.

- [ ] **Step 1: Write the failing tests**

Open `src/pages/PlayerGame.test.jsx`. Add `fetchAllPlayersQueryForRoom` to
the existing `dbCalls` mock's import list and mock factory:

```js
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchAllPlayersQueryForRoom,
} from '../components/firebase_calls/dbCalls';
```

```js
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchRoomReferenceForRoom: jest.fn(),
    fetchPlayerReferenceForRoom: jest.fn(),
    fetchAllPlayersQueryForRoom: jest.fn(),
}));
```

Then add two new `it` blocks at the end of the `describe('PlayerGame', ...)`
block, right after the existing `'mounts the message feed even before the
game has started'` test:

```jsx
it('does not subscribe to the full roster while the game is still active', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({
                exists: () => true,
                data: () => ({ gameStarted: true, isGameActive: true }),
            });
        }
        return () => {};
    });

    renderWaiting();

    expect(fetchAllPlayersQueryForRoom).not.toHaveBeenCalled();
});

it('shows the game-over screen and hides chat once the game has ended', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    fetchAllPlayersQueryForRoom.mockReturnValue('players-query-ref');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({
                exists: () => true,
                data: () => ({ gameStarted: true, isGameActive: false }),
            });
        } else if (ref === 'players-query-ref') {
            callback({
                docs: [
                    { data: () => ({ name: 'alice', score: 10, isAlive: true }) },
                    { data: () => ({ name: 'bob', score: 5, isAlive: false }) },
                ],
            });
        }
        return () => {};
    });

    renderWaiting();

    expect(screen.getByText('Game Over')).toBeInTheDocument();
    expect(screen.getByText('Please head back to the starting area.')).toBeInTheDocument();
    expect(screen.getByText('1. alice — 10')).toBeInTheDocument();
    expect(screen.queryByText(/your target/i)).not.toBeInTheDocument();
    expect(
        screen.queryByText('message-feed-stub roomID=Fluffy42317 playerName=Alice')
    ).not.toBeInTheDocument();
    expect(
        screen.queryByText('message-composer-stub roomID=Fluffy42317 playerName=Alice targets=[]')
    ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/pages/PlayerGame.test.jsx`
Expected: FAIL — `isGameActive` is never read from the room snapshot yet,
so `PlayerGame` still renders its old three-state UI and
`fetchAllPlayersQueryForRoom` is never called; `screen.getByText('Game
Over')` throws not-found.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/pages/PlayerGame.js`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchAllPlayersQueryForRoom,
} from '../components/firebase_calls/dbCalls';
import { buildLeaderboardStandings } from '../game/leaderboard';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';
import MessageFeed from '../components/player_messages_components/MessageFeed';
import MessageComposer from '../components/player_messages_components/MessageComposer';
import GameOverScreen from '../components/game_end_components/GameOverScreen';

const PlayerGame = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const [isGameActive, setIsGameActive] = useState(true);
    const [playerData, setPlayerData] = useState(null);
    const [players, setPlayers] = useState([]);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';

    // Shared by every subscription below: a permission error or the
    // watched doc disappearing both mean this session no longer belongs
    // here (room deleted, or — for the player doc — the GM removed this
    // player from the roster), so both bounce the same way a deleted room
    // already does.
    const handleSubscriptionError = useCallback(
        (err) => {
            console.error('Error watching game state:', err);
            clearPlayerSession();
            navigate('/', { replace: true });
        },
        [navigate]
    );

    // "Leave" (below) only ends this device's local session: it does not
    // remove the player from the room's roster, touch joinedUids, or
    // affect their targets/assassins. Actually leaving a game is a
    // separate, larger feature not addressed here
    // (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(
            roomRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    clearPlayerSession();
                    navigate('/', { replace: true });
                    return;
                }
                setGameStarted(snapshot.data()?.gameStarted ?? false);
                setIsGameActive(snapshot.data()?.isGameActive ?? true);
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, navigate, handleSubscriptionError]);

    // Only starts once the game has actually begun — no need to read the
    // player's own doc while still in the waiting room, and it keeps the
    // waiting screen's read footprint unchanged from before this doc.
    useEffect(() => {
        if (!roomID || !gameStarted || !playerName) return undefined;
        const playerRef = fetchPlayerReferenceForRoom(playerName, roomID);
        const unsubscribe = onSnapshot(
            playerRef,
            (snapshot) => {
                if (!snapshot.exists()) {
                    clearPlayerSession();
                    navigate('/', { replace: true });
                    return;
                }
                setPlayerData(snapshot.data());
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, gameStarted, playerName, navigate, handleSubscriptionError]);

    // Only subscribes once the game has ended — GameOverScreen is the only
    // consumer of the full roster, so this costs nothing during normal
    // gameplay (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
    useEffect(() => {
        if (!roomID || isGameActive) return undefined;
        const playersQuery = fetchAllPlayersQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            playersQuery,
            (snapshot) => {
                setPlayers(snapshot.docs.map((doc) => doc.data()));
            },
            handleSubscriptionError
        );
        return () => unsubscribe();
    }, [roomID, isGameActive, handleSubscriptionError]);

    const handleLeave = async () => {
        try {
            await signOut(auth);
        } catch (err) {
            console.error('Error signing out:', err);
        }
        clearPlayerSession();
        navigate('/');
    };

    const standings = buildLeaderboardStandings(players);

    return (
        <Flex height="100vh" direction="column" p={4}>
            <Flex justifyContent="space-between" alignItems="center" mb={2}>
                <Heading size="md">
                    {playerName || 'You'} joined {roomID}
                </Heading>
                <Button size="sm" colorScheme="red" variant="outline" onClick={handleLeave}>
                    Leave
                </Button>
            </Flex>
            {!isGameActive && <GameOverScreen standings={standings} />}
            {isGameActive && (
                <>
                    {!gameStarted && <Text mb={4}>Waiting for the host to start...</Text>}
                    {gameStarted && playerData?.isAlive && (
                        <Text mb={4}>
                            {(playerData.targets ?? []).length > 0
                                ? `Your target: ${(playerData.targets ?? []).join(', ')}`
                                : 'Waiting for your target...'}
                        </Text>
                    )}
                    {gameStarted && playerData && !playerData.isAlive && (
                        <>
                            <Heading size="md" mb={2}>
                                You&apos;ve been eliminated
                            </Heading>
                            <Text mb={4}>
                                You may be revived if the host assigns you a revival mission.
                            </Text>
                        </>
                    )}
                    <MessageFeed roomID={roomID} playerName={playerName} />
                    <MessageComposer
                        roomID={roomID}
                        playerName={playerName}
                        targets={playerData?.targets ?? []}
                    />
                </>
            )}
        </Flex>
    );
};

export default PlayerGame;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/pages/PlayerGame.test.jsx`
Expected: PASS, all 14 tests (12 existing + 2 new).

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
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Show GameOverScreen on PlayerGame once the room isGameActive is false"
```

---

### Task 4: Pin the existing player-roster-list permission with a rules test

**Files:**

- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Consumes: nothing from other tasks in this plan — fully independent,
  can run before, after, or in parallel with Tasks 1-3.
- Produces: nothing consumed elsewhere — this task only adds test coverage
  for a permission that already exists in `firestore.rules`.

**Context:** `firestore.rules`'s `rooms/{roomId}/players/{playerId}` match
block grants `allow read: if isHostOrPlayerOfRoom(roomId);` — this already
allows a non-host player to query (`list`) the entire `players`
subcollection, not just `get` their own doc, but no existing test in
`test/firestore.rules.test.js` exercises that `list` shape. Task 3's new
`fetchAllPlayersQueryForRoom` subscription in `PlayerGame.js` is the first
client code to actually depend on it. This task adds the missing test; it
does **not** change `firestore.rules` itself.

- [ ] **Step 1: Write the failing test**

Open `test/firestore.rules.test.js`. Inside the existing
`describe('rooms/{roomId}/players/{playerId}', ...)` block (find it by its
existing `'allows a player who has joined this room to read the roster'`
test), add a new test immediately after that one and before `'denies a
non-host write'`:

```js
it('allows a player who has joined this room to list the full players collection', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    const snapshot = await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'players')));
    expect(snapshot.docs.map((d) => d.id).sort()).toEqual(['alice', 'bob']);
});
```

(`getDocs` and `collection` are already imported at the top of this file —
no new imports needed. `room-a`'s seeded players, `alice` and `bob`, are
set up in the file's existing `beforeEach`.)

- [ ] **Step 2: Run the test to verify it fails, then verify it passes**

This test is expected to PASS immediately — the permission it exercises
already exists in `firestore.rules`; there is no implementation step for
this task. Confirm this directly instead of expecting a red-then-green
cycle:

Run: `npm run test:rules`
Expected: PASS, including the new test — this is intentional confirmation
that the grant `PlayerGame.js`'s new subscription (Task 3) depends on is
real, not an assumption. If this test unexpectedly FAILS, stop and report
it — it means `firestore.rules` does not actually grant what this plan
assumed, and Task 3's new subscription needs to be revisited before this
plan can be considered complete.

- [ ] **Step 3: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
npm run test:rules
```

All five must pass. (`npm test` will not exercise this task's change at
all — `npm run test:rules` is this task's real correctness gate, per the
Global Constraints above.)

- [ ] **Step 4: Commit**

```bash
git add test/firestore.rules.test.js
git commit -m "Add rules test pinning that a player can list the full players collection"
```

---

## Self-Review Notes

- **Spec coverage:** No-navigation/same-route behavior → Task 3 (no route
  change, `PlayerGame.js` stays mounted). Score-based ranking via
  `buildLeaderboardStandings` → Task 3 (`standings` derivation) consumed
  by Task 2. GM console untouched → no task touches `GameMasterView.js`.
  "View Leaderboard" as a modal → Task 1. Chat/composer hidden once
  ended → Task 3's render precedence. Rules test for the pre-existing
  roster-list grant → Task 4.
- **Placeholder scan:** none found — every step has complete code or an
  explicit run command with an expected result.
- **Type consistency:** `standings` is `{name, score, isAlive}[]` in the
  spec, in `buildLeaderboardStandings`'s existing implementation, in
  `GameOverScreen`'s prop usage, and in `LeaderboardModal`'s prop usage —
  consistent across all three. `GameOverScreen`'s only prop is `standings`
  everywhere it's referenced (Task 2's produce, Task 3's consume).
