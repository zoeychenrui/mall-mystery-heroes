# Player Selects Target/Mission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move photo-claim resolution (which target a kill photo claims, or which mission a photo claims to complete) from the moderator's approval-time dropdown to the player's own submission-time picker, so the moderator's job becomes purely "see the claim, approve or deny."

**Architecture:** A new pure function (`buildPhotoClaimOptions`) reuses the existing `killTargetsForAssassin`/`openMissionsForPlayer` logic to compute a player's own combined options, now called from the player's photo-submission modal instead of the moderator's approval screen. `submitKillPhoto` (Cloud Function) persists the player's claim onto the photo doc at submission time with shape-only validation; the real game-rule validation stays exactly where it already lives, in `executeKill`/`completeMission`, unchanged, at approval time.

**Tech Stack:** React (CRA), Chakra UI, Firebase (Firestore, Cloud Functions, Auth), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md`

## Global Constraints

- **Pure approve/deny, no moderator override.** No task adds any edit/override control to `PhotosDisplay.js`. Once a player has submitted a claim, the moderator can only Approve or Deny it as-is.
- **`submitKillPhoto` validates claim shape only, not game-rule validity.** Exactly one of a non-blank string `target` or an integer `mission` must be present in the callable's `data`; anything else throws `invalid-argument`. It does **not** re-derive "is this actually a valid kill target / open mission" — that check already exists, unchanged, in `executeKill`/`killPlayer.js` and `completeMission`/`planMissionCompletion` at approval time.
- **`dbCalls.js`'s `approvePhotoForRoom`/`approvePhotoAsMissionForRoom` signatures do not change.** Only the _source_ of the arguments `PhotosDisplay.js` passes them changes — from dropdown-derived state to the photo doc's own already-set `target`/`mission` fields.
- **The `killPhoto` playerMessages doc keeps writing `target: null` unconditionally**, regardless of what the player claimed — the public chat feed never reveals a claim before a moderator has approved it.
- **No special-case handling for a photo submitted under the old code** (a pending photo with neither `target` nor `mission` set). The moderator's Approve button simply stays disabled/no-ops on such a photo; Deny still works. No dedicated messaging.
- **Moderator display wording, verbatim:** `` `${assassin}'s kill attempt on ${target}` `` for a kill claim; `` `${assassin}'s mission attempt: ${missionTitle}` `` for a mission claim.
- **No firestore.rules changes anywhere in this plan.** Confirmed fresh: `firestore.rules`' `players` and `tasks` subcollection matches already grant `allow read: if isHostOrPlayerOfRoom(roomId)` — every player already has the read access this feature needs.

---

### Task 1: `openMissionsForPlayer` gains an `isPlayerDead` filter

**Files:**

- Modify: `src/game/missionCompletion.js`
- Test: `src/game/missionCompletion.test.js`

**Interfaces:**

- Produces: `openMissionsForPlayer(missions, playerName, isPlayerDead)` — same return shape as today (filtered array of mission objects), now additionally excluding any `taskType === 'Revival Mission'` entry when `isPlayerDead` is falsy.

- [ ] **Step 1: Write the failing tests**

Open `src/game/missionCompletion.test.js` and find the existing `describe('openMissionsForPlayer', ...)` block (it already has tests for excluding an ended mission and one this player already completed). Add these new tests inside that same block:

```js
it('excludes a Revival Mission when the player is alive', () => {
    const missions = [
        {
            taskIndex: 1,
            title: 'Revive Bob',
            taskType: 'Revival Mission',
            isComplete: false,
            completedBy: [],
        },
    ];

    expect(openMissionsForPlayer(missions, 'alice', false)).toEqual([]);
});

it('includes a Revival Mission when the player is dead', () => {
    const missions = [
        {
            taskIndex: 1,
            title: 'Revive Bob',
            taskType: 'Revival Mission',
            isComplete: false,
            completedBy: [],
        },
    ];

    expect(openMissionsForPlayer(missions, 'alice', true)).toEqual(missions);
});

it('includes a Task-type mission regardless of isPlayerDead', () => {
    const missions = [
        {
            taskIndex: 1,
            title: 'Find the clue',
            taskType: 'Task',
            isComplete: false,
            completedBy: [],
        },
    ];

    expect(openMissionsForPlayer(missions, 'alice', false)).toEqual(missions);
    expect(openMissionsForPlayer(missions, 'alice', true)).toEqual(missions);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/game/missionCompletion.test.js -v`
Expected: the three new tests FAIL — `openMissionsForPlayer` currently takes only two parameters and never filters on `taskType`, so a Revival Mission is still included when `isPlayerDead` is `false`.

- [ ] **Step 3: Implement the filter**

In `src/game/missionCompletion.js`, replace the existing `openMissionsForPlayer` with:

```js
const openMissionsForPlayer = (missions, playerName, isPlayerDead) =>
    missions.filter(
        (mission) =>
            !mission.isComplete &&
            !mission.completedBy.includes(playerName) &&
            (mission.taskType !== 'Revival Mission' || isPlayerDead)
    );
```

- [ ] **Step 4: Run the full file's tests to verify they pass**

Run: `npx jest src/game/missionCompletion.test.js -v`
Expected: PASS, all tests in the file (old and new).

- [ ] **Step 5: Commit**

```bash
git add src/game/missionCompletion.js src/game/missionCompletion.test.js
git commit -m "Filter Revival Missions out of openMissionsForPlayer for a living player"
```

---

### Task 2: `buildPhotoClaimOptions` — the player's combined-options helper

**Files:**

- Create: `src/game/photoClaimOptions.js`
- Test: `src/game/photoClaimOptions.test.js`

**Interfaces:**

- Consumes: `killTargetsForAssassin(players, assassinName)` from `src/game/killTargets.js` (already exists — returns `string[]` of target names, `[]` if the assassin isn't found in `players`); `openMissionsForPlayer(missions, playerName, isPlayerDead)` from Task 1; `normalizePlayerName(name)` from `src/game/playerNames.js` (already exists).
- Produces: `buildPhotoClaimOptions(players, missions, playerName)` → `Array<{ value: string, label: string, group: 'Kill Target' | 'Mission' }>`. `value` is `` `target:${targetName}` `` for a kill option or `` `mission:${taskIndex}` `` for a mission option — this exact string format is what `KillPhotoModal.js` (Task 4) and `MessageComposer.js` (Task 5) parse back apart later.

- [ ] **Step 1: Write the failing tests**

Create `src/game/photoClaimOptions.test.js`:

```js
import { buildPhotoClaimOptions } from './photoClaimOptions';

const players = [
    { name: 'alice', targets: ['bob'], isAlive: true, openSeason: false },
    { name: 'bob', targets: [], isAlive: true, openSeason: false },
    { name: 'carol', targets: [], isAlive: true, openSeason: true },
];

describe('buildPhotoClaimOptions', () => {
    it('combines the player’s own kill targets and open missions into one array', () => {
        const missions = [
            {
                taskIndex: 1,
                title: 'Find the clue',
                taskType: 'Task',
                isComplete: false,
                completedBy: [],
            },
        ];

        const result = buildPhotoClaimOptions(players, missions, 'alice');

        expect(result).toEqual(
            expect.arrayContaining([
                { value: 'target:bob', label: 'bob', group: 'Kill Target' },
                { value: 'mission:1', label: 'Find the clue', group: 'Mission' },
            ])
        );
        expect(result).toHaveLength(2);
    });

    it('includes an open-season player alongside the assassin’s own target', () => {
        const result = buildPhotoClaimOptions(players, [], 'alice');

        expect(result).toEqual(
            expect.arrayContaining([
                { value: 'target:bob', label: 'bob', group: 'Kill Target' },
                { value: 'target:carol', label: 'carol', group: 'Kill Target' },
            ])
        );
    });

    it('returns an empty array when the player has no targets and no open missions', () => {
        expect(buildPhotoClaimOptions(players, [], 'bob')).toEqual([]);
    });

    it('excludes a Revival Mission for a living player, includes it for a dead one', () => {
        const missions = [
            {
                taskIndex: 3,
                title: 'Revive Dave',
                taskType: 'Revival Mission',
                isComplete: false,
                completedBy: [],
            },
        ];
        const withDeadBob = [
            { name: 'alice', targets: [], isAlive: true, openSeason: false },
            { name: 'bob', targets: [], isAlive: false, openSeason: false },
        ];

        expect(buildPhotoClaimOptions(withDeadBob, missions, 'alice')).toEqual([]);
        expect(buildPhotoClaimOptions(withDeadBob, missions, 'bob')).toEqual([
            { value: 'mission:3', label: 'Revive Dave', group: 'Mission' },
        ]);
    });

    it('excludes a mission this player already completed, normalizing display-cased names', () => {
        const missions = [
            {
                taskIndex: 1,
                title: 'Find the clue',
                taskType: 'Task',
                isComplete: false,
                completedBy: ['alice'],
            },
        ];

        expect(buildPhotoClaimOptions(players, missions, 'Alice')).toEqual([]);
    });

    it('returns an empty kill-target list for a player not found in the roster, without throwing', () => {
        expect(buildPhotoClaimOptions(players, [], 'nobody')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/game/photoClaimOptions.test.js -v`
Expected: FAIL — `src/game/photoClaimOptions.js` doesn't exist yet (`Cannot find module './photoClaimOptions'`).

- [ ] **Step 3: Implement `buildPhotoClaimOptions`**

Create `src/game/photoClaimOptions.js`:

```js
/**
 * Combines a player's own kill-target options and open-mission options
 * into one array, for the player's own photo-submission picker
 * (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md).
 * This is the exact shape PhotosDisplay.js's moderator-side dropdown used
 * to build inline before this feature moved the pick to submission time —
 * now computed for the submitting player instead of a resolved photo's
 * assassin.
 */
import { killTargetsForAssassin } from './killTargets';
import { openMissionsForPlayer } from './missionCompletion';
import { normalizePlayerName } from './playerNames';

/**
 * @param {Array<{name: string, targets?: string[], openSeason?: boolean, isAlive?: boolean}>} players
 * @param {Array<{taskIndex: number, title: string, taskType: string, isComplete: boolean, completedBy: string[]}>} missions
 * @param {string} playerName
 * @returns {Array<{value: string, label: string, group: 'Kill Target' | 'Mission'}>}
 */
export const buildPhotoClaimOptions = (players, missions, playerName) => {
    const normalizedName = normalizePlayerName(playerName);
    const playerRow = players.find((player) => normalizePlayerName(player.name) === normalizedName);
    const isPlayerDead = playerRow ? !playerRow.isAlive : false;

    const killTargets = killTargetsForAssassin(players, playerName);
    const openMissions = openMissionsForPlayer(missions, normalizedName, isPlayerDead);

    return [
        ...killTargets.map((target) => ({
            value: `target:${target}`,
            label: target,
            group: 'Kill Target',
        })),
        ...openMissions.map((mission) => ({
            value: `mission:${mission.taskIndex}`,
            label: mission.title,
            group: 'Mission',
        })),
    ];
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/game/photoClaimOptions.test.js -v`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/game/photoClaimOptions.js src/game/photoClaimOptions.test.js
git commit -m "Add buildPhotoClaimOptions, the player-side photo-claim picker helper"
```

---

### Task 3: `submitKillPhoto` persists the player's claim

**Files:**

- Modify: `functions/callableFunctions/submitKillPhoto.js`
- Modify: `src/components/submitKillPhoto.integration.test.js` (this is the real, current file — it lives here, not under `functions/callableFunctions/`, and tests the deployed Cloud Function through the emulator via `httpsCallable`, matching `executeKill.integration.test.js`'s approach)

**Interfaces:**

- Produces: `submitKillPhoto` now accepts `{ roomId, url, target, mission }` in its callable `data` (both `target` and `mission` optional at the wire level, but exactly one must resolve to a valid value or the call rejects). The photo doc it creates now has real `target`/`mission` values instead of hardcoded `null`s. Later tasks (4, 5) will start sending these fields from the client; this task must work correctly when they're absent too — a call sending neither now gets rejected cleanly rather than silently writing an unclaimed photo, which is a real behavior change that breaks nearly every existing test in this file (they all currently call with no `target`/`mission` at all), addressed explicitly below.

- [ ] **Step 1: Read both files fresh**

Read `functions/callableFunctions/submitKillPhoto.js` and `src/components/submitKillPhoto.integration.test.js` in full before changing anything — the exact current transaction/write shape must be preserved (rate limiting, room-active check, single-player-doc-per-uid check, `killPhoto` playerMessages doc), and every existing test in the file currently calls `submitKillPhoto` with no `target`/`mission` at all, which the new validation will now reject — Step 2 below updates each one by name.

- [ ] **Step 2: Update the existing tests, and add new ones**

In `src/components/submitKillPhoto.integration.test.js`, make these exact changes, in order:

**2a.** In `"writes the photo with the caller's own real name as assassin, never a client-supplied one, and no target yet"`: change `await call({ roomId: ROOM, url: REALISTIC_URL });` to `await call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' });`, and change the assertion's `target: null, mission: null` to `target: 'bob', mission: null`. Rename the test to `"writes the photo with the caller's own real name as assassin, never a client-supplied one, carrying their claimed target"`.

**2b.** In `"also posts the photo into the room's chat, so submitting is visible without a separate confirmation"`: change `await call({ roomId: ROOM, url: REALISTIC_URL });` to `await call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' });`. Leave the assertion's `target: null` on the playerMessages doc exactly as it is — this now meaningfully proves the claim never leaks into the public message, instead of vacuously matching a claim-free call.

**2c.** `"rejects a url that does not point at this room's own Storage path"` and `"rejects a submission missing roomId or url"` need no change — both checks run before the new claim validation, so they still reject for their own original reason regardless of `target`/`mission`.

**2d.** In `"rejects a caller who is not a player of the room"`: change `call({ roomId: ROOM, url: REALISTIC_URL })` to `call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })`.

**2e.** In `"rejects a caller whose uid is linked to more than one player doc in the room"`: change `call({ roomId: ROOM, url: REALISTIC_URL })` to `call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })`.

**2f.** In `"rejects once the game has ended"`: change `call({ roomId: ROOM, url: REALISTIC_URL })` to `call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })`.

**2g.** In `"allows up to 10 submissions in a window and rejects the 11th"`: change both `call({ roomId: ROOM, url: REALISTIC_URL })` occurrences (inside the loop and the 11th call) to `call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })`.

**2h.** In `"allows a submission again once the window has elapsed, even if the cap was reached"`: change `call({ roomId: ROOM, url: REALISTIC_URL })` to `call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })`.

**2i.** Add these five new tests at the end of the `describe('submitKillPhoto', ...)` block, right before its closing `});`:

```js
it('persists a valid mission claim onto the photo doc instead of a target', async () => {
    const alice = await createIndependentIdentity();
    try {
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
        const call = httpsCallable(alice.functions, 'submitKillPhoto');

        await call({ roomId: ROOM, url: REALISTIC_URL, mission: 3 });

        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs[0].data()).toMatchObject({ target: null, mission: 3 });
    } finally {
        await terminate(alice.db);
    }
});

it('rejects a submission with neither a target nor a mission, writing nothing', async () => {
    const alice = await createIndependentIdentity();
    try {
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
        const call = httpsCallable(alice.functions, 'submitKillPhoto');

        await expect(call({ roomId: ROOM, url: REALISTIC_URL })).rejects.toThrow(
            'Exactly one of target or mission must be provided.'
        );
        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(0);
    } finally {
        await terminate(alice.db);
    }
});

it('rejects a submission with both a target and a mission, writing nothing', async () => {
    const alice = await createIndependentIdentity();
    try {
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
        const call = httpsCallable(alice.functions, 'submitKillPhoto');

        await expect(
            call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob', mission: 3 })
        ).rejects.toThrow('Exactly one of target or mission must be provided.');
        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(0);
    } finally {
        await terminate(alice.db);
    }
});

it('rejects a blank-string target, writing nothing', async () => {
    const alice = await createIndependentIdentity();
    try {
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
        const call = httpsCallable(alice.functions, 'submitKillPhoto');

        await expect(call({ roomId: ROOM, url: REALISTIC_URL, target: '   ' })).rejects.toThrow(
            'Exactly one of target or mission must be provided.'
        );
        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(0);
    } finally {
        await terminate(alice.db);
    }
});

it('rejects a non-integer mission, writing nothing', async () => {
    const alice = await createIndependentIdentity();
    try {
        await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
        const call = httpsCallable(alice.functions, 'submitKillPhoto');

        await expect(call({ roomId: ROOM, url: REALISTIC_URL, mission: 1.5 })).rejects.toThrow(
            'Exactly one of target or mission must be provided.'
        );
        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(0);
    } finally {
        await terminate(alice.db);
    }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `package.json`'s own `test:emulator` script, scoped to this file):

```bash
node functions/scripts/sync-shared-game-logic.js && firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,auth,functions,storage "npx jest --selectProjects integration --runInBand -t submitKillPhoto"
```

Expected: the 5 new tests FAIL (the function doesn't validate or persist `target`/`mission` yet), and several of the pre-existing tests (2a, 2b) also FAIL against their updated assertions for the same reason.

- [ ] **Step 4: Implement the change**

In `functions/callableFunctions/submitKillPhoto.js`, change the argument destructuring and validation right after the existing `roomId`/`url` check:

```js
const { roomId, url, target, mission } = data;
if (!roomId || !url) {
    throw new functions.https.HttpsError('invalid-argument', 'roomId and url are both required.');
}
if (!isValidKillPhotoUrl(url, roomId)) {
    throw new functions.https.HttpsError(
        'invalid-argument',
        "url does not point at this room's own Storage path."
    );
}

// Shape-only validation — this does NOT re-derive "is this actually a
// valid kill target / open mission for this player," which already
// happens, unchanged, in executeKill/killPlayer.js and
// completeMission/planMissionCompletion at approval time
// (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md).
const hasTarget = typeof target === 'string' && target.trim().length > 0;
const hasMission = typeof mission === 'number' && Number.isInteger(mission);
if (hasTarget === hasMission) {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'Exactly one of target or mission must be provided.'
    );
}
```

Then update the `photos` doc creation (further down, inside the transaction's write phase) from:

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

to:

```js
transaction.create(roomRef.collection('photos').doc(), {
    url,
    assassin: assassinData.name,
    target: hasTarget ? target : null,
    mission: hasMission ? mission : null,
    timestamp: FieldValue.serverTimestamp(),
    status: 'pending',
    originalPlayerData: null,
});
```

Leave the `killPhoto` playerMessages doc's own `transaction.create(...)` call completely untouched — it must keep writing `target: null` unconditionally (Global Constraints).

Also update the function's own doc comment (the block starting "Does not take a `target` argument at all") to reflect the new behavior — replace it with:

```js
 * Persists the caller's own claimed target or mission onto the photo doc
 * at submission time — a player now picks who they're claiming to have
 * killed, or which mission they're claiming to have completed, before
 * submitting (docs/superpowers/specs/
 * 2026-09-02-player-selects-target-mission-design.md). Validates shape
 * only (exactly one of a non-blank target string or an integer mission
 * must be present) — it does NOT re-validate that the claim is actually
 * correct given live game state; that check already exists, unchanged,
 * in executeKill/killPlayer.js and completeMission/planMissionCompletion
 * at approval time. The `killPhoto` playerMessages doc below keeps
 * writing `target: null` regardless of the claim — the public chat feed
 * never reveals a claim before a moderator has approved it.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run the same command as Step 3.
Expected: PASS — all 5 new tests, and every pre-existing test in the file including the two updated in Steps 2a/2b.

- [ ] **Step 6: Commit**

```bash
git add functions/callableFunctions/submitKillPhoto.js src/components/submitKillPhoto.integration.test.js
git commit -m "submitKillPhoto persists the player's claimed target or mission"
```

---

### Task 4: `KillPhotoModal` gains the claim picker

**Files:**

- Modify: `src/components/player_messages_components/KillPhotoModal.js`
- Test: `src/components/player_messages_components/KillPhotoModal.test.jsx`

**Interfaces:**

- Consumes: `buildPhotoClaimOptions(players, missions, playerName)` from Task 2.
- Produces: `KillPhotoModal` now takes three additional props — `players` (array, same shape Task 2 expects), `missions` (array, same shape Task 2 expects), `playerName` (string). Its `onSubmit` prop is now called as `onSubmit(claimValue)` (a `'target:...'`/`'mission:...'` string) instead of `onSubmit()` with no argument — Task 5 depends on this exact call signature.

- [ ] **Step 1: Read the current file fresh**

Read `src/components/player_messages_components/KillPhotoModal.js` and `src/components/player_messages_components/KillPhotoModal.test.jsx` in full before changing anything — this plan's code below assumes the file's current props (`isOpen`, `onClose`, `previewUrl`, `error`, `onSubmit`) and JSX structure exactly as read earlier this session; verify nothing has drifted.

- [ ] **Step 2: Write the failing tests**

Replace `src/components/player_messages_components/KillPhotoModal.test.jsx`'s entire content with:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Presentational, but now owns the player's claim picker
 * (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md)
 * — computed from players/missions/playerName props via
 * buildPhotoClaimOptions, mirroring PhotosDisplay.js's old moderator
 * dropdown exactly, just relocated to the submitting player's own screen.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KillPhotoModal from './KillPhotoModal';

const onClose = jest.fn();
const onSubmit = jest.fn();

const mountModal = (props = {}) =>
    render(
        <ChakraProvider>
            <KillPhotoModal
                isOpen={true}
                onClose={onClose}
                previewUrl="blob:preview"
                error={null}
                onSubmit={onSubmit}
                players={[{ name: 'alice', targets: ['bob'], isAlive: true, openSeason: false }]}
                missions={[]}
                playerName="alice"
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('KillPhotoModal', () => {
    it('auto-resolves and shows plain text when there is exactly one option', () => {
        mountModal();

        expect(screen.queryByLabelText('Select target or mission')).not.toBeInTheDocument();
        expect(screen.getByText('Target: bob')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();
    });

    it('shows a dropdown grouped by Kill Target/Mission when there is more than one option', async () => {
        mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
            missions: [
                {
                    taskIndex: 1,
                    title: 'Find the clue',
                    taskType: 'Task',
                    isComplete: false,
                    completedBy: [],
                },
            ],
        });

        expect(screen.getByLabelText('Select target or mission')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'bob' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'carol' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Find the clue' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('enables Submit once a pick is made from the dropdown, and calls onSubmit with the resolved claim', async () => {
        mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
        });

        await userEvent.selectOptions(screen.getByLabelText('Select target or mission'), 'carol');
        expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith('target:carol');
    });

    it('calls onSubmit with the auto-resolved claim when there is only one option', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith('target:bob');
    });

    it('shows a message and disables Submit when there are no options at all', () => {
        mountModal({ players: [{ name: 'alice', targets: [], isAlive: true, openSeason: false }] });

        expect(
            screen.getByText('No open targets or missions for this player.')
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('is still disabled while previewUrl has not arrived yet, even with a resolved option', () => {
        mountModal({ previewUrl: null });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('shows the error banner and no preview image when error is set', () => {
        mountModal({ previewUrl: null, error: 'Could not read that photo. Try taking it again.' });

        expect(
            screen.getByText('Could not read that photo. Try taking it again.')
        ).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/components/player_messages_components/KillPhotoModal.test.jsx -v`
Expected: FAIL — the current component takes no `players`/`missions`/`playerName` props and has no picker at all.

- [ ] **Step 4: Implement the picker**

Replace `src/components/player_messages_components/KillPhotoModal.js`'s entire content with:

```jsx
import React, { useEffect, useState } from 'react';
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Flex,
    Image,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Select,
    Spinner,
    Text,
} from '@chakra-ui/react';
import { buildPhotoClaimOptions } from '../../game/photoClaimOptions';

// A player submits a kill-photo or mission-photo claim. Presentational,
// but now owns the player's own claim picker
// (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md)
// — mirrors PhotosDisplay.js's old moderator-side dropdown exactly
// (single option auto-resolves and is shown as plain text; multiple
// options show a grouped <Select>; zero options disables Submit with a
// plain message), just computed for the submitting player instead of a
// resolved photo's assassin.
// MessageComposer.js owns capturing, compressing, and uploading/writing
// the photo (its camera button triggers a hidden file input directly,
// always mounted so it can be triggered before this modal has ever
// opened); this modal renders whatever MessageComposer hands it and
// reports back the player's resolved claim
// (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
const KillPhotoModal = ({
    isOpen,
    onClose,
    previewUrl,
    error,
    onSubmit,
    players,
    missions,
    playerName,
}) => {
    const [selectedOption, setSelectedOption] = useState('');

    // A pick made before the modal was last opened must never carry over
    // into the next photo's default.
    useEffect(() => {
        if (isOpen) setSelectedOption('');
    }, [isOpen]);

    const combinedOptions = buildPhotoClaimOptions(players, missions, playerName);
    const killTargetOptions = combinedOptions.filter((option) => option.group === 'Kill Target');
    const missionOptions = combinedOptions.filter((option) => option.group === 'Mission');

    const effectiveSelection =
        combinedOptions.length === 1
            ? combinedOptions[0].value
            : combinedOptions.some((option) => option.value === selectedOption)
              ? selectedOption
              : '';

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {previewUrl && (
                        <Box mb={4}>
                            <Image src={previewUrl} alt="Kill photo preview" maxH="200px" />
                        </Box>
                    )}
                    {error && (
                        <Alert status="error" mb={4}>
                            <AlertIcon />
                            {error}
                        </Alert>
                    )}
                    {!previewUrl && !error && (
                        <Flex align="center" mb={4}>
                            <Spinner size="sm" mr={2} />
                            <Text>Processing photo…</Text>
                        </Flex>
                    )}
                    {combinedOptions.length > 1 ? (
                        <Select
                            aria-label="Select target or mission"
                            placeholder="Choose target or mission"
                            value={effectiveSelection}
                            onChange={(event) => setSelectedOption(event.target.value)}
                        >
                            {killTargetOptions.length > 0 && (
                                <optgroup label="Kill Target">
                                    {killTargetOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {missionOptions.length > 0 && (
                                <optgroup label="Mission">
                                    {missionOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </Select>
                    ) : combinedOptions.length === 0 ? (
                        <Text color="gray.400">No open targets or missions for this player.</Text>
                    ) : (
                        effectiveSelection &&
                        (effectiveSelection.startsWith('mission:') ? (
                            <Text>Mission: {missionOptions[0]?.label}</Text>
                        ) : (
                            <Text>Target: {killTargetOptions[0]?.label}</Text>
                        ))
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    <Button
                        colorScheme="teal"
                        onClick={() => onSubmit(effectiveSelection)}
                        isDisabled={!previewUrl || !effectiveSelection}
                    >
                        Submit
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default KillPhotoModal;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/components/player_messages_components/KillPhotoModal.test.jsx -v`
Expected: PASS, all 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/KillPhotoModal.js src/components/player_messages_components/KillPhotoModal.test.jsx
git commit -m "KillPhotoModal gains the player's own claim picker"
```

---

### Task 5: `MessageComposer` wires the claim through to submission

**Files:**

- Modify: `src/components/player_messages_components/MessageComposer.js`
- Modify: `src/components/submitKillPhoto.js`
- Test: `src/components/player_messages_components/MessageComposer.test.jsx`

**Interfaces:**

- Consumes: `KillPhotoModal`'s new `players`/`missions`/`playerName` props and its `onSubmit(claimValue)` call signature (Task 4); `submitKillPhoto`'s new accepted fields (Task 3).
- Produces: `MessageComposer` now takes two additional props — `players`, `missions` — forwarded straight through to `KillPhotoModal`. Task 6 depends on this exact prop contract.

- [ ] **Step 1: Read the current files fresh**

Read `src/components/player_messages_components/MessageComposer.js`, `src/components/player_messages_components/MessageComposer.test.jsx`, and `src/components/submitKillPhoto.js` in full before changing anything. Confirm as you read: `MessageComposer.test.jsx` renders the real `KillPhotoModal` (not stubbed — see its own header comment), and its `mountComposer(playerName = 'Alice', targets = ['bob'], extraProps = {})` helper already threads a `targets` prop that the real component has never actually consumed since the zero-targets gate was removed (vestigial, harmless — leave it as-is, don't wire it to anything new).

- [ ] **Step 2: Update `submitKillPhoto.js`, the thin wrapper**

`src/components/submitKillPhoto.js` already destructures a `target` argument (currently unused by any real call site) but has no `mission`. Replace its exported function with:

```js
export const submitKillPhoto = async ({ roomId, target, mission, url }) => {
    await submitKillPhotoCallable({ roomId, target, mission, url });
};
```

Update the file's doc comment's `@throws` block above the function to mention both `target` and `mission` as the two mutually exclusive claim fields, matching the Cloud Function's own new validation from Task 3.

- [ ] **Step 3: Write the failing tests**

In `src/components/player_messages_components/MessageComposer.test.jsx`, make three changes:

**3a. Give `mountComposer` a default `players`/`missions` fixture** so every existing test that clicks Submit keeps auto-resolving to exactly one option, unchanged in behavior. Replace:

```js
const mountComposer = (playerName = 'Alice', targets = ['bob'], extraProps = {}) =>
    render(
        <ChakraProvider>
            <MessageComposer
                roomID="room-a"
                playerName={playerName}
                targets={targets}
                {...extraProps}
            />
        </ChakraProvider>
    );
```

with:

```js
const mountComposer = (playerName = 'Alice', targets = ['bob'], extraProps = {}) =>
    render(
        <ChakraProvider>
            <MessageComposer
                roomID="room-a"
                playerName={playerName}
                targets={targets}
                players={[{ name: 'Alice', targets: ['bob'], isAlive: true, openSeason: false }]}
                missions={[]}
                {...extraProps}
            />
        </ChakraProvider>
    );
```

(`extraProps` still overrides `players`/`missions` when a test passes its own, since it spreads last.)

**3b. Fix the one existing test whose `submitKillPhoto` assertion is now incomplete.** In `'closes the modal immediately when Submit is clicked, before uploadKillPhoto or submitKillPhoto resolve'`, replace:

```js
await waitFor(() =>
    expect(submitKillPhoto).toHaveBeenCalledWith({
        roomId: 'room-a',
        url: 'https://example.com/photo.jpg',
    })
);
```

with:

```js
await waitFor(() =>
    expect(submitKillPhoto).toHaveBeenCalledWith({
        roomId: 'room-a',
        url: 'https://example.com/photo.jpg',
        target: 'bob',
        mission: null,
    })
);
```

**3c. Add three new tests**, right after that same test (still inside the `describe('MessageComposer', ...)` block):

```js
it('submits the resolved target claim, split into target/mission fields', async () => {
    mountComposer();

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
        expect(submitKillPhoto).toHaveBeenCalledWith({
            roomId: 'room-a',
            url: 'https://example.com/photo.jpg',
            target: 'bob',
            mission: null,
        })
    );
});

it('submits a mission claim, split into target/mission fields, when that is the only open option', async () => {
    mountComposer('Alice', ['bob'], {
        players: [{ name: 'Alice', targets: [], isAlive: true, openSeason: false }],
        missions: [
            {
                taskIndex: 3,
                title: 'Find the clue',
                taskType: 'Task',
                isComplete: false,
                completedBy: [],
            },
        ],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
        expect(submitKillPhoto).toHaveBeenCalledWith({
            roomId: 'room-a',
            url: 'https://example.com/photo.jpg',
            target: null,
            mission: 3,
        })
    );
});

it('passes players and missions through to KillPhotoModal’s picker', async () => {
    mountComposer('Alice', ['bob'], {
        players: [{ name: 'Alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false }],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

    expect(await screen.findByLabelText('Select target or mission')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'carol' })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest src/components/player_messages_components/MessageComposer.test.jsx -v`
Expected: FAIL — `MessageComposer` doesn't yet accept or forward `players`/`missions`, and `handlePhotoSubmit` doesn't yet parse a claim value out of `onSubmit`. (The pre-existing tests that click Submit will also fail at this point, since `KillPhotoModal` — once Task 4 lands — requires `players`/`missions` to resolve a claim before enabling Submit at all; they should turn green again once Step 5 below wires `MessageComposer` to actually forward the new default props.)

- [ ] **Step 5: Implement the wiring**

In `src/components/player_messages_components/MessageComposer.js`:

1. Add `players = []` and `missions = []` to the destructured props.
2. Replace `handlePhotoSubmit`'s signature and body:

```js
const handlePhotoSubmit = async (claimValue) => {
    const blobToSubmit = compressedBlob;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCompressedBlob(null);
    setPreviewUrl(null);
    setPhotoError(null);
    setIsPhotoModalOpen(false);
    const target = claimValue.startsWith('target:') ? claimValue.slice('target:'.length) : null;
    const mission = claimValue.startsWith('mission:')
        ? Number(claimValue.slice('mission:'.length))
        : null;
    try {
        const url = await uploadKillPhoto(roomID, blobToSubmit);
        await submitKillPhoto({ roomId: roomID, url, target, mission });
    } catch (submitError) {
        console.error('Error submitting kill photo:', submitError);
        createAlert(
            'error',
            'Error submitting kill photo',
            submitError.message ||
                'Could not submit the photo. Check your connection and try again.',
            1500
        );
    }
};
```

3. Update the `<KillPhotoModal ... />` JSX to also pass `players={players}`, `missions={missions}`, `playerName={playerName}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/components/player_messages_components/MessageComposer.test.jsx -v`
Expected: PASS, all tests (old and new).

- [ ] **Step 7: Commit**

```bash
git add src/components/player_messages_components/MessageComposer.js src/components/player_messages_components/MessageComposer.test.jsx src/components/submitKillPhoto.js
git commit -m "MessageComposer forwards the resolved claim to submitKillPhoto"
```

---

### Task 6: `PlayerGame` subscribes to the roster and missions

**Files:**

- Modify: `src/pages/PlayerGame.js`
- Test: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `MessageComposer`'s new `players`/`missions` props (Task 5); `fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID)` and `fetchTasksQueryForRoom(roomID)` from `src/components/firebase_calls/dbCalls.js` (both already exist).

- [ ] **Step 1: Read the current file fresh**

Read `src/pages/PlayerGame.js` in full — this session already modified it earlier today (View Missions popup), so re-read it now rather than trusting any prior description. Read `src/pages/GameMasterView.js:1-61` for the exact `players` subscription/field-mapping shape to mirror.

- [ ] **Step 2: Write the failing tests**

In `src/pages/PlayerGame.test.jsx`, update the existing `jest.mock('../components/player_messages_components/MessageComposer', ...)` stub to also surface the `players`/`missions` props it receives (add to the stub's rendered text, following the same pattern the existing stub already uses for `roomID`/`playerName`/`isGameActive`):

```jsx
jest.mock('../components/player_messages_components/MessageComposer', () => (props) => (
    <div>
        <div>
            message-composer-stub roomID={props.roomID} playerName={props.playerName} isGameActive=
            {String(props.isGameActive)} players={JSON.stringify(props.players)} missions=
            {JSON.stringify(props.missions)}
        </div>
        <button
            onClick={() =>
                props.onOptimisticSend({
                    id: 'test-pending-id',
                    type: 'chat',
                    sender: props.playerName,
                    text: 'hello',
                })
            }
        >
            trigger-optimistic-send
        </button>
        <button onClick={() => props.onOptimisticSendFailed('test-pending-id')}>
            trigger-optimistic-fail
        </button>
    </div>
));
```

Add `fetchPlayersQueryByDescendPointsThenIsAliveForRoom` and `fetchTasksQueryForRoom` to the existing `jest.mock('../components/firebase_calls/dbCalls', ...)` factory (both as `jest.fn()`), and add this new test:

```js
it('subscribes to the roster and missions once the game has started, and passes both to MessageComposer', () => {
    writePlayerSession('Fluffy42317', 'Alice');
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom.mockReturnValue('players-query');
    fetchTasksQueryForRoom.mockReturnValue('missions-query');
    onSnapshot.mockImplementation((ref, callback) => {
        if (ref === 'room-ref') {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
        } else if (ref === 'player-ref') {
            callback({ exists: () => true, data: () => ({ isAlive: true, targets: ['Bob'] }) });
        } else if (ref === 'players-query') {
            callback({
                docs: [
                    {
                        data: () => ({
                            name: 'Bob',
                            score: 0,
                            targets: [],
                            openSeason: false,
                            isAlive: true,
                        }),
                    },
                ],
            });
        } else if (ref === 'missions-query') {
            callback({
                docs: [
                    {
                        data: () => ({
                            taskIndex: 1,
                            title: 'Find the clue',
                            taskType: 'Task',
                            isComplete: false,
                            completedBy: [],
                        }),
                    },
                ],
            });
        }
        return () => {};
    });

    renderWaiting();

    expect(
        screen.getByText(
            'message-composer-stub roomID=Fluffy42317 playerName=Alice isGameActive=true players=' +
                JSON.stringify([
                    { name: 'Bob', score: 0, targets: [], openSeason: false, isAlive: true },
                ]) +
                ' missions=' +
                JSON.stringify([
                    {
                        taskIndex: 1,
                        title: 'Find the clue',
                        taskType: 'Task',
                        isComplete: false,
                        completedBy: [],
                    },
                ])
        )
    ).toBeInTheDocument();
});
```

Add the two new imports at the top of the test file:

```js
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchTasksQueryForRoom,
} from '../components/firebase_calls/dbCalls';
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/pages/PlayerGame.test.jsx -v`
Expected: FAIL — `PlayerGame` doesn't yet subscribe to a roster or missions query, so `MessageComposer` never receives non-empty `players`/`missions` props.

- [ ] **Step 4: Implement the subscriptions**

In `src/pages/PlayerGame.js`:

1. Add to the imports from `../components/firebase_calls/dbCalls`:

```js
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom,
    fetchTasksQueryForRoom,
} from '../components/firebase_calls/dbCalls';
```

2. Add two new state variables near the top of the component, alongside the existing `playerData` state:

```js
const [players, setPlayers] = useState([]);
const [missions, setMissions] = useState([]);
```

3. Add two new `useEffect` subscriptions, placed after the existing player-doc subscription effect — gated the same way that effect already is (only once `gameStarted` and `playerName` are known), mirroring `GameMasterView.js`'s own field mapping exactly:

```js
useEffect(() => {
    if (!roomID || !gameStarted) return undefined;
    const playersQuery = fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID);
    const unsubscribe = onSnapshot(playersQuery, (snapshot) => {
        setPlayers(
            snapshot.docs.map((doc) => ({
                name: doc.data().name,
                score: doc.data().score,
                targets: doc.data().targets,
                openSeason: doc.data().openSeason,
                isAlive: doc.data().isAlive,
            }))
        );
    });
    return () => unsubscribe();
}, [roomID, gameStarted]);

useEffect(() => {
    if (!roomID || !gameStarted) return undefined;
    const missionsQuery = fetchTasksQueryForRoom(roomID);
    const unsubscribe = onSnapshot(missionsQuery, (snapshot) => {
        setMissions(snapshot.docs.map((doc) => doc.data()));
    });
    return () => unsubscribe();
}, [roomID, gameStarted]);
```

4. Pass the new state down in the existing `<MessageComposer ... />` JSX: add `players={players}` and `missions={missions}` as two more props.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/pages/PlayerGame.test.jsx -v`
Expected: PASS, all tests (old and new).

- [ ] **Step 6: Run the full unit+dom suite to check nothing else broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "PlayerGame subscribes to the roster and missions for the photo-claim picker"
```

---

### Task 7: `PhotosDisplay` becomes pure display, plus docs

**Files:**

- Modify: `src/components/photos_display_component/PhotosDisplay.js`
- Modify: `src/components/photos_display_component/PhotosDisplay.test.jsx`
- Modify: `docs/data-model.md`
- Modify: `docs/game-flows.md`

**Interfaces:**

- Consumes: the photo doc's own `target`/`mission` fields, now populated at submission time (Task 3) instead of `null`.

- [ ] **Step 1: Read the current file fresh**

Read `src/components/photos_display_component/PhotosDisplay.js` and `src/components/photos_display_component/PhotosDisplay.test.jsx` in full before changing anything — this task deletes more than it adds, and the exact current line numbers matter less than matching the file's real current content.

- [ ] **Step 2: Rewrite the test file's dropdown-dependent sections**

In `src/components/photos_display_component/PhotosDisplay.test.jsx`:

**Delete the entire `describe('moderator resolves the target (players no longer pick who they killed)', ...)` block** and replace it with:

```jsx
describe('the player’s own claim, not a moderator pick', () => {
    it('shows the kill-attempt wording and lets Approve proceed', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', mission: null, assassin: 'bob' }]);

        expect(screen.getByText("bob's kill attempt on alice")).toBeInTheDocument();
        expect(screen.queryByLabelText('Select target or mission')).not.toBeInTheDocument();

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
    });

    it('shows the mission-attempt wording using the claimed mission’s title', async () => {
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            defaultPlayers,
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        expect(screen.getByText("bob's mission attempt: Find the clue")).toBeInTheDocument();
    });

    it('does nothing when Approve is clicked on a photo with no claim at all', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, mission: null, assassin: 'bob' }]);

        expect(screen.getByText('No target selected.')).toBeInTheDocument();

        await userEvent.click(screen.getByAltText('Approve'));

        expect(executeKill).not.toHaveBeenCalled();
        expect(completeMission).not.toHaveBeenCalled();
        expect(dbCalls.approvePhotoForRoom).not.toHaveBeenCalled();
        expect(dbCalls.approvePhotoAsMissionForRoom).not.toHaveBeenCalled();
    });

    it('Deny does not require a claim to be present', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, mission: null, assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Deny'));

        await waitFor(() => expect(dbCalls.updatePhotoStatusForRoom).toHaveBeenCalled());
    });
});
```

**In `describe("an open-season target is a valid kill even off the assassin's own list", ...)`**, delete only the first two tests (`'offers an open-season player in the dropdown alongside the assassin's own target'` and `'auto-resolves to the open-season player when that is the only option at all'`) — this coverage now lives in `src/game/photoClaimOptions.test.js` (Task 2). Keep the last two tests (`'announces open season ending...'` and `'does not announce open season ending for an ordinary kill'`) exactly as they are, with one change: in `'announces open season ending when the approved kill was on an open-season target'`, change the `mountWithSnapshot` call's photo doc from `{ status: 'pending', target: null, assassin: 'bob' }` to `{ status: 'pending', target: 'carol', mission: null, assassin: 'bob' }` (the claim is now already resolved on the doc, since there's no dropdown left to auto-resolve it) — the rest of that test is unchanged.

**In `describe('approving a photo as a mission completion', ...)`**, delete the first two tests (`'lists open missions grouped separately from kill targets, excluding ended or already-completed ones'` and `'excludes a mission already completed by this player even when the photo carries their display-cased name'`) — this coverage now lives in `src/game/photoClaimOptions.test.js`. For every remaining test in this block that currently mounts a photo doc as `{ status: 'pending', target: null, assassin: 'bob' }` (or `'Bob'`) and relies on the `missions` array (3rd argument to `mountWithSnapshot`) to auto-resolve a single mission, add `mission: <taskIndex>` directly onto the photo doc, matching whichever mission that test's own `completeMission` mock/assertions already expect — e.g. the photo doc in `'completes a Task mission and marks the photo approved...'` becomes `{ status: 'pending', target: null, mission: 1, assassin: 'bob' }`, and the one in `'calls handlePlayerRevive when the completion revives the player'` becomes `{ status: 'pending', target: null, mission: 2, assassin: 'bob' }` (matching that test's own `taskIndex: 2` mission fixture). The `missions` array argument to `mountWithSnapshot` can stay as-is in each of these tests — it's now only used for the title lookup in the display text, not selection, and removing it isn't necessary.

**Delete `'shows a message and keeps Approve disabled when the assassin has no open targets or missions'` entirely, with no replacement in this block** — the new `describe('the player's own claim, not a moderator pick', ...)` block above already added `'does nothing when Approve is clicked on a photo with no claim at all'`, which covers this exact same scenario (a pending photo with no claim, "No target selected." shown, Approve a no-op) more generally, not scoped to missions specifically.

Leave `'denies a photo with generic wording regardless of category'`, `'undoes a mission-approved photo for real, instead of showing the placeholder'`, and `'shows an error alert when undoing a mission-approved photo fails'` completely untouched — none of them depend on the dropdown.

Also remove the file's header comment sentence that says the target dropdown "auto-resolves without any test needing to interact with it" for `defaultPlayers` (near the top of the file, just above the `defaultPlayers` constant) — replace it with a note that `defaultPlayers` is now only used for display-name resolution (`resolvePlayerDisplayName`) in the mission-completion announcement tests, not for resolving a claim.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/components/photos_display_component/PhotosDisplay.test.jsx -v`
Expected: FAIL — `PhotosDisplay.js` still computes `combinedOptions`/`effectiveSelection` from `players`/`missions` and still renders the old dropdown/text, so the new wording/behavior isn't there yet.

- [ ] **Step 4: Implement the simplification**

In `src/components/photos_display_component/PhotosDisplay.js`:

1. Remove the imports `killTargetsForAssassin` (from `'../../game/killTargets'`) and `openMissionsForPlayer` (from `'../../game/missionCompletion'`) — remove the `Select` import from `'@chakra-ui/react'` too, it's no longer used.

2. Remove the `selectedOption` state (`useState('')`), the `currentKillTargets`/`currentOpenMissions`/`combinedOptions`/`effectiveSelection` derivations, and the `useEffect` that resets `selectedOption` on `currentPhoto?.id` change.

3. Add, right after `const currentPhoto = visibleUnjudgedPhotos[0];`:

```js
// The claim is already resolved by the time a moderator sees it — a
// player picks their own target/mission at submission time now
// (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md).
// This component's job is purely display + approve/deny, with no
// override capability.
const currentMissionTitle = currentPhoto
    ? missions.find((mission) => mission.taskIndex === currentPhoto.mission)?.title
    : undefined;
```

4. Rewrite `handlePass` to branch on the photo's own fields instead of `effectiveSelection`. Replace this line:

```js
    const handlePass = async () => {
        if (visibleUnjudgedPhotos.length === 0) return;
        if (!effectiveSelection) return;
        const [approvingPhoto] = visibleUnjudgedPhotos;
```

with:

```js
    const handlePass = async () => {
        if (visibleUnjudgedPhotos.length === 0) return;
        const [approvingPhoto] = visibleUnjudgedPhotos;
        if (approvingPhoto.mission == null && !approvingPhoto.target) return;
```

`selectedOption` state no longer exists after this task, so every remaining call to `setSelectedOption(...)` in the file must be deleted too, not just the one in `handlePass` — the current file also has one in `handleDeny` (right after its own `setOptimisticallyJudgedIds` call, with a comment above it starting "Same reasoning as handlePass"). Delete both call sites; leave everything else in `handleDeny` untouched.

Replace the branch condition further down (currently `if (effectiveSelection.startsWith('mission:')) {`) with `if (approvingPhoto.mission != null) {`, and inside that branch replace:

```js
const missionIndex = Number(effectiveSelection.slice('mission:'.length));
```

with:

```js
const missionIndex = approvingPhoto.mission;
```

(every other line inside that branch — the `completeMission`/`approvePhotoAsMissionForRoom` calls and everything after — stays exactly as it is, since `missionIndex` is still the variable name used throughout).

In the `else` branch (the kill path), replace:

```js
const target = effectiveSelection.slice('target:'.length);
```

with:

```js
const target = approvingPhoto.target;
```

(every other line inside that branch stays exactly as it is).

5. Replace the JSX block that renders the picker/dropdown (the `<Box sx={styles.targetPickerBox}>...` block) with:

```jsx
{
    currentPhoto && (
        <Box sx={styles.targetPickerBox}>
            {currentPhoto.mission != null ? (
                <Text mb={1}>
                    {currentPhoto.assassin}'s mission attempt: {currentMissionTitle}
                </Text>
            ) : currentPhoto.target ? (
                <Text mb={1}>
                    {currentPhoto.assassin}'s kill attempt on {currentPhoto.target}
                </Text>
            ) : (
                <Text color="gray.400">No target selected.</Text>
            )}
        </Box>
    );
}
```

6. Update the Approve `<Image>`'s disabled styling — replace:

```jsx
                        opacity={effectiveSelection ? 1 : 0.3}
                        cursor={effectiveSelection ? 'pointer' : 'not-allowed'}
```

with:

```jsx
                        opacity={currentPhoto?.mission != null || currentPhoto?.target ? 1 : 0.3}
                        cursor={
                            currentPhoto?.mission != null || currentPhoto?.target
                                ? 'pointer'
                                : 'not-allowed'
                        }
```

7. Update the file's own header comment (the block starting "A player no longer names who they killed when submitting a photo") to reflect the new reality — replace it with:

```js
// A player now names their own target or mission when submitting a photo
// (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md)
// — this component's job is purely display + approve/deny, with no
// override capability. `players` is the same live roster
// GameMasterView.js already subscribes to, used here only for display
// name resolution.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/components/photos_display_component/PhotosDisplay.test.jsx -v`
Expected: PASS, every test in the file.

- [ ] **Step 6: Update the docs**

In `docs/data-model.md`'s `rooms/{roomID}/photos/{autoId}` table, replace the `target` row's Notes with:

> `null` at submission only if the claim was malformed (rejected before writing — see below); otherwise set at submission time, by `submitKillPhoto` from the player's own claim. The moderator's approval in `PhotosDisplay.js` no longer resolves or rewrites it — `dbCalls.approvePhotoForRoom` still writes the same value back explicitly as part of recording the approval, sourced from the photo doc's own already-set field. Stays whatever it was at submission for a denied photo — denying never touches it.

and the `mission` row's Notes with:

> `null` at submission unless the player claimed a mission — set at submission time now, by `submitKillPhoto`, not by the moderator's approval (`docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md`). `dbCalls.approvePhotoAsMissionForRoom` still writes the same value back explicitly as part of recording the approval.

Also update the paragraph above that table (the one starting "What it enforces, all server-side") — it currently says `submitKillPhoto` "does not take a `target` argument at all... `target` is always `null` at submission." Replace that sentence with a description of the new shape-only validation (exactly one of `target`/`mission` required, real game-rule validity still checked only at approval time, unchanged).

In `docs/game-flows.md`'s `## 3. Photo moderation` section, the mermaid diagram's `App->>FS: addDoc(...)` line and the two `alt`/`else` branch headers still describe the old moderator-picks-from-a-dropdown shape. Make these exact edits, leaving everything else in the diagram (including the "Mobile app (aspirational — does not exist)" framing — a pre-existing staleness this feature doesn't touch) as-is:

Replace:

```
    App->>FS: addDoc(photos, {url, assassin, target, timestamp, status:"pending"})
    FS-->>PD: onSnapshot (all photos, ordered by timestamp asc)
    PD->>PD: filter status === "pending" client-side
    PD-->>GM: render oldest pending photo, with a combined target/mission dropdown

    alt Approve as kill
        GM->>PD: ✓ (target selected)
```

with:

```
    App->>FS: addDoc(photos, {url, assassin, target, mission, timestamp, status:"pending"})
    FS-->>PD: onSnapshot (all photos, ordered by timestamp asc)
    PD->>PD: filter status === "pending" client-side
    PD-->>GM: render oldest pending photo, showing its already-claimed target or mission

    alt Approve as kill
        GM->>PD: ✓ (approve the claimed target)
```

Replace:

```
    else Approve as mission
        GM->>PD: ✓ (mission selected)
```

with:

```
    else Approve as mission
        GM->>PD: ✓ (approve the claimed mission)
```

Then, immediately after the diagram's closing code fence (before the existing "`PhotosDisplay` calls the exact same `executeKill`..." paragraph), insert this new paragraph:

```markdown
**The target/mission claim now comes from the photo document itself, set
by the player at submission time, not picked by the GM at approval time**
(`docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md`).
`PhotosDisplay` no longer computes any options or shows a picker — it
reads `target`/`mission` straight off the current photo and displays them
("assassin's kill attempt on target" / "assassin's mission attempt:
title"). Approve calls `executeKill`/`completeMission` with those
already-known values; both still independently re-validate the claim
against live game state exactly as they did before, so a claim that's
gone stale by review time still fails cleanly rather than being approved
anyway.
```

- [ ] **Step 7: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run build
```

Expected: all four pass clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/photos_display_component/PhotosDisplay.js src/components/photos_display_component/PhotosDisplay.test.jsx docs/data-model.md docs/game-flows.md
git commit -m "PhotosDisplay becomes pure display of the player's own claim"
```

---

## Final Gate (all tasks complete)

```bash
npm run format
npm run lint
npm test
npm run build
node functions/scripts/sync-shared-game-logic.js && firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,auth,functions,storage "npx jest --selectProjects integration --runInBand"
firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,storage "npx jest --selectProjects rules --runInBand"
```

No `firestore.rules` changes are made in this plan, so the rules suite is expected to pass unchanged — run it anyway as a regression check, per this repo's standing gate.
