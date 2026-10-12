# Join-Flow UI and Room-Scoping Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the actual player-facing join flow (Homepage's Host/Join split, the game-ID+name join form with invisible guest auth, a minimal post-join waiting screen, and localStorage session persistence), and close the security gap that currently lets any signed-in user read any room's data regardless of whether they've joined it.

**Architecture:** Four new/relocated pages (`Homepage` modified, `Host`, `JoinGame`, `PlayerWaiting`, all new routes in `App.js`), one new pure utility (`src/utils/playerSession.js`) shared by three of those pages, a two-field addition to the data model (`joinedUids` on the room doc, `uid` on the player doc) written by `joinRoom`, and a `firestore.rules` change that scopes every room-level read to "host or player of this room" instead of "any signed-in user." `RETENTION_DAYS` (built in the prior plan, currently a no-op) flips to `1`.

**Tech Stack:** React (Create React App), Firebase Auth/Firestore/Functions, Chakra UI, Jest, React Testing Library.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md`. Its "Decisions made" and "Out of scope" sections bind every task below.
- 4-space indentation, Prettier-formatted (`npm run format`), ESLint clean (`npm run lint` from the repo root; `functions/` has its own `npm run lint` too — run both for any task touching `functions/`).
- TDD throughout: write the failing test, confirm it fails for the right reason, implement, confirm it passes.
- Never import `dbCalls.js` or `utils/firebase.js` into a `.test.js`/`.test.jsx` unit/component test — explicit mock factories only. This does **not** apply to `.integration.test.js` files (which are expected to import the real data layer), and does not apply to `src/utils/playerSession.js` (Task 1) — it touches neither Firebase module, so importing the real thing in its tests and in consumers' tests is safe and expected.
- Cloud Functions (`functions/callableFunctions/*.js`, `functions/scheduledFunctions/*.js`) are CommonJS (`require`/`module.exports`/`exports.x =`), matching `killPlayer.js` and `joinRoom.js` — not ES modules.
- Run the full gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) before any commit. Run `npm run test:emulator` after Task 4 (it modifies `joinRoom.integration.test.js`) and once more at the end (Task 9). Run `npm run test:rules` after Task 4 (it modifies `test/firestore.rules.test.js`) and once more at the end.

---

## File Structure

- **Create** `src/utils/playerSession.js` — pure `localStorage` read/write/clear helper, injectable storage parameter so it's testable under the `unit` (node) project.
- **Create** `src/utils/playerSession.test.js` — its unit tests.
- **Modify** `src/pages/Homepage.js` — "Host Game" / "Join Game" buttons; redirects to the waiting screen on mount if a player session is already stored.
- **Create** `src/pages/Homepage.test.jsx` — cover it.
- **Create** `src/pages/Host.js` — "Log In" / "Sign Up" buttons (today's `Homepage.js` content, relocated).
- **Create** `src/pages/Host.test.jsx` — cover it.
- **Modify** `functions/callableFunctions/joinRoom.js` — writes `uid` on the new player doc and appends to `joinedUids` on the room doc.
- **Modify** `src/pages/DashBoard.js` — room-creation write gains `joinedUids: []`.
- **Modify** `firestore.rules` — adds `isPlayerOfRoom`/`isHostOrPlayerOfRoom`; every subcollection's `allow read` tightens to it.
- **Modify** `test/firestore.rules.test.js` — full rewrite: new seed player/room-scoping, flips the "any signed-in user can read" assertion, adds player-of-room cases to every subcollection.
- **Modify** `src/components/joinRoom.integration.test.js` — asserts the new `uid`/`joinedUids` writes.
- **Create** `src/pages/JoinGame.js` — the join form.
- **Create** `src/pages/JoinGame.test.jsx` — cover it.
- **Create** `src/pages/PlayerWaiting.js` — the post-join waiting screen.
- **Create** `src/pages/PlayerWaiting.test.jsx` — cover it.
- **Modify** `src/App.js` — adds `/host`, `/join`, `/rooms/:roomID/waiting` routes.
- **Modify** `functions/scheduledFunctions/cleanupEndedRooms.js` — `RETENTION_DAYS` changes from `null` to `1`.
- **Modify** `docs/data-model.md`, `docs/architecture.md`, `docs/testing.md` — reflect all of the above.

---

### Task 1: `src/utils/playerSession.js` — the shared session utility

**Files:**

- Create: `src/utils/playerSession.js`
- Create: `src/utils/playerSession.test.js`

**Interfaces:**

- Produces: `readPlayerSession(storage?) => { roomID: string, playerName: string } | null`, `writePlayerSession(roomID, playerName, storage?) => void`, `clearPlayerSession(storage?) => void`. `storage` defaults to `window.localStorage` when omitted — every caller in Tasks 2, 5, and 6 calls these with no `storage` argument, relying on that default. The `localStorage` key is `mmh:player-session`, not exported (an implementation detail; no consumer needs it directly).

- [ ] **Step 1: Write the failing test**

Create `src/utils/playerSession.test.js`:

```js
import { readPlayerSession, writePlayerSession, clearPlayerSession } from './playerSession';

// A minimal in-memory stand-in for the Storage interface, passed explicitly
// so these tests run under the `unit` project (node, no DOM) rather than
// needing jsdom's real `localStorage` — the same "inject rather than reach
// for a global" precedent CLAUDE.md already establishes for `Math.random()`
// in src/game/.
const createFakeStorage = () => {
    const store = {};
    return {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => {
            store[key] = value;
        },
        removeItem: (key) => {
            delete store[key];
        },
    };
};

describe('playerSession', () => {
    it('returns null when nothing is stored', () => {
        expect(readPlayerSession(createFakeStorage())).toBeNull();
    });

    it('round-trips a written session', () => {
        const storage = createFakeStorage();
        writePlayerSession('Fluffy42317', 'Alice', storage);

        expect(readPlayerSession(storage)).toEqual({
            roomID: 'Fluffy42317',
            playerName: 'Alice',
        });
    });

    it('clears a stored session', () => {
        const storage = createFakeStorage();
        writePlayerSession('Fluffy42317', 'Alice', storage);
        clearPlayerSession(storage);

        expect(readPlayerSession(storage)).toBeNull();
    });

    it('returns null for malformed JSON instead of throwing', () => {
        const storage = createFakeStorage();
        storage.setItem('mmh:player-session', 'not valid json{{{');

        expect(readPlayerSession(storage)).toBeNull();
    });

    it('returns null when the stored value is missing expected fields', () => {
        const storage = createFakeStorage();
        storage.setItem('mmh:player-session', JSON.stringify({ roomID: 'Fluffy42317' }));

        expect(readPlayerSession(storage)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit --testPathPattern=playerSession`
Expected: FAIL — `Cannot find module './playerSession'`.

- [ ] **Step 3: Implement**

Create `src/utils/playerSession.js`:

```js
// A small localStorage wrapper for remembering "I'm <name> in room <id>"
// across tab closes
// (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
// The storage backend is an injectable parameter, not read from `window`
// internally, so this stays testable under the `unit` (node, no DOM)
// project rather than requiring jsdom.
const PLAYER_SESSION_KEY = 'mmh:player-session';

export const readPlayerSession = (storage = window.localStorage) => {
    const stored = storage.getItem(PLAYER_SESSION_KEY);
    if (!stored) return null;
    try {
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed.roomID !== 'string' || typeof parsed.playerName !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
};

export const writePlayerSession = (roomID, playerName, storage = window.localStorage) => {
    storage.setItem(PLAYER_SESSION_KEY, JSON.stringify({ roomID, playerName }));
};

export const clearPlayerSession = (storage = window.localStorage) => {
    storage.removeItem(PLAYER_SESSION_KEY);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit --testPathPattern=playerSession`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/utils/playerSession.js src/utils/playerSession.test.js
git commit -m "Add playerSession: localStorage helper for player join persistence"
```

---

### Task 2: `Homepage.js` — Host Game / Join Game

**Files:**

- Modify: `src/pages/Homepage.js`
- Create: `src/pages/Homepage.test.jsx`

**Interfaces:**

- Consumes: `readPlayerSession` (Task 1).
- Produces: nothing new consumed by later tasks — `/host` and `/join` are plain `navigate()` calls, not a shared interface.

Current `src/pages/Homepage.js` (for reference — Step 3 replaces this entirely):

```js
import React from 'react';
import { Button, Stack, Image, Box, Flex, Divider } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/mall-logo-white-2.png';

const Homepage = () => {
    const navigate = useNavigate();

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center">
            <Flex direction="row" alignItems="center" justifyContent="center">
                <Stack direction="column" alignItems="center" textAlign="center">
                    <Image
                        src={logo}
                        maxWidth="300px"
                        maxHeight="300px"
                        alt="logo white"
                        mb={5} // Adds margin bottom to the Image
                    />
                </Stack>
                <Divider orientation="vertical" height="440px" mx={8} />
                <Box textAlign="center">
                    <Stack direction="column" spacing={4}>
                        <Button
                            colorScheme="teal"
                            variant="solid"
                            onClick={() => navigate('/login')}
                        >
                            Log In
                        </Button>
                        <Button
                            colorScheme="teal"
                            variant="outline"
                            onClick={() => navigate('/signup')}
                        >
                            Sign Up
                        </Button>
                    </Stack>
                </Box>
            </Flex>
        </Flex>
    );
};

export default Homepage;
```

- [ ] **Step 1: Write the failing test**

Create `src/pages/Homepage.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the Host Game / Join Game buttons and the localStorage
 * redirect-on-mount for a returning player
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * No mocks needed: playerSession.js touches only real (jsdom-provided)
 * localStorage, not Firebase.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Homepage from './Homepage';
import { writePlayerSession } from '../utils/playerSession';

const renderHomepage = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Homepage />} />
                    <Route path="/host" element={<div>Host page</div>} />
                    <Route path="/join" element={<div>Join page</div>} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    localStorage.clear();
});

describe('Homepage', () => {
    it('shows Host Game and Join Game buttons when no session is stored', () => {
        renderHomepage();

        expect(screen.getByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
    });

    it('navigates to /host when Host Game is clicked', async () => {
        renderHomepage();

        await userEvent.click(screen.getByRole('button', { name: 'Host Game' }));

        expect(screen.getByText('Host page')).toBeInTheDocument();
    });

    it('navigates to /join when Join Game is clicked', async () => {
        renderHomepage();

        await userEvent.click(screen.getByRole('button', { name: 'Join Game' }));

        expect(screen.getByText('Join page')).toBeInTheDocument();
    });

    it('redirects straight to the waiting screen when a player session is already stored', () => {
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByText('Waiting page')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Host Game' })).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=Homepage`
Expected: FAIL — `Unable to find role="button" with name "Host Game"` (current `Homepage.js` still renders "Log In"/"Sign Up").

- [ ] **Step 3: Implement**

Replace the full contents of `src/pages/Homepage.js`:

```jsx
import React, { useEffect } from 'react';
import { Button, Stack, Image, Flex } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/mall-logo-white-2.png';
import { readPlayerSession } from '../utils/playerSession';

const Homepage = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const session = readPlayerSession();
        if (session) {
            navigate(`/rooms/${session.roomID}/waiting`, { replace: true });
        }
    }, [navigate]);

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>
            <Image src={logo} maxWidth="250px" maxHeight="250px" alt="logo white" mb={8} />
            <Stack direction="column" spacing={4} width="100%" maxWidth="320px">
                <Button colorScheme="teal" variant="solid" onClick={() => navigate('/host')}>
                    Host Game
                </Button>
                <Button colorScheme="teal" variant="outline" onClick={() => navigate('/join')}>
                    Join Game
                </Button>
            </Stack>
        </Flex>
    );
};

export default Homepage;
```

This also drops the old two-column desktop layout (logo | divider | buttons) for a single centered column — it renders reasonably at any viewport width, satisfying the "player-facing pages must be mobile-first responsive" requirement without needing viewport-specific styling.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=Homepage`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Homepage.js src/pages/Homepage.test.jsx
git commit -m "Redesign Homepage: Host Game / Join Game, with returning-player redirect"
```

---

### Task 3: `Host.js` — the relocated Log In / Sign Up screen

**Files:**

- Create: `src/pages/Host.js`
- Create: `src/pages/Host.test.jsx`
- Modify: `src/App.js`

**Interfaces:** None consumed by later tasks — self-contained.

- [ ] **Step 1: Write the failing test**

Create `src/pages/Host.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the /host screen: today's old Homepage.js content, relocated one
 * level in behind the new "Host Game" button
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Host from './Host';

const renderHost = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/host']}>
                <Routes>
                    <Route path="/host" element={<Host />} />
                    <Route path="/login" element={<div>Login page</div>} />
                    <Route path="/signup" element={<div>Signup page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

describe('Host', () => {
    it('navigates to /login when Log In is clicked', async () => {
        renderHost();

        await userEvent.click(screen.getByRole('button', { name: 'Log In' }));

        expect(screen.getByText('Login page')).toBeInTheDocument();
    });

    it('navigates to /signup when Sign Up is clicked', async () => {
        renderHost();

        await userEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

        expect(screen.getByText('Signup page')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=Host.test`
Expected: FAIL — `Cannot find module './Host'`.

- [ ] **Step 3: Implement**

Create `src/pages/Host.js` — the exact content `Homepage.js` had before Task 2:

```jsx
import React from 'react';
import { Button, Stack, Image, Box, Flex, Divider } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/mall-logo-white-2.png';

const Host = () => {
    const navigate = useNavigate();

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center">
            <Flex direction="row" alignItems="center" justifyContent="center">
                <Stack direction="column" alignItems="center" textAlign="center">
                    <Image src={logo} maxWidth="300px" maxHeight="300px" alt="logo white" mb={5} />
                </Stack>
                <Divider orientation="vertical" height="440px" mx={8} />
                <Box textAlign="center">
                    <Stack direction="column" spacing={4}>
                        <Button
                            colorScheme="teal"
                            variant="solid"
                            onClick={() => navigate('/login')}
                        >
                            Log In
                        </Button>
                        <Button
                            colorScheme="teal"
                            variant="outline"
                            onClick={() => navigate('/signup')}
                        >
                            Sign Up
                        </Button>
                    </Stack>
                </Box>
            </Flex>
        </Flex>
    );
};

export default Host;
```

In `src/App.js`, add the import and route. Add the import alongside the other page imports (alphabetical order, matching the existing list):

```js
import Host from './pages/Host';
```

Add the route between `/` and `/dashboard` (order doesn't affect behavior, but keeps the file's top-to-bottom route list roughly matching the user flow):

```jsx
<Route path="/" element={<Homepage />} />
<Route path="/host" element={<Host />} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=Host.test`
Expected: PASS, both tests.

- [ ] **Step 5: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Host.js src/pages/Host.test.jsx src/App.js
git commit -m "Add /host: relocated Log In / Sign Up screen"
```

---

### Task 4: Room-scoping security fix

**Files:**

- Modify: `functions/callableFunctions/joinRoom.js`
- Modify: `src/pages/DashBoard.js`
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`
- Modify: `src/components/joinRoom.integration.test.js`

**Interfaces:**

- Produces: `rooms/{roomID}.joinedUids: string[]` and `rooms/{roomID}/players/{id}.uid: string`, both read by the new `firestore.rules` functions below. No later task in this plan consumes these directly, but they're what makes "outsiders can't see the photos" real.

This task is entirely backend/rules — no UI depends on it structurally, but it's the fix that gives the join flow (Tasks 5–6) real privacy. Do it as one task since the pieces are tightly coupled: the rules tests can't meaningfully pass without the `joinedUids` field existing, and the field's only writer is `joinRoom`.

- [ ] **Step 1: Write the failing rules test**

Replace the full contents of `test/firestore.rules.test.js`:

```js
/**
 * Layer 2 — Firestore security rules, against the emulator.
 *
 * Run with `npm run test:rules`, which starts the Firestore emulator around
 * them. @firebase/rules-unit-testing mints synthetic authenticated /
 * unauthenticated contexts directly, so unlike the integration project this
 * does not touch the Auth emulator or the real client SDK in
 * src/utils/firebase.js.
 *
 * See docs/improvements.md item 2 for the design and docs/testing.md's
 * "Layer 2" section for the four baseline assertions these are built from.
 * Reads are additionally scoped to "host or player of this room" as of
 * docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md
 * — PLAYER_UID below is a player who has joined room-a (present in its
 * joinedUids array); OTHER_UID is a signed-in stranger who has not.
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    collection,
    addDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-mall-mystery-heroes';
const HOST_UID = 'host-uid';
const OTHER_UID = 'other-uid';
const PLAYER_UID = 'player-uid';

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
            host: 'localhost',
            port: 8081,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seeding bypasses rules entirely, same reason emulatorHelpers.seedRoom
    // does not go through dbCalls: the rules under test should not gate setup.
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'rooms', 'room-a'), {
            hostId: HOST_UID,
            isGameActive: true,
            taskIndex: 1,
            joinedUids: [PLAYER_UID],
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), {
            name: 'alice',
            score: 10,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'bob'), {
            name: 'bob',
            score: 10,
            uid: PLAYER_UID,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), {
            title: 'Find the fountain',
            isComplete: false,
        });
    });
});

describe('rooms/{roomId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows a player who has joined this room to read it', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows the host to read their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows the host to update their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('denies a non-host update to another room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('denies a joined player from updating a room they did not host', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false }));
    });

    it('allows a signed-in user to create a room they claim as their own', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(
            setDoc(doc(db, 'rooms', 'room-b'), {
                hostId: OTHER_UID,
                isGameActive: true,
                taskIndex: 1,
            })
        );
    });

    it('denies creating a room claimed as hosted by someone else', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'room-c'), {
                hostId: HOST_UID,
                isGameActive: true,
                taskIndex: 1,
            })
        );
    });
});

describe('rooms/{roomId}/players/{playerId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('allows a player who has joined this room to read the roster', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), { score: 999 })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            updateDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), { score: 15 })
        );
    });
});

describe('rooms/{roomId}/tasks/{taskId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('allows a player who has joined this room to read tasks', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), { isComplete: true })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            updateDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), { isComplete: true })
        );
    });
});

describe('rooms/{roomId}/logs/{logId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('allows a player who has joined this room to read logs', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'logs'), { log: 'x', color: 'gray' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'logs'), { log: 'x', color: 'gray' })
        );
    });
});

describe('rooms/{roomId}/photos/{photoId} (interim: host-only write, see firestore.rules comment)', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('allows a player who has joined this room to read photos', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });
});

describe('rooms/{roomId}/playerMessages/{messageId} (interim: host-only write, see firestore.rules comment)', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('allows a player who has joined this room to read player messages', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:rules`
Expected: FAIL — the new "allows a player who has joined this room to read..." tests fail (current rules only check `isSignedIn()`, so `PLAYER_UID` currently _does_ succeed — but the new "denies a signed-in stranger" tests, replacing the old "allows any signed-in user" tests, are the ones that should fail against the unmodified rules, since `OTHER_UID` currently succeeds where it should now be denied).

- [ ] **Step 3: Implement the rules change**

Replace the full contents of `firestore.rules`:

```
rules_version = '2';

// Minimum-viable rules for docs/improvements.md item 2. All game state is
// scoped to the room's host: `hostId` is the creating user's auth.uid, set
// once in DashBoard.handleHostRoom and never changed (docs/data-model.md).
// Reads are additionally scoped to players who have actually joined a room
// (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md)
// — `joinedUids`, appended to by joinRoom's transaction, is what makes that
// checkable from a rule at all, since Firestore rules can only fetch a
// specific known path, not query "does any player doc have field X == Y."
//
// Not addressed here, on purpose (see docs/testing.md Phase 3 scope):
//   - item 4's atomicity problem is resolved — kills now run inside a
//     Cloud Function transaction (functions/callableFunctions/killPlayer.js),
//     which uses the Admin SDK and bypasses these rules entirely (it
//     re-implements the isHostOfExistingRoom check itself). What's NOT
//     resolved: the host can still write any *other* player field
//     directly from the client — score via task completion,
//     ResetTargetsButton's manual reset, open-season toggling,
//     addPlayerForRoom. Only kills moved server-side; auditing and
//     re-homing everything else client-writable is separate, larger scope.
//   - write access is unchanged (host-only) — this pass only widens who can
//     *read* a room beyond its host.
//   - route guards (item 3) and storage.rules are separate concerns.
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isHostOfExistingRoom(roomId) {
      return isSignedIn() &&
        get(/databases/$(database)/documents/rooms/$(roomId)).data.hostId == request.auth.uid;
    }

    function isPlayerOfRoom(roomId) {
      return isSignedIn() &&
        request.auth.uid in get(/databases/$(database)/documents/rooms/$(roomId)).data.joinedUids;
    }

    function isHostOrPlayerOfRoom(roomId) {
      return isHostOfExistingRoom(roomId) || isPlayerOfRoom(roomId);
    }

    match /rooms/{roomId} {
      allow read: if isHostOrPlayerOfRoom(roomId);
      allow create: if isSignedIn() && request.resource.data.hostId == request.auth.uid;
      allow update, delete: if isHostOfExistingRoom(roomId);

      match /players/{playerId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
      }

      match /tasks/{taskId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
      }

      match /logs/{logId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
      }

      // Interim scope — see file header.
      match /photos/{photoId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
      }

      // Interim scope, same reasoning as photos above — see file header.
      match /playerMessages/{messageId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:rules`
Expected: PASS, all 34 tests.

- [ ] **Step 5: Write the failing integration-test assertion**

In `src/components/joinRoom.integration.test.js`, change the imports to add `auth`, `db`, `doc`, and `getDoc`:

```js
import { joinRoom } from './joinRoom';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { auth, db } from '../utils/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';
```

Replace the first test:

```js
it('adds a new player to a room still in its Lobby phase, recording who joined', async () => {
    await seedRoom(ROOM, []);

    await joinRoom(ROOM, 'Alice');

    const player = await fetchPlayerForRoom('alice', ROOM);
    expect(player.data()).toMatchObject({
        name: 'Alice',
        trimmedNameLowerCase: 'alice',
        isAlive: true,
        score: 10,
        targets: [],
        assassins: [],
        uid: auth.currentUser.uid,
    });

    const room = await getDoc(doc(db, 'rooms', ROOM));
    expect(room.data().joinedUids).toContain(auth.currentUser.uid);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test:emulator`
Expected: FAIL — the new `uid`/`joinedUids` assertions fail (`joinRoom.js` doesn't write them yet).

- [ ] **Step 7: Implement the `joinRoom` write**

In `functions/callableFunctions/joinRoom.js`, replace the transaction's final block:

```js
        transaction.set(playerRef, {
            name: playerName,
            trimmedNameLowerCase: trimmedLowercaseName,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
    });
});
```

with:

```js
        transaction.set(playerRef, {
            name: playerName,
            trimmedNameLowerCase: trimmedLowercaseName,
            uid: context.auth.uid,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
        transaction.update(roomRef, {
            joinedUids: admin.firestore.FieldValue.arrayUnion(context.auth.uid),
        });
    });
});
```

In `src/pages/DashBoard.js`, change the room-creation `setDoc` call to include the new field:

```js
await setDoc(roomRef, {
    hostId: user.uid,
    isGameActive: true,
    gameStarted: false,
    joinedUids: [],
    taskIndex: 1,
    storageReference: [],
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test:emulator`
Expected: PASS, all 45 tests (44 pre-existing + this one's expanded assertions — no new test count, since Step 5 modified an existing test rather than adding one).

- [ ] **Step 9: Lint (both root and functions/)**

Run: `npm run format && npm run lint`
Run: `cd functions && npm run lint && cd ..`
Expected: both clean.

- [ ] **Step 10: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add functions/callableFunctions/joinRoom.js src/pages/DashBoard.js firestore.rules test/firestore.rules.test.js src/components/joinRoom.integration.test.js
git commit -m "Scope room reads to host-or-player-of-that-room, not any signed-in user"
```

---

### Task 5: `JoinGame.js` — the join form

**Files:**

- Create: `src/pages/JoinGame.js`
- Create: `src/pages/JoinGame.test.jsx`
- Modify: `src/App.js`

**Interfaces:**

- Consumes: `writePlayerSession` (Task 1), `joinRoom` client wrapper (`src/components/joinRoom.js`, pre-existing, unchanged).
- Produces: nothing new consumed by later tasks — Task 6 (`PlayerWaiting`) reads the same `localStorage` contract via `readPlayerSession`, not anything from this file directly.

- [ ] **Step 1: Write the failing test**

Create `src/pages/JoinGame.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the join form: successful join (guest auth fires invisibly,
 * session persisted, navigates to the waiting screen) and each error path
 * joinRoom's Cloud Function can throw
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * Explicit mock factories for 'firebase/auth', '../utils/firebase', and
 * '../components/joinRoom' — see RequireAuth.test.jsx for why. playerSession
 * is left unmocked: it touches only real jsdom localStorage, not Firebase.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import JoinGame from './JoinGame';
import { joinRoom } from '../components/joinRoom';
import { readPlayerSession } from '../utils/playerSession';

jest.mock('firebase/auth', () => ({
    signInAnonymously: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));
jest.mock('../components/joinRoom', () => ({ joinRoom: jest.fn() }));

const renderJoinGame = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/join']}>
                <Routes>
                    <Route path="/join" element={<JoinGame />} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

const fillAndSubmit = async (gameId, playerName) => {
    await userEvent.type(screen.getByPlaceholderText('Game ID'), gameId);
    await userEvent.type(screen.getByPlaceholderText('Your name'), playerName);
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    signInAnonymously.mockResolvedValue({ user: { uid: 'guest-uid' } });
});

describe('JoinGame', () => {
    it('joins and navigates to the waiting screen on success', async () => {
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(joinRoom).toHaveBeenCalledWith('Fluffy42317', 'Alice');
        expect(readPlayerSession()).toEqual({ roomID: 'Fluffy42317', playerName: 'Alice' });
    });

    it('trims whitespace from the game ID before joining', async () => {
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('  Fluffy42317  ', 'Alice');

        await screen.findByText('Waiting page');
        expect(joinRoom).toHaveBeenCalledWith('Fluffy42317', 'Alice');
    });

    it('shows an inline error and does not navigate when the room does not exist', async () => {
        joinRoom.mockRejectedValue(new Error('Room not found: Nope99999'));
        renderJoinGame();

        await fillAndSubmit('Nope99999', 'Alice');

        expect(await screen.findByText('Room not found: Nope99999')).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });

    it('shows an inline error when the game has already started', async () => {
        joinRoom.mockRejectedValue(new Error('This game has already started.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('This game has already started.')).toBeInTheDocument();
    });

    it('shows an inline error when the room is no longer active', async () => {
        joinRoom.mockRejectedValue(new Error('This room is no longer active.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('This room is no longer active.')).toBeInTheDocument();
    });

    it('shows an inline error when the name is already taken', async () => {
        joinRoom.mockRejectedValue(new Error('Alice is already taken in this room.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Alice is already taken in this room.')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=JoinGame`
Expected: FAIL — `Cannot find module './JoinGame'`.

- [ ] **Step 3: Implement**

Create `src/pages/JoinGame.js`:

```jsx
import React, { useState } from 'react';
import { Button, Input, Stack, Heading, Flex, Alert, AlertIcon } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { joinRoom } from '../components/joinRoom';
import { writePlayerSession } from '../utils/playerSession';

const JoinGame = () => {
    const navigate = useNavigate();
    const [gameId, setGameId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmedGameId = gameId.trim();
        setErrorMessage('');
        setIsSubmitting(true);

        try {
            await signInAnonymously(auth);
            await joinRoom(trimmedGameId, playerName);
            writePlayerSession(trimmedGameId, playerName);
            navigate(`/rooms/${trimmedGameId}/waiting`);
        } catch (err) {
            setErrorMessage(err.message);
            console.error('Error joining game:', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" p={4}>
            <Stack as="form" onSubmit={handleSubmit} spacing={4} width="100%" maxWidth="320px">
                <Heading size="lg" textAlign="center">
                    Join Game
                </Heading>
                {errorMessage && (
                    <Alert borderRadius="2xl" status="error" bg="#FF5252">
                        <AlertIcon color="white" />
                        {errorMessage}
                    </Alert>
                )}
                <Input
                    placeholder="Game ID"
                    value={gameId}
                    onChange={(e) => setGameId(e.target.value)}
                    borderWidth="3px"
                />
                <Input
                    placeholder="Your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    borderWidth="3px"
                />
                <Button type="submit" colorScheme="teal" isLoading={isSubmitting}>
                    Join
                </Button>
            </Stack>
        </Flex>
    );
};

export default JoinGame;
```

Error messages render inline via a Chakra `Alert` bound to component state, matching `src/components/auth.js`'s established pattern for exactly this kind of "form submission that can fail with a server-provided message" case — not the `CreateAlert`/`useToast` pattern, which this codebase reserves for transient one-off notifications (e.g. `Lobby.js`, `DashBoard.js`).

In `src/App.js`, add the import (alphabetical with the other page imports) and route:

```js
import JoinGame from './pages/JoinGame';
```

```jsx
<Route path="/join" element={<JoinGame />} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=JoinGame`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/JoinGame.js src/pages/JoinGame.test.jsx src/App.js
git commit -m "Add /join: the game-ID + name join form with invisible guest auth"
```

---

### Task 6: `PlayerWaiting.js` — the post-join waiting screen

**Files:**

- Create: `src/pages/PlayerWaiting.js`
- Create: `src/pages/PlayerWaiting.test.jsx`
- Modify: `src/App.js`

**Interfaces:**

- Consumes: `readPlayerSession`, `clearPlayerSession` (Task 1); `fetchRoomReferenceForRoom` (pre-existing, `src/components/firebase_calls/dbCalls.js`).

- [ ] **Step 1: Write the failing test**

Create `src/pages/PlayerWaiting.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the post-join waiting screen: renders room/player info, updates
 * its status line when gameStarted flips, redirects home when the room
 * stops existing, and Leave signs out + clears the stored session
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * Explicit mock factories for 'firebase/auth', 'firebase/firestore', and
 * '../components/firebase_calls/dbCalls' — see RequireAuth.test.jsx and
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe here.
 * playerSession is left unmocked: it touches only real jsdom localStorage.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import PlayerWaiting from './PlayerWaiting';
import { fetchRoomReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { writePlayerSession, readPlayerSession } from '../utils/playerSession';

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchRoomReferenceForRoom: jest.fn(),
}));

const renderWaiting = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/waiting']}>
                <Routes>
                    <Route path="/rooms/:roomID/waiting" element={<PlayerWaiting />} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    fetchRoomReferenceForRoom.mockReturnValue('room-ref');
    signOut.mockResolvedValue(undefined);
});

describe('PlayerWaiting', () => {
    it('shows the stored player name and room ID, waiting for the host', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Alice joined Fluffy42317')).toBeInTheDocument();
        expect(screen.getByText('Waiting for the host to start...')).toBeInTheDocument();
    });

    it('updates the status line once gameStarted flips true', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('The game has started!')).toBeInTheDocument();
    });

    it('clears the session and redirects home when the room no longer exists', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => false });
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('signs out, clears the session, and navigates home when Leave is clicked', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

        expect(signOut).toHaveBeenCalled();
        expect(readPlayerSession()).toBeNull();
        expect(await screen.findByText('Home page')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerWaiting`
Expected: FAIL — `Cannot find module './PlayerWaiting'`.

- [ ] **Step 3: Implement**

Create `src/pages/PlayerWaiting.js`:

```jsx
import React, { useEffect, useState } from 'react';
import { Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { fetchRoomReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { readPlayerSession, clearPlayerSession } from '../utils/playerSession';

const PlayerWaiting = () => {
    const { roomID } = useParams();
    const navigate = useNavigate();
    const [gameStarted, setGameStarted] = useState(false);
    const session = readPlayerSession();
    const playerName = session && session.roomID === roomID ? session.playerName : '';

    // "Leave" (below) only ends this device's local session: it does not
    // remove the player from the room's roster, touch joinedUids, or
    // affect their targets/assassins. Actually leaving a game is a
    // separate, larger feature not addressed here
    // (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
    useEffect(() => {
        if (!roomID) return undefined;
        const roomRef = fetchRoomReferenceForRoom(roomID);
        const unsubscribe = onSnapshot(roomRef, (snapshot) => {
            if (!snapshot.exists()) {
                clearPlayerSession();
                navigate('/', { replace: true });
                return;
            }
            setGameStarted(snapshot.data()?.gameStarted ?? false);
        });
        return () => unsubscribe();
    }, [roomID, navigate]);

    const handleLeave = async () => {
        try {
            await signOut(auth);
        } catch (err) {
            console.error('Error signing out:', err);
        }
        clearPlayerSession();
        navigate('/');
    };

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" direction="column" p={4}>
            <Heading size="lg" mb={2}>
                {playerName || 'You'} joined {roomID}
            </Heading>
            <Text mb={6}>
                {gameStarted ? 'The game has started!' : 'Waiting for the host to start...'}
            </Text>
            <Button colorScheme="red" variant="outline" onClick={handleLeave}>
                Leave
            </Button>
        </Flex>
    );
};

export default PlayerWaiting;
```

In `src/App.js`, add the import (alphabetical) and route, wrapped in `RequireAuth` like the other `/rooms/:roomID/*` routes:

```js
import PlayerWaiting from './pages/PlayerWaiting';
```

```jsx
<Route
    path="/rooms/:roomID/waiting"
    element={
        <RequireAuth>
            <PlayerWaiting />
        </RequireAuth>
    }
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects dom --testPathPattern=PlayerWaiting`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/pages/PlayerWaiting.js src/pages/PlayerWaiting.test.jsx src/App.js
git commit -m "Add player waiting screen: post-join landing with live gameStarted status"
```

---

### Task 7: Retention duration — 24 hours

**Files:**

- Modify: `functions/scheduledFunctions/cleanupEndedRooms.js`

**Interfaces:** None — a constant value change, no signature changes.

- [ ] **Step 1: Change the constant**

In `functions/scheduledFunctions/cleanupEndedRooms.js`, replace:

```js
// null = deliberate no-op. The mechanism is fully built; only the actual
// duration is undecided (docs/superpowers/specs/2026-08-06-player-access-
// and-room-lifecycle-design.md). Flip this to a number to turn it on.
let RETENTION_DAYS = null;
```

with:

```js
// 24 hours — enough time to review standings, kill photos, and flag any
// last-minute mistake before a room's data disappears
// (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
let RETENTION_DAYS = 1;
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx jest --selectProjects unit --testPathPattern=selectExpiredRooms`
Expected: PASS, all 6 tests unaffected — they inject `retentionDays` directly as a parameter, independent of this module-level constant.

Run: `npm run test:emulator`
Expected: PASS, all 45 tests — `cleanupEndedRooms.integration.test.js`'s 4 tests all call `setRetentionDaysForTesting(...)` explicitly before asserting, overriding this default in every case, so changing the default doesn't affect them.

- [ ] **Step 3: Full gate**

Run: `npm run format && npm run lint && npm test -- --watchAll=false && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add functions/scheduledFunctions/cleanupEndedRooms.js
git commit -m "Set room-data retention to 24 hours after a game ends"
```

---

### Task 8: Documentation

**Files:**

- Modify: `docs/data-model.md`
- Modify: `docs/architecture.md`
- Modify: `docs/testing.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `docs/data-model.md`**

In the `` ## `rooms/{roomID}` `` field table, add a `joinedUids` row. Find:

```markdown
| `taskIndex` | `number` | `DashBoard.handleHostRoom` (`1`), `dbCalls.fetchTaskIndexThenIncrement` | Monotonic counter handing out human-facing mission numbers. |
| `storageReference` | `array` | `DashBoard.handleHostRoom` (`[]`) | Written empty at creation, never read or appended. Vestigial. |
```

Replace with:

```markdown
| `taskIndex` | `number` | `DashBoard.handleHostRoom` (`1`), `dbCalls.fetchTaskIndexThenIncrement` | Monotonic counter handing out human-facing mission numbers. |
| `joinedUids` | `array<string>` | `DashBoard.handleHostRoom` (`[]`), `joinRoom` (`arrayUnion`) | Every `auth.uid` that has self-registered via `joinRoom`. Read by `firestore.rules`' `isPlayerOfRoom` to scope reads to "host or player of this room" — Firestore rules can't query "does any player doc have field X == Y," only fetch a known path, so this room-level list is what makes room-scoped reads checkable at all (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md). |
| `storageReference` | `array` | `DashBoard.handleHostRoom` (`[]`) | Written empty at creation, never read or appended. Vestigial. |
```

In the `` ## `rooms/{roomID}/players/{trimmedNameLowerCase}` `` field table, add a `uid` row. Find:

```markdown
| `openSeason` | `boolean` | `false` | When true, _anyone_ may kill this player, and this player may kill anyone. |
```

Replace with:

```markdown
| `openSeason` | `boolean` | `false` | When true, _anyone_ may kill this player, and this player may kill anyone. |
| `uid` | `string` | absent | The Firebase Auth uid that self-registered as this player, written only by `joinRoom` (`functions/callableFunctions/joinRoom.js`). Absent on GM-added players (`dbCalls.addPlayerForRoom`), which have no associated browser session (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md). |
```

- [ ] **Step 2: Update `docs/architecture.md`**

In the `### Routes` section, replace the table and the sentence after it. Find:

```markdown
| Path                            | Page             | Purpose                              | Guarded |
| ------------------------------- | ---------------- | ------------------------------------ | ------- |
| `/`                             | `Homepage`       | Log in / sign up landing             |         |
| `/login`                        | `Login`          | Email + password sign-in             |         |
| `/login/password-reset`         | `PasswordReset`  | Sends Firebase reset email           |         |
| `/signup`                       | `SignUp`         | Account creation                     |         |
| `/dashboard`                    | `DashBoard`      | Host a new room, log out             | ✅      |
| `/rooms/:roomID/lobby`          | `Lobby`          | Roster management, target generation | ✅      |
| `/rooms/:roomID/GameMasterView` | `GameMasterView` | The live game console                | ✅      |

There is no catch-all `*` route, so an unknown URL renders a blank page.
```

Replace with:

```markdown
| Path                            | Page             | Purpose                                          | Guarded |
| ------------------------------- | ---------------- | ------------------------------------------------ | ------- |
| `/`                             | `Homepage`       | "Host Game" / "Join Game" landing                |         |
| `/host`                         | `Host`           | Log in / sign up choice (today's old `Homepage`) |         |
| `/login`                        | `Login`          | Email + password sign-in                         |         |
| `/login/password-reset`         | `PasswordReset`  | Sends Firebase reset email                       |         |
| `/signup`                       | `SignUp`         | Account creation                                 |         |
| `/join`                         | `JoinGame`       | Player self-registration: game ID + name         |         |
| `/dashboard`                    | `DashBoard`      | Host a new room, log out                         | ✅      |
| `/rooms/:roomID/lobby`          | `Lobby`          | Roster management, target generation             | ✅      |
| `/rooms/:roomID/GameMasterView` | `GameMasterView` | The live game console                            | ✅      |
| `/rooms/:roomID/waiting`        | `PlayerWaiting`  | Post-join landing for a self-registered player   | ✅      |

`NotFound` is the catch-all `*` route (`improvements.md` item 30).
```

In the `## Authentication and authorization` section, replace the whole section. Find:

```markdown
## Authentication and authorization

Firebase Auth, email/password only, handled entirely by `src/components/auth.js`
(shared by both `Login` and `SignUp` via an `isLoginPage` prop). Password reset
goes through `sendPasswordResetEmail`. Google sign-in is initialized in
`utils/firebase.js` (`googleProvider`) but never used.

**Authorization is enforced at both the database and the route.**
`firestore.rules` (registered in `firebase.json`) requires `request.auth !=
null` for every read, and scopes every write under `rooms/{roomId}` —
including the `players`, `tasks`, and `photos` subcollections — to
`resource.data.hostId == request.auth.uid`. `rooms/{roomID}.hostId`, written
once at room creation, is now read, by the rules engine. On top of that,
`src/components/RequireAuth.js` wraps `/dashboard` and the two
`/rooms/:roomID/*` routes, redirecting a signed-out visitor to `/` before the
page renders at all — defense-in-depth, not a substitute for the rules.

Gaps that remain, per [improvements.md](./improvements.md):

- `storage.rules` is still `allow read, write: if true` for all paths (item 2's
  storage half, out of scope for the Firestore-rules pass).
- All game logic remains client-side, so a signed-in host can still write any
  field on their own room's documents, including `score` directly — the rules
  stop other people from editing a room, not a host from writing anything to
  their own (item 4, item 10 in [testing.md](./testing.md#layer-2--security-rules-)).
- `photos` is scoped to the host, not to a distinct mobile-app identity — no
  such app exists in this repository (item 33).
```

Replace with:

```markdown
## Authentication and authorization

Three ways to sign in now: email/password (`src/components/auth.js`, shared
by `Login` and `SignUp` via an `isLoginPage` prop; password reset goes
through `sendPasswordResetEmail`), Google (`signInWithPopup` +
`googleProvider`, additive on the same `auth.js` form for the GM), and
anonymous/guest (`signInAnonymously`, used only by `JoinGame` — a player
never sees a login screen at all).

**Authorization is enforced at both the database and the route.**
`firestore.rules` (registered in `firebase.json`) scopes every read under
`rooms/{roomId}` — including all five subcollections — to whichever caller
is either the room's host (`resource.data.hostId == request.auth.uid`) or a
player who has joined it (`request.auth.uid` present in the room's
`joinedUids`, appended to by `joinRoom`) — not simply "any signed-in user"
(docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
Writes stay host-only, unchanged. `rooms/{roomID}.hostId`, written once at
room creation, and `joinedUids`, appended to on every self-registration, are
both read by the rules engine via `get()`. On top of that,
`src/components/RequireAuth.js` wraps `/dashboard` and every `/rooms/:roomID/*`
route (including the new `/waiting`), redirecting a signed-out visitor to
`/` before the page renders at all — defense-in-depth, not a substitute for
the rules. `RequireAuth` accepts any signed-in user, anonymous included.

Gaps that remain, per [improvements.md](./improvements.md):

- `storage.rules` requires `request.auth != null` but is not scoped
  per-room or per-player the way `firestore.rules` now is — no photo-upload
  code exists yet to scope a rule against (docs/superpowers/specs/2026-08-07-
  join-flow-ui-and-room-scoping-design.md).
- All game logic remains client-side, so a signed-in host can still write any
  field on their own room's documents, including `score` directly — the rules
  stop other people from editing a room, not a host from writing anything to
  their own (item 4, item 10 in [testing.md](./testing.md#layer-2--security-rules-)).
- `photos` is scoped to "host or player of this room," not to a distinct
  per-photo-uploader identity — no photo-upload code exists in this
  repository yet (item 33).
```

In the `## Cloud Functions` section, update the `joinRoom` and `cleanupEndedRooms` bullets. Find:

```markdown
- `joinRoom` (`functions/callableFunctions/joinRoom.js`) — lets a player
  self-register into a room from their own device, atomically checking for
  a duplicate name and that the room is still in its Lobby phase, all
  inside one Firestore transaction via the Admin SDK — the player-facing
  counterpart to `dbCalls.addPlayerForRoom`
  (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
  `src/components/joinRoom.js` is its thin `httpsCallable` wrapper, same
  shape as `executeKill.js`. Unlike `killPlayer`, there is no host-only
  check — any signed-in caller (Google or anonymous/guest) may call it.
- `cleanupEndedRooms` (`functions/scheduledFunctions/cleanupEndedRooms.js`)
  — runs once every 24 hours, deleting any room (and everything under it)
  whose `endedAt` is older than a retention window. The window is a
  module-level constant, currently unset — the mechanism is fully built,
  the actual duration is a deliberately deferred decision. The first
  scheduled (as opposed to callable) function in this repo, and the first
  tested via `firebase-functions-test`'s `wrap()` rather than a client
  wrapper, since a cron job has no client caller to go through.
```

Replace with:

```markdown
- `joinRoom` (`functions/callableFunctions/joinRoom.js`) — lets a player
  self-register into a room from their own device, atomically checking for
  a duplicate name and that the room is still in its Lobby phase, all
  inside one Firestore transaction via the Admin SDK — the player-facing
  counterpart to `dbCalls.addPlayerForRoom`
  (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
  Also records the joining `uid` on the new player doc and appends it to
  the room's `joinedUids`, which is what `firestore.rules`' room-scoping
  checks against
  (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
  `src/components/joinRoom.js` is its thin `httpsCallable` wrapper, same
  shape as `executeKill.js`. Unlike `killPlayer`, there is no host-only
  check — any signed-in caller (Google or anonymous/guest) may call it.
- `cleanupEndedRooms` (`functions/scheduledFunctions/cleanupEndedRooms.js`)
  — runs once every 24 hours, deleting any room (and everything under it)
  whose `endedAt` is older than a retention window. The window is a
  module-level constant, currently `1` (24 hours) — enough time to review
  standings and photos, or flag a mistake, before a room disappears
  (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
  The first scheduled (as opposed to callable) function in this repo, and
  the first tested via `firebase-functions-test`'s `wrap()` rather than a
  client wrapper, since a cron job has no client caller to go through.
```

- [ ] **Step 3: Update `docs/testing.md`**

In the `### Layer 2 — Security rules ✅` section, replace the bullet list and the `storage.rules` line. Find:

```markdown
- unauthenticated read of `rooms/{id}/players` → denied
- authenticated non-host write to another room's player → denied
- host write to own room → allowed
- client write to `points` → **still allowed**. Kills specifically no
  longer take this path — they run server-side via `killPlayer` (item 4,
  Layer 1b above), which the Admin SDK exempts from these rules entirely —
  but every other player write (task-completion scoring, manual target
  reset, open-season toggling) still goes through the client SDK, so a
  signed-in host can still write `points` directly outside a kill. This
  rules test still intentionally passes for that reason, not because it's
  stale.

`photos` is scoped to the host too, not "the mobile app's identity" as
originally proposed — see backlog item 33 and the comment in `firestore.rules`.

`storage.rules` (`allow read, write: if true`) is unchanged — out of scope for
this phase; see backlog item 2.
```

Replace with:

```markdown
- unauthenticated read of `rooms/{id}/players` → denied
- a signed-in stranger — neither the room's host nor a player who has
  joined it — reading `rooms/{id}` or any of its five subcollections →
  denied, as of docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-
  scoping-design.md. Previously this was "any signed-in user," full stop —
  the gap that let a guest from one room read another room's data just by
  knowing its ID.
- a player present in the room's `joinedUids` reading the same → allowed
- authenticated non-host write to another room's player → denied
- host write to own room → allowed
- client write to `points` → **still allowed**. Kills specifically no
  longer take this path — they run server-side via `killPlayer` (item 4,
  Layer 1b above), which the Admin SDK exempts from these rules entirely —
  but every other player write (task-completion scoring, manual target
  reset, open-season toggling) still goes through the client SDK, so a
  signed-in host can still write `points` directly outside a kill. This
  rules test still intentionally passes for that reason, not because it's
  stale.

`photos` and `playerMessages` are scoped to "host or player of this room"
for reads, host-only for writes — not to a distinct per-uploader identity,
since no photo-upload code exists in this repository yet (backlog item 33).

`storage.rules` requires `request.auth != null` but is not scoped per-room
or per-player the way `firestore.rules` now is — no photo-upload code exists
yet to scope a rule against; see backlog item 2 and docs/superpowers/specs/
2026-08-07-join-flow-ui-and-room-scoping-design.md.
```

- [ ] **Step 4: Regenerate the illustrative `$ npm test` block and suite counts**

Run `npm test -- --watchAll=false` for real and copy its actual output (list of `PASS` lines plus the final `Test Suites:`/`Tests:` totals) into the `$ npm test` code block near the top of `docs/testing.md` (replacing the current block), including the four new files this plan added
(`src/utils/playerSession.test.js`, `src/pages/Homepage.test.jsx`,
`src/pages/Host.test.jsx`, `src/pages/JoinGame.test.jsx`,
`src/pages/PlayerWaiting.test.jsx`). Do not hand-count or estimate — run the
command and use its real output.

Run `npm run test:emulator` for real and update the paragraph just below that block (currently "four further suites... 45 tests total") — the `joinRoom.integration.test.js` count doesn't change (Task 4 only expanded an existing test's assertions, no new test), but confirm the real total still matches.

Run `npm run test:rules` for real and update the "`npm run test:rules` runs `test/firestore.rules.test.js` (19 tests)" count — Task 4 grew this file to 34 tests; use the real reported number to confirm.

Update the pure/dom-modules table's row for `test/firestore.rules.test.js` (change `19` to the real count) and add rows for the five new test files this plan added, using the real per-file test counts (visible in each file's own `describe`/`it` structure, or cross-referenced against the actual `npm test`/`npm run test:rules` output). Follow the existing table's exact column format (`Module | What it holds | Tests`).

- [ ] **Step 5: Format**

Run: `npm run format`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add docs/data-model.md docs/architecture.md docs/testing.md
git commit -m "Docs: document joinedUids, uid, the new routes, and room-scoped reads"
```

---

### Task 9: Final validation gate

**Files:** None modified — verification only.

- [ ] **Step 1: Full gate**

Run in order:

```bash
npm run format
npm run format:check
npm run lint
(cd functions && npm run lint)
npm test -- --watchAll=false
npm run test:emulator
npm run test:rules
CI=true npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Sanity-check the retention constant is really on at the intended value**

`grep -n "RETENTION_DAYS = " functions/scheduledFunctions/cleanupEndedRooms.js` should show `1` — confirms Task 7's change landed and nothing reset it.

- [ ] **Step 3: Sanity-check no room-scoping regression**

`grep -n "isSignedIn()" firestore.rules` should show it defined once and used only inside `isHostOfExistingRoom`/`isPlayerOfRoom`/the `create` rule — not directly on any `allow read` line for `rooms/{roomId}` or its five subcollections, confirming none of them reverted to the old "any signed-in user" check.

- [ ] **Step 4: Optional — verify the join flow live against the running app**

If a dev server + emulators are available (`npm run firebase:emulate` in one terminal, `npm start` in another), open `/`, click "Join Game," enter a room ID from a room hosted via "Host Game" → "Sign Up"/"Log In," and confirm you land on the waiting screen without ever seeing an auth prompt. Not blocking if the environment isn't available — noted per this project's own precedent that live verification has caught real bugs the test suite alone missed.
