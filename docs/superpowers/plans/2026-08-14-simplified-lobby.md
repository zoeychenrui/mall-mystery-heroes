# Simplified GM Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GM lobby's split-screen layout (manual "Add Player" form + two-column roster) with a single centered page — green banner with the mall-bag logo up top, game ID, a single-column player list, Remove Player, and Start Game — and delete the now-redundant manual "Add Player" UI.

**Architecture:** Three sequential tasks, ordered so every intermediate commit still builds and passes its full gate: (1) simplify `PlayerList.js` to a single column — a pure prop-compatible internal change, no callers affected; (2) rewrite `Lobby.js`'s layout and drop its `PlayerAddition` usage — `PlayerAddition.js` becomes orphaned but still exists, so nothing breaks; (3) delete `PlayerAddition.js` and its test now that it's genuinely dead code.

**Tech Stack:** React, Chakra UI, React Router (`useParams`/`useNavigate`), Firebase (`onSnapshot`, `signOut`), Jest + React Testing Library (jsdom).

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) must pass before any task is considered done.
- TDD: write the failing test first, watch it fail, then implement (per CLAUDE.md).
- Do not modify `src/components/firebase_calls/dbCalls.js` — `addPlayerForRoom` stays; removing the UI that calls it is this plan's only scope, not the data layer.
- Do not modify `src/components/lobby_components/PlayerRemove.js`, `src/components/TargetGenerator.js`, `src/pages/JoinGame.js`, or any file not named in this plan's tasks.
- Keep the green banner color `#66bf78` and the `mall-logo-black-green.png` asset — no new visual design, per the spec's explicit "keep styling close to the existing look" decision.

---

### Task 1: Simplify `PlayerList.js` to a single column

**Files:**

- Modify: `src/components/lobby_components/PlayerList.js` (full current content below)
- Create: `src/components/lobby_components/PlayerList.test.jsx` (no test file exists for this component today)

**Interfaces:**

- Consumes: nothing new.
- Produces: `PlayerList`, default export, props `{ arrayOfPlayers }` (array of name strings) — unchanged signature, so `Lobby.js` (Task 2) needs no interface changes, only its own render tree changes.

**Current content of `src/components/lobby_components/PlayerList.js`:**

```jsx
import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => {
    //  Takes arrayofPlayers and makes it a list
    const listOfNames = arrayOfPlayers.map((eachName) => (
        <ListItem
            key={eachName}
            mb="4px"
            fontSize="2xl"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
        >
            {eachName}
        </ListItem>
    ));

    const firstHalf = [];
    const secondHalf = [];
    for (let i = 0; i < listOfNames.length; i++) {
        if (i % 2 === 0) {
            firstHalf.push(listOfNames[i]);
        } else {
            secondHalf.push(listOfNames[i]);
        }
    }

    return (
        <Flex
            direction="row"
            h="100%"
            w="90%"
            overflowY="auto"
            overflowX="hidden"
            justify="center"
            align="top"
            textAlign="center"
        >
            <Flex w="50%" maxW="50%" justify="center">
                <OrderedList listStyleType="none">{firstHalf}</OrderedList>
            </Flex>

            <Flex w="50%" justify="center" maxW="50%" overflowX="hidden">
                <OrderedList listStyleType="none" overflow="hidden">
                    {secondHalf}
                </OrderedList>
            </Flex>
        </Flex>
    );
};

export default PlayerList;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/lobby_components/PlayerList.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * PlayerList renders the room's joined player names as a single centered
 * column (2026-08-14 simplified-lobby redesign) — previously split into
 * two side-by-side columns for a wide split-screen layout that no longer
 * exists (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import PlayerList from './PlayerList';

describe('PlayerList', () => {
    it('renders every name once, in a single list, in order', () => {
        render(
            <ChakraProvider>
                <PlayerList arrayOfPlayers={['Alice', 'Bob', 'Carol']} />
            </ChakraProvider>
        );

        expect(screen.getAllByRole('list')).toHaveLength(1);
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'Alice',
            'Bob',
            'Carol',
        ]);
    });

    it('renders no list items when there are no players', () => {
        render(
            <ChakraProvider>
                <PlayerList arrayOfPlayers={[]} />
            </ChakraProvider>
        );

        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/lobby_components/PlayerList.test.jsx`
Expected: FAIL on the first test — `screen.getAllByRole('list')` finds 2 elements (the current two-`OrderedList` split), not 1.

- [ ] **Step 3: Write the implementation**

Replace the full content of `src/components/lobby_components/PlayerList.js` with:

```jsx
import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => {
    // Takes arrayOfPlayers and renders it as a single centered column
    // (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md) — was
    // previously split into two side-by-side columns for the old
    // split-screen Lobby layout, which no longer exists.
    const listOfNames = arrayOfPlayers.map((eachName) => (
        <ListItem
            key={eachName}
            mb="4px"
            fontSize="2xl"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
        >
            {eachName}
        </ListItem>
    ));

    return (
        <Flex
            direction="column"
            h="100%"
            w="90%"
            overflowY="auto"
            overflowX="hidden"
            justify="flex-start"
            align="center"
            textAlign="center"
        >
            <OrderedList listStyleType="none">{listOfNames}</OrderedList>
        </Flex>
    );
};

export default PlayerList;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/lobby_components/PlayerList.test.jsx`
Expected: PASS — 2/2 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass. (`Lobby.js` still imports and renders `PlayerList` with the same `arrayOfPlayers` prop, so `Lobby.test.jsx`'s existing roster-related tests — which read player names via `getAllByRole('listitem')` — continue to pass unchanged against the new single-column output.)

- [ ] **Step 6: Commit**

```bash
git add src/components/lobby_components/PlayerList.js src/components/lobby_components/PlayerList.test.jsx
git commit -m "Simplify PlayerList to a single column"
```

---

### Task 2: Rewrite `Lobby.js` — single-column layout, drop manual Add Player

**Files:**

- Modify: `src/pages/Lobby.js` (full current content below)
- Modify: `src/pages/Lobby.test.jsx` (full current content below)

**Interfaces:**

- Consumes: `PlayerList` from Task 1 (unchanged props: `{ arrayOfPlayers }`); `PlayerRemove` (unchanged, props `{ roomID, arrayOfPlayers }`, from `src/components/lobby_components/PlayerRemove.js`); `TargetGenerator` (unchanged, props `{ roomID, arrayOfPlayers, handleLobbyRoom }`, from `src/components/TargetGenerator.js`, renders a "Begin Game" button).
- Produces: no new exports — `Lobby` keeps its existing default export and no-props signature (reads `roomID` via `useParams()`). After this task, `src/components/lobby_components/PlayerAddition.js` has zero remaining call sites in production code (Task 3 deletes it).

**Current content of `src/pages/Lobby.js`:**

```jsx
import { Button, Divider, Flex, Heading, Image } from '@chakra-ui/react';
import { signOut } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import mallLogo from '../assets/mall-logo-black-green.png';
import CreateAlert from '../components/CreateAlert';
import PlayerAddition from '../components/lobby_components/PlayerAddition';
import PlayerList from '../components/lobby_components/PlayerList';
import PlayerRemove from '../components/lobby_components/PlayerRemove';
import TargetGenerator from '../components/TargetGenerator';
import { fetchAllPlayersQueryForRoom } from '../components/firebase_calls/dbCalls';
import { auth } from '../utils/firebase';

const Lobby = () => {
    const navigate = useNavigate();
    const { roomID } = useParams();
    const [arrayOfPlayers, setArrayOfPlayers] = useState([]);
    const createAlert = CreateAlert();

    const logout = async () => {
        try {
            await signOut(auth);
            console.log('User successfully logged out');
            navigate('/');
        } catch (err) {
            console.error(err);
        }
    };

    // Live subscription, not a one-time fetch (docs/improvements.md item
    // 13, extended here from GameMasterView to Lobby) — a player joining
    // from another device now shows up without the GM reloading the page.
    useEffect(() => {
        if (!roomID) return undefined;
        const playersQuery = fetchAllPlayersQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            playersQuery,
            (snapshot) => {
                setArrayOfPlayers(snapshot.docs.map((doc) => doc.data().name));
            },
            (error) => {
                console.error(error);
                createAlert('error', 'Error updating arrayOfPlayers', 'Check console.', 1500);
            }
        );
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomID]);

    //navigates to lobby
    const handleLobbyRoom = async () => {
        //checks if arrayOfPlayers has at least two players
        if (arrayOfPlayers) {
            if (arrayOfPlayers.length <= 1) {
                return createAlert(
                    'error',
                    'Error',
                    'Not enough players (must have at least 2)',
                    1500
                );
            }
        } else {
            return createAlert('error', 'Error', 'arrayOfPlayers is not defined', 1500);
        }

        try {
            // GameMasterView derives its own player count from a live
            // Firestore subscription now, not router state
            // (docs/improvements.md item 13) — nothing reads this anymore.
            navigate(`/rooms/${roomID}/GameMasterView`);
        } catch (error) {
            console.error('Error navigating to game view: ', error);
            createAlert('error', 'Error navigating to game view', 'Check console.', 1500);
        }
    };
    return (
        <Flex h="100vh" w="100vw" justify="center" align="center" direction="row">
            <Flex direction="column" w="40%" h="100%" bg="#66bf78" justify="center" align="center">
                <Image src={mallLogo} alt="logo" w="45%" h="40%" mt="20%" />
                <Heading as="h2" size="md" mt="10%" color="black">
                    Lobby ID: {roomID}
                </Heading>
                <Heading size="md" mt="6%" mb="4px" color="black">
                    Add Player
                </Heading>
                <PlayerAddition roomID={roomID} />
                <TargetGenerator
                    roomID={roomID}
                    arrayOfPlayers={arrayOfPlayers}
                    handleLobbyRoom={handleLobbyRoom}
                />
            </Flex>

            <Flex direction="column" h="100%" w="70%" bg="black">
                <Flex justify="flex-end" h="6%">
                    <Button
                        colorScheme="red"
                        m="12px"
                        borderRadius="2px"
                        variant="ghost"
                        _hover={{ bg: 'red', color: 'white' }}
                        onClick={logout}
                    >
                        Log Out
                    </Button>
                </Flex>

                <Flex justify="center" align="center" mb="1%">
                    <Heading>Players ({arrayOfPlayers.length})</Heading>
                </Flex>
                <Divider />

                <Flex h="76%" justify="center" align="center" overflow="auto">
                    <PlayerList arrayOfPlayers={arrayOfPlayers} />
                </Flex>

                <Flex h="16%" align="center" justify="center" w="100%">
                    {arrayOfPlayers.length > 0 && (
                        <PlayerRemove roomID={roomID} arrayOfPlayers={arrayOfPlayers} />
                    )}
                </Flex>
            </Flex>
        </Flex>
    );
};

export default Lobby;
```

**Current content of `src/pages/Lobby.test.jsx`:**

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers Lobby's player roster: a live subscription, not a one-time fetch
 * (docs/improvements.md item 13 extended here from GameMasterView, which
 * this covers) — a player who joins from another device (e.g. self-join via
 * /join) now shows up without the GM reloading the page.
 *
 * TargetGenerator/PlayerAddition/PlayerRemove are exercised for real (not
 * stubbed) since none of them do anything on mount that touches Firebase —
 * they only act on user interaction, which this file never triggers. All
 * three import from dbCalls.js, so the explicit mock factory below covers
 * every function any of them need, the same reasoning as every other
 * dbCalls mock in this repo (see ChatInput.test.jsx).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import Lobby from './Lobby';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchAllPlayersQueryForRoom: jest.fn(() => 'players-query'),
    addPlayerForRoom: jest.fn(),
    removePlayerForRoom: jest.fn(),
    addLogForRoom: jest.fn(),
    markGameAsStarted: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));

const asPlayerDocs = (names) => names.map((name) => ({ data: () => ({ name }) }));

// PlayerRemove's <select> also renders each player's name as an <option>,
// so a bare getByText('Alice') is ambiguous (matches both the roster list
// item and the dropdown option) — scope to listitem role to read only the
// roster PlayerList actually renders.
const rosterNames = () => screen.getAllByRole('listitem').map((item) => item.textContent);

const mountLobby = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/lobby']}>
                <Routes>
                    <Route path="/rooms/:roomID/lobby" element={<Lobby />} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the player roster is a live subscription, not a one-time fetch', () => {
    it('shows players from the subscribed snapshot on mount', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: asPlayerDocs(['Alice', 'Bob']) });
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    });

    it('shows a player who joins from another device without a reload', () => {
        let deliverPlayers;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverPlayers = onNext;
            onNext({ docs: asPlayerDocs(['Alice']) });
            return () => {};
        });

        mountLobby();
        expect(screen.getByText('Players (1)')).toBeInTheDocument();

        // Simulates a player self-joining from a second device/tab — the
        // point of a live subscription is this needs no reload to show up.
        act(() => {
            deliverPlayers({ docs: asPlayerDocs(['Alice', 'Carol']) });
        });

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Carol']));
    });

    it('surfaces a subscription error instead of leaving the roster silently empty', () => {
        onSnapshot.mockImplementation((query, onNext, onError) => {
            onError(new Error('boom'));
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (0)')).toBeInTheDocument();
        expect(screen.getByText('Error updating arrayOfPlayers')).toBeInTheDocument();
    });
});
```

- [ ] **Step 1: Write the failing test**

Replace the full content of `src/pages/Lobby.test.jsx` with:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers Lobby's player roster: a live subscription, not a one-time fetch
 * (docs/improvements.md item 13 extended here from GameMasterView, which
 * this covers) — a player who joins from another device (e.g. self-join via
 * /join) now shows up without the GM reloading the page. Also covers the
 * single-column layout's new "Game ID" heading (previously "Lobby ID"),
 * Log Out, and Start Game/Remove Player still being present after the
 * 2026-08-14 simplified-lobby redesign
 * (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md), which
 * dropped the manual "Add Player" form entirely.
 *
 * TargetGenerator/PlayerRemove are exercised for real (not stubbed) since
 * neither does anything on mount that touches Firebase — they only act on
 * user interaction, which this file never triggers. Both import from
 * dbCalls.js, so the explicit mock factory below covers every function
 * either needs, the same reasoning as every other dbCalls mock in this
 * repo (see ChatInput.test.jsx).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import Lobby from './Lobby';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchAllPlayersQueryForRoom: jest.fn(() => 'players-query'),
    removePlayerForRoom: jest.fn(),
    addLogForRoom: jest.fn(),
    markGameAsStarted: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));

const asPlayerDocs = (names) => names.map((name) => ({ data: () => ({ name }) }));

// PlayerRemove's <select> also renders each player's name as an <option>,
// so a bare getByText('Alice') is ambiguous (matches both the roster list
// item and the dropdown option) — scope to listitem role to read only the
// roster PlayerList actually renders.
const rosterNames = () => screen.getAllByRole('listitem').map((item) => item.textContent);

const mountLobby = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/lobby']}>
                <Routes>
                    <Route path="/rooms/:roomID/lobby" element={<Lobby />} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the player roster is a live subscription, not a one-time fetch', () => {
    it('shows players from the subscribed snapshot on mount', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: asPlayerDocs(['Alice', 'Bob']) });
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    });

    it('shows a player who joins from another device without a reload', () => {
        let deliverPlayers;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverPlayers = onNext;
            onNext({ docs: asPlayerDocs(['Alice']) });
            return () => {};
        });

        mountLobby();
        expect(screen.getByText('Players (1)')).toBeInTheDocument();

        // Simulates a player self-joining from a second device/tab — the
        // point of a live subscription is this needs no reload to show up.
        act(() => {
            deliverPlayers({ docs: asPlayerDocs(['Alice', 'Carol']) });
        });

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Carol']));
    });

    it('surfaces a subscription error instead of leaving the roster silently empty', () => {
        onSnapshot.mockImplementation((query, onNext, onError) => {
            onError(new Error('boom'));
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (0)')).toBeInTheDocument();
        expect(screen.getByText('Error updating arrayOfPlayers')).toBeInTheDocument();
    });
});

describe('the simplified layout', () => {
    it('shows the game ID instead of the old "Lobby ID" label', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: [] });
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Game ID: room-a')).toBeInTheDocument();
        expect(screen.queryByText(/Lobby ID/)).not.toBeInTheDocument();
    });

    it('has no manual "Add Player" form', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: [] });
            return () => {};
        });

        mountLobby();

        expect(screen.queryByPlaceholderText('Enter Player Name')).not.toBeInTheDocument();
        expect(screen.queryByText('Add Player')).not.toBeInTheDocument();
    });

    it('still shows Start Game and, once players exist, Remove Player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: asPlayerDocs(['Alice', 'Bob']) });
            return () => {};
        });

        mountLobby();

        expect(screen.getByRole('button', { name: 'Begin Game' })).toBeInTheDocument();
        expect(screen.getByText('Select player to remove')).toBeInTheDocument();
    });

    it('logs out when Log Out is clicked', async () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: [] });
            return () => {};
        });
        signOut.mockResolvedValue();

        mountLobby();

        act(() => {
            screen.getByRole('button', { name: 'Log Out' }).click();
        });

        await act(async () => {});
        expect(signOut).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/pages/Lobby.test.jsx`
Expected: FAIL on the new `'the simplified layout'` tests — the current `Lobby.js` still renders "Lobby ID: room-a" (not "Game ID: room-a") and still renders the "Enter Player Name" input and "Add Player" heading.

- [ ] **Step 3: Write the implementation**

Replace the full content of `src/pages/Lobby.js` with:

```jsx
import { Button, Divider, Flex, Heading, Image } from '@chakra-ui/react';
import { signOut } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import mallLogo from '../assets/mall-logo-black-green.png';
import CreateAlert from '../components/CreateAlert';
import PlayerList from '../components/lobby_components/PlayerList';
import PlayerRemove from '../components/lobby_components/PlayerRemove';
import TargetGenerator from '../components/TargetGenerator';
import { fetchAllPlayersQueryForRoom } from '../components/firebase_calls/dbCalls';
import { auth } from '../utils/firebase';

const Lobby = () => {
    const navigate = useNavigate();
    const { roomID } = useParams();
    const [arrayOfPlayers, setArrayOfPlayers] = useState([]);
    const createAlert = CreateAlert();

    const logout = async () => {
        try {
            await signOut(auth);
            console.log('User successfully logged out');
            navigate('/');
        } catch (err) {
            console.error(err);
        }
    };

    // Live subscription, not a one-time fetch (docs/improvements.md item
    // 13, extended here from GameMasterView to Lobby) — a player joining
    // from another device now shows up without the GM reloading the page.
    useEffect(() => {
        if (!roomID) return undefined;
        const playersQuery = fetchAllPlayersQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            playersQuery,
            (snapshot) => {
                setArrayOfPlayers(snapshot.docs.map((doc) => doc.data().name));
            },
            (error) => {
                console.error(error);
                createAlert('error', 'Error updating arrayOfPlayers', 'Check console.', 1500);
            }
        );
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomID]);

    //navigates to lobby
    const handleLobbyRoom = async () => {
        //checks if arrayOfPlayers has at least two players
        if (arrayOfPlayers) {
            if (arrayOfPlayers.length <= 1) {
                return createAlert(
                    'error',
                    'Error',
                    'Not enough players (must have at least 2)',
                    1500
                );
            }
        } else {
            return createAlert('error', 'Error', 'arrayOfPlayers is not defined', 1500);
        }

        try {
            // GameMasterView derives its own player count from a live
            // Firestore subscription now, not router state
            // (docs/improvements.md item 13) — nothing reads this anymore.
            navigate(`/rooms/${roomID}/GameMasterView`);
        } catch (error) {
            console.error('Error navigating to game view: ', error);
            createAlert('error', 'Error navigating to game view', 'Check console.', 1500);
        }
    };

    // Single centered column: green banner (logo + Log Out) up top, then
    // game ID, roster, Remove Player, and Start Game below — replacing the
    // old 40/70 split-screen layout and its manual "Add Player" form, now
    // redundant since players self-join via JoinGame.js
    // (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md).
    return (
        <Flex h="100vh" w="100vw" direction="column">
            <Flex direction="column" w="100%" h="30%" bg="#66bf78">
                <Flex justify="flex-end" w="100%">
                    <Button
                        colorScheme="red"
                        m="12px"
                        borderRadius="2px"
                        variant="ghost"
                        _hover={{ bg: 'red', color: 'white' }}
                        onClick={logout}
                    >
                        Log Out
                    </Button>
                </Flex>
                <Flex flex="1" justify="center" align="center">
                    <Image src={mallLogo} alt="logo" w="120px" h="120px" />
                </Flex>
            </Flex>

            <Flex direction="column" w="100%" flex="1" bg="black" align="center" overflow="auto">
                <Heading as="h2" size="md" mt="4%" color="white">
                    Game ID: {roomID}
                </Heading>
                <Heading mt="4%" mb="1%">
                    Players ({arrayOfPlayers.length})
                </Heading>
                <Divider />

                <Flex flex="1" w="100%" justify="center" align="center" overflow="auto">
                    <PlayerList arrayOfPlayers={arrayOfPlayers} />
                </Flex>

                <Flex mb="2%" align="center" justify="center" w="100%">
                    {arrayOfPlayers.length > 0 && (
                        <PlayerRemove roomID={roomID} arrayOfPlayers={arrayOfPlayers} />
                    )}
                </Flex>

                <Flex mb="4%">
                    <TargetGenerator
                        roomID={roomID}
                        arrayOfPlayers={arrayOfPlayers}
                        handleLobbyRoom={handleLobbyRoom}
                    />
                </Flex>
            </Flex>
        </Flex>
    );
};

export default Lobby;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/pages/Lobby.test.jsx`
Expected: PASS — 7/7 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass. `src/components/lobby_components/PlayerAddition.js` and its test still exist on disk but are no longer imported by anything — `npm run lint` will not flag this (unused-file detection isn't part of this repo's ESLint config; only unused _imports/variables within a file_ are flagged), so the gate passes cleanly with the dead file still present. Task 3 removes it.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Lobby.js src/pages/Lobby.test.jsx
git commit -m "Simplify GM lobby to a single-column layout, drop manual Add Player"
```

---

### Task 3: Delete `PlayerAddition.js` and its test

**Files:**

- Delete: `src/components/lobby_components/PlayerAddition.js`
- Delete: `src/components/lobby_components/PlayerAddition.test.jsx`

**Interfaces:**

- Consumes: nothing — this task only removes files.
- Produces: nothing — no other file may reference `PlayerAddition` after this task.

- [ ] **Step 1: Confirm there are no remaining references**

Run: `grep -rn "PlayerAddition" src/ --include="*.js" --include="*.jsx"`
Expected: no output (Task 2 already removed `Lobby.js`'s import and usage — this is a safety check before deleting).

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/lobby_components/PlayerAddition.js src/components/lobby_components/PlayerAddition.test.jsx
```

- [ ] **Step 3: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass — deleting an unreferenced file and its own test cannot break anything else.

- [ ] **Step 4: Commit**

```bash
git commit -m "Delete PlayerAddition, unused after the simplified lobby redesign"
```

---

## Self-Review Notes

- **Spec coverage:** "Remove Add Player entirely" → Tasks 2 (usage removed) + 3 (file deleted). "Keep Remove Player" → Task 2's render tree keeps `PlayerRemove` unchanged. "Single-column layout, green banner + logo kept, game ID centered, list below" → Task 2's full rewrite. "Player list becomes a single column" → Task 1. "Everything structurally required stays (Start Game, live subscription, Log Out)" → Task 2 keeps `handleLobbyRoom`/the subscription effect/`logout` unchanged and re-tests all three. "Do not touch `dbCalls.addPlayerForRoom`" → no task modifies `dbCalls.js`.
- **Placeholder scan:** none — every step has complete, concrete code.
- **Type consistency:** `PlayerList`'s `{ arrayOfPlayers }` prop signature is identical before and after Task 1, so Task 2's `<PlayerList arrayOfPlayers={arrayOfPlayers} />` call site needed no changes. `PlayerRemove`/`TargetGenerator` props are unchanged from the original file throughout.
