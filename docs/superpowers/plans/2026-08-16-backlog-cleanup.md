# Backlog Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out four small, independent items from `docs/improvements.md` (47, 48, 49, 50): delete two now-dead `dbCalls.js` functions, fix a blob-URL leak in the kill-photo capture flow, and make `undoKillPlayer` fail loudly instead of silently skipping an unresolvable player.

**Architecture:** Four independent fixes, each in its own task with no interdependency, followed by one final docs-only task that marks all four items resolved once the fixes are in.

**Tech Stack:** React (hooks), Firebase Cloud Functions (Admin SDK, Firestore transactions), Jest (unit/dom/integration Jest projects), `firebase emulators:exec`.

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) must pass before any task is considered done.
- TDD: write the failing test first, watch it fail, then implement (per CLAUDE.md).
- Task 4 touches `functions/callableFunctions/undoKillPlayer.js`. `npm run lint`/`npm run format` do NOT cover `functions/` (globs scoped to `src/**`), and `npm test` does NOT run Cloud Function code at all. Task 4's real correctness gate is `npm run test:emulator`, and its format/lint gate additionally requires `npx prettier --check "functions/**/*.js"` and `(cd functions && npm run lint)`, run in addition to the normal root four-command gate.
- Do not modify `firestore.rules`.
- Do not address item 50's blast-radius concern (undo replaying stale data if something else changed a touched player since approval) — only the silent-skip half.

---

### Task 1: Delete `addPlayerForRoom`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js:273-294` (delete)
- Modify: `src/components/firebase_calls/dbCalls.integration.test.js:85-155` (delete)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — `addPlayerForRoom` is removed from `dbCalls.js`'s exports entirely. No other task in this plan depends on it.

**Current content of `src/components/firebase_calls/dbCalls.js:273-294`:**

```js
export const addPlayerForRoom = async (player, roomID) => {
    const trimmedLowercaseName = normalizePlayerName(player);
    const playerRef = doc(db, 'rooms', roomID, 'players', trimmedLowercaseName);

    await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(playerRef);
        if (existing.exists()) {
            throw new Error('Player already exists');
        }
        transaction.set(playerRef, {
            name: player,
            trimmedNameLowerCase: trimmedLowercaseName,
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            openSeason: false,
        });
    });

    return playerRef;
};
```

**Current content of `src/components/firebase_calls/dbCalls.integration.test.js:85-155`:**

```js
describe('addPlayerForRoom', () => {
    it('writes the trimmedNameLowerCase field the duplicate check depends on', async () => {
        await seedRoom(ROOM, []);

        await addPlayerForRoom('Alice Smith', ROOM);

        const doc = await fetchPlayerForRoom('Alice Smith', ROOM);
        expect(doc.data().trimmedNameLowerCase).toBe('alicesmith');
    });

    it('resolves with a reference to the document it created', async () => {
        await seedRoom(ROOM, []);

        const ref = await addPlayerForRoom('dana', ROOM);

        expect(ref).toBeDefined();
        expect(ref.id).toEqual(expect.any(String));
    });

    it('leaves no write in flight once it resolves', async () => {
        // A write still pending here contends with the next test's emulator
        // reset and stalls it for the full timeout.
        await seedRoom(ROOM, []);

        await addPlayerForRoom('erin', ROOM);
        await clearFirestore();
        // Reads are now room-scoped (isHostOrPlayerOfRoom in firestore.rules),
        // so clearFirestore also wiped away this caller's proof of being the
        // room's host — re-seed the room itself (not its players) so the
        // query below is authorized. If addPlayerForRoom's write were still
        // in flight, it would land here as a stray 'erin' doc.
        await seedRoom(ROOM, []);

        expect(await fetchAllPlayersForRoom(ROOM)).toEqual([]);
    });

    it('rejects a duplicate that differs only by case and spacing', async () => {
        await seedRoom(ROOM, [{ name: 'Alice Smith', trimmedNameLowerCase: 'alicesmith' }]);

        await expect(addPlayerForRoom('alicesmith', ROOM)).rejects.toThrow('Player already exists');
    });

    it('starts a new player on 10 points and alive', async () => {
        await seedRoom(ROOM, []);

        await addPlayerForRoom('bob', ROOM);

        const data = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(data.score).toBe(10);
        expect(data.isAlive).toBe(true);
    });

    it('does not create two players when two calls race on the same name', async () => {
        // Reproduces the double-Enter-while-laggy bug: addPlayerForRoom's
        // duplicate check and its write were not atomic, so two concurrent
        // calls could both see "no duplicate" before either write landed.
        await seedRoom(ROOM, []);

        const results = await Promise.allSettled([
            addPlayerForRoom('123', ROOM),
            addPlayerForRoom('123', ROOM),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason.message).toBe('Player already exists');
        expect(await fetchAllPlayersForRoom(ROOM)).toEqual(['123']);
    });
});
```

This is a deletion task, not a new-behavior task — there is no "failing test to write first" in the usual TDD sense. The steps below verify the deletion is safe (nothing else references `addPlayerForRoom`) before and after removing it.

- [ ] **Step 1: Confirm there are no other references**

Run: `grep -rn "addPlayerForRoom" src/ functions/`
Expected: matches only in `src/components/firebase_calls/dbCalls.js` (the definition) and `src/components/firebase_calls/dbCalls.integration.test.js` (its import and the describe block above) — the two files this task touches.

- [ ] **Step 2: Delete the function and its test block**

In `src/components/firebase_calls/dbCalls.js`, delete the `addPlayerForRoom` function shown above in full (including the blank line before/after it, so no double-blank-line is left behind).

In `src/components/firebase_calls/dbCalls.integration.test.js`, delete the `describe('addPlayerForRoom', ...)` block shown above in full, and remove `addPlayerForRoom` from that file's top-level import list from `./dbCalls` (find the `import { ... } from './dbCalls';` block and drop just that one name, leaving every other imported name untouched).

- [ ] **Step 3: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass.

Run: `npm run test:emulator`
Expected: all suites pass, with one fewer test than before (the `dbCalls.integration.test.js` suite loses exactly the 6 tests deleted above — wait, it's 6 `it()` blocks, not 7; recount from the block above before writing your commit message so the number you state is accurate).

- [ ] **Step 4: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js src/components/firebase_calls/dbCalls.integration.test.js
git commit -m "Delete addPlayerForRoom, unreferenced since the simplified-lobby redesign"
```

---

### Task 2: Delete `remapPlayerAsTarget`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js:473-491` (delete)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — `remapPlayerAsTarget` is removed from `dbCalls.js`'s exports entirely.

**Current content of `src/components/firebase_calls/dbCalls.js:473-491`:**

```js
export const remapPlayerAsTarget = async (revivedPlayerName, roomID, originalAssassins) => {
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const snapshot = await getDocs(playerCollectionRef);

    for (const docSnap of snapshot.docs) {
        const player = docSnap.data();
        const docRef = docSnap.ref;

        const isAlive = player.isAlive;
        const alreadyTargeted = player.targets?.includes(revivedPlayerName);

        if (isAlive && originalAssassins.includes(player.name) && !alreadyTargeted) {
            const updatedTargets = [...(player.targets || []), revivedPlayerName];
            await updateDoc(docRef, {
                targets: updatedTargets,
            });
        }
    }
};
```

- [ ] **Step 1: Confirm there are no other references**

Run: `grep -rn "remapPlayerAsTarget" src/ functions/`
Expected: matches only the definition in `src/components/firebase_calls/dbCalls.js` — no test file, no other call site.

- [ ] **Step 2: Delete the function**

In `src/components/firebase_calls/dbCalls.js`, delete the `remapPlayerAsTarget` function shown above in full (including the blank line before/after it).

- [ ] **Step 3: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass, with no test-count change (this function had no dedicated coverage).

- [ ] **Step 4: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js
git commit -m "Delete remapPlayerAsTarget, unreferenced since the full-kill-undo redesign"
```

---

### Task 3: Fix the blob-URL leaks in `MessageComposer.js`

**Files:**

- Modify: `src/components/player_messages_components/MessageComposer.js` (full current content below)
- Modify: `src/components/player_messages_components/MessageComposer.test.jsx` (full current content below)

**Interfaces:**

- Consumes: `global.URL.revokeObjectURL`/`global.URL.createObjectURL` (already mocked in this test file's existing `beforeEach`, unchanged).
- Produces: no interface change — `MessageComposer`'s props and exports are unchanged. Purely internal cleanup behavior.

**Current content of `src/components/player_messages_components/MessageComposer.js`:**

```jsx
import React, { useRef, useState } from 'react';
import { Flex, Input, Button, VisuallyHidden } from '@chakra-ui/react';
import { addChatMessageForRoom, addPhotoForRoom } from '../firebase_calls/dbCalls';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import KillPhotoModal from './KillPhotoModal';

// Sends player-authored group-chat messages and captures/submits a
// kill-photo claim. The camera button triggers a hidden file input
// directly (always mounted, so it can fire before KillPhotoModal has ever
// opened) — tapping it opens the camera immediately, and KillPhotoModal
// only appears once a photo has been captured, or capture failed, to
// review/pick a target/submit
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
// docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
// docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
const MessageComposer = ({ roomID, playerName, targets = [] }) => {
    const [text, setText] = useState('');
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [compressedBlob, setCompressedBlob] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [photoError, setPhotoError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        try {
            await addChatMessageForRoom(trimmed, playerName, roomID);
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching MessageFeed's own subscription-error handling — log
            // only, no toast/alert plumbing in this simple composer. The
            // typed text is restored (not left cleared) so a failed send
            // doesn't lose the player's words with no way to retry.
            console.error('Error sending chat message:', error);
            setText(trimmed);
        }
    };

    const handleKeyDown = (event) => {
        // Guards Shift+Enter (would insert a newline, if this ever becomes
        // multiline) and IME composition (an Enter keystroke that's
        // confirming a composed character, not submitting the message).
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            handleSend();
        }
    };

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        // Reset immediately, not just on success: this input is always
        // mounted now (unlike the old design, where it lived inside the
        // modal and remounted fresh every time the modal opened), so a
        // real browser will not fire another change event for the exact
        // same file next time unless the value is cleared first.
        event.target.value = '';
        if (!file) return;
        setPhotoError(null);
        setCompressedBlob(null);
        setPreviewUrl(null);
        setIsPhotoModalOpen(true);
        try {
            const blob = await compressImage(file);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(blob);
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (compressError) {
            console.error('Error compressing photo:', compressError);
            setPhotoError('Could not read that photo. Try taking it again.');
        }
    };

    const handlePhotoSubmit = async (effectiveTarget) => {
        setIsSubmitting(true);
        setPhotoError(null);
        try {
            const url = await uploadKillPhoto(roomID, compressedBlob);
            await addPhotoForRoom(roomID, playerName, effectiveTarget, url);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(null);
            setPreviewUrl(null);
            setIsPhotoModalOpen(false);
        } catch (submitError) {
            console.error('Error submitting kill photo:', submitError);
            setPhotoError('Could not submit the photo. Check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // playerName can be empty when the stored session's room doesn't match
    // the URL (PlayerGame.js) — MessageFeed.js already guards its
    // subscription on the same condition; this keeps the composer from
    // attempting a chat write with sender: ''.
    const disabled = !playerName;

    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input
                placeholder="Type a message..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                isDisabled={disabled}
                mr={2}
            />
            <VisuallyHidden>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    aria-label="Take Photo"
                    disabled={disabled || targets.length === 0}
                />
            </VisuallyHidden>
            <Button
                isDisabled={disabled || targets.length === 0}
                onClick={() => fileInputRef.current.click()}
                mr={2}
                aria-label="Send photo"
            >
                📷
            </Button>
            <Button onClick={handleSend} colorScheme="teal" isDisabled={disabled}>
                Send
            </Button>
            <KillPhotoModal
                isOpen={isPhotoModalOpen}
                onClose={() => setIsPhotoModalOpen(false)}
                targets={targets}
                previewUrl={previewUrl}
                error={photoError}
                isSubmitting={isSubmitting}
                onSubmit={handlePhotoSubmit}
            />
        </Flex>
    );
};

export default MessageComposer;
```

**Current content of `src/components/player_messages_components/MessageComposer.test.jsx`:** (this file is long — 325 lines. Read the actual file directly during implementation rather than relying solely on this plan's transcription for whitespace-exact fidelity, though the content below is accurate as of this writing.)

The file's existing structure: a docblock, imports (`React`, `ChakraProvider`, `render`/`screen`/`waitFor`, `userEvent`, `MessageComposer`, `addChatMessageForRoom`/`addPhotoForRoom` from `../firebase_calls/dbCalls`, `compressImage`, `uploadKillPhoto`), three `jest.mock(...)` calls (`dbCalls`, `compressImage`, `storageCalls`), a `mountComposer` helper, `fakeBlob`/`fakeFile` fixtures, a `beforeEach` that resets mocks and sets `global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview')` / `global.URL.revokeObjectURL = jest.fn()`, then one `describe('MessageComposer', () => { ... })` block containing 20 existing tests (message send/disable behavior, then photo-capture-flow tests including `'clicking the photo button clicks the hidden file input'`, `'does not let a file selection through...'` ×2, and `'shows a processing indicator immediately after capture...'` as the last three before this task's additions).

- [ ] **Step 1: Write the failing tests**

Add these two new tests inside the existing `describe('MessageComposer', () => { ... })` block, after the last existing test (`'shows a processing indicator immediately after capture, before compression resolves'`):

```jsx
it('revokes the preview URL on unmount', async () => {
    const { unmount } = mountComposer();

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
    await screen.findByAltText('Kill photo preview');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview');
});

it('revokes the previous preview URL when a second capture fails to compress', async () => {
    mountComposer();

    await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
    await screen.findByAltText('Kill photo preview');
    URL.revokeObjectURL.mockClear();

    compressImage.mockRejectedValueOnce(new Error('bad file'));
    await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

    await screen.findByText('Could not read that photo. Try taking it again.');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-preview');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/player_messages_components/MessageComposer.test.jsx`
Expected: FAIL on both new tests — the current component never calls `URL.revokeObjectURL` on unmount, and the `catch` branch in `handleFileChange` doesn't call it either.

- [ ] **Step 3: Write the implementation**

In `src/components/player_messages_components/MessageComposer.js`:

Change the import line:

```jsx
import React, { useRef, useState } from 'react';
```

to:

```jsx
import React, { useEffect, useRef, useState } from 'react';
```

Add this `useEffect` right after the existing `useState`/`useRef` declarations (after `const fileInputRef = useRef(null);`, before `const handleSend = async () => {`):

```jsx
// Revokes any outstanding preview URL if the composer unmounts before
// the player submits or dismisses their capture — otherwise the
// browser holds that blob's memory until the tab itself closes
// (docs/improvements.md item 48).
useEffect(() => {
    return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
}, [previewUrl]);
```

Change `handleFileChange`'s `catch` block from:

```jsx
        } catch (compressError) {
            console.error('Error compressing photo:', compressError);
            setPhotoError('Could not read that photo. Try taking it again.');
        }
```

to:

```jsx
        } catch (compressError) {
            // A second capture attempt after a first one already succeeded
            // leaves that first previewUrl orphaned in state — nothing else
            // in this catch branch would otherwise revoke it
            // (docs/improvements.md item 48).
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            console.error('Error compressing photo:', compressError);
            setPhotoError('Could not read that photo. Try taking it again.');
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/player_messages_components/MessageComposer.test.jsx`
Expected: PASS — 22/22 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/MessageComposer.js src/components/player_messages_components/MessageComposer.test.jsx
git commit -m "Revoke stale preview object URLs on unmount and on a failed re-capture"
```

---

### Task 4: Make `undoKillPlayer` fail loudly on an unresolvable player

**Files:**

- Modify: `functions/callableFunctions/undoKillPlayer.js` (full current content below)
- Modify: `src/components/undoKill.integration.test.js` (full current content below)

**Interfaces:**

- Consumes: `deleteDoc`, `doc` from `firebase/firestore` (new imports for the test file); `db` from `../utils/firebase` (new import for the test file, same export `dbCalls.js` itself uses via `../../utils/firebase` — one fewer `../` here since this test file lives at `src/components/`, one directory shallower than `dbCalls.js` at `src/components/firebase_calls/`); `normalizePlayerName` from `../game/playerNames` (new import for the test file, to compute the `trimmedNameLowerCase` doc ID to delete).
- Produces: no interface change — `undoKillPlayer`'s callable signature (`{ roomId, photoId }`) and the `undoKill(roomID, photoID)` wrapper are unchanged. Only the not-found branch's behavior changes (throw instead of warn-and-continue).

**Current content of `functions/callableFunctions/undoKillPlayer.js`:**

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Reverses everything killPlayer.js did for one approved kill — not just
 * the target, but every player its transaction touched (the killer, any
 * co-assassins, and anyone the remap reassigned) — in one Firestore
 * transaction, mirroring killPlayer.js's own atomicity
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here.
 */
exports.undoKillPlayer = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, photoId } = data;
    if (!roomId || !photoId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and photoId are both required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');
        const photoRef = roomRef.collection('photos').doc(photoId);

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can undo a kill.'
            );
        }

        const photoSnapshot = await transaction.get(photoRef);
        if (!photoSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Photo not found: ${photoId}`);
        }
        const photoData = photoSnapshot.data();
        if (photoData.status !== 'approved') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `Photo is not approved (status: ${photoData.status}); nothing to undo.`
            );
        }

        const snapshotEntries = Object.entries(photoData.originalPlayerData || {});
        const playerRefsByKey = new Map();
        for (const [key] of snapshotEntries) {
            const playerSnapshot = await transaction.get(
                playersRef.where('trimmedNameLowerCase', '==', key)
            );
            if (playerSnapshot.empty) {
                console.warn(`undoKillPlayer: player not found, skipping restore: ${key}`);
                continue;
            }
            playerRefsByKey.set(key, playerSnapshot.docs[0].ref);
        }

        for (const [key, snapshot] of snapshotEntries) {
            const ref = playerRefsByKey.get(key);
            if (!ref) continue;
            transaction.update(ref, {
                score: snapshot.score,
                targets: snapshot.targets,
                assassins: snapshot.assassins,
                isAlive: snapshot.isAlive,
                openSeason: snapshot.openSeason,
            });
        }

        transaction.update(photoRef, { status: 'pending' });
    });
});
```

**Current content of `src/components/undoKill.integration.test.js`:**

```js
/**
 * Layer 1b — the atomic kill-undo Cloud Function, against the real
 * Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `undoKill` is a thin wrapper around
 * `httpsCallable(functions, 'undoKillPlayer')` — these tests call it
 * exactly the way the real app does, then assert on what actually landed
 * in Firestore, rather than asserting against the function's internals
 * (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). Each test
 * builds a real approved kill photo first (via the real `executeKill` +
 * `addPhotoForRoom` + `approvePhotoForRoom`), matching exactly what
 * `PhotosDisplay.js`'s Accept flow does, so the snapshot being undone is
 * genuine, not hand-constructed.
 */
import { getDocs } from 'firebase/firestore';
import { undoKill } from './undoKill';
import { executeKill } from './executeKill';
import {
    addPhotoForRoom,
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
} from './firebase_calls/dbCalls';
import { callableAsNonHost, clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

const latestPhotoId = async () => {
    const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
    return snapshot.docs[0].id;
};

describe('undoKill', () => {
    it('reverts a simple kill: killer and target both restored, photo back to pending', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        await undoKill(ROOM, photoId);

        const alice = (await fetchPlayerForRoom('alice', ROOM)).data();
        expect(alice.score).toBe(10);
        expect(alice.targets).toEqual(['bob']);
        expect(alice.assassins).toEqual([]);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.score).toBe(5);
        expect(bob.targets).toEqual([]);
        expect(bob.assassins).toEqual(['alice']);

        const photoSnapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(photoSnapshot.docs[0].data().status).toBe('pending');
    });

    it('reverts a kill whose remap touched a third player, restoring their targets/assassins too', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
            { name: 'carol', targets: [], assassins: [] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        // Confirm the remap actually touched carol before undoing, so this
        // test is proven non-vacuous.
        expect((await fetchPlayerForRoom('carol', ROOM)).data().assassins).toEqual(['alice']);

        await undoKill(ROOM, photoId);

        expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(10);
        expect((await fetchPlayerForRoom('alice', ROOM)).data().targets).toEqual(['bob']);
        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);

        const carol = (await fetchPlayerForRoom('carol', ROOM)).data();
        expect(carol.targets).toEqual([]);
        expect(carol.assassins).toEqual([]);
    });

    it('rejects undo of a photo that is not approved', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();
        // Photo is still 'pending' — never approved.

        await expect(undoKill(ROOM, photoId)).rejects.toThrow(/not approved|nothing to undo/i);

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(true);
    });

    it('restores openSeason on the target after undoing an open-season kill', async () => {
        // bob has no assigned hunter at all — alice is not on bob's
        // assassins list and bob is not on alice's targets list — so the
        // ONLY valid kill path here is bob's own openSeason flag. This
        // proves the scenario is real, not vacuous: if openSeason were not
        // actually driving the kill's validity, executeKill would reject it.
        await seedRoom(ROOM, [
            { name: 'alice', targets: [], assassins: [], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: [], openSeason: true },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();

        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        // The kill itself clears openSeason on the target.
        expect((await fetchPlayerForRoom('bob', ROOM)).data().openSeason).toBe(false);

        await undoKill(ROOM, photoId);

        const bob = (await fetchPlayerForRoom('bob', ROOM)).data();
        expect(bob.isAlive).toBe(true);
        expect(bob.openSeason).toBe(true);
    });

    it('rejects a caller who is not the room host', async () => {
        await seedRoom(ROOM, [
            { name: 'alice', targets: ['bob'], score: 10 },
            { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
        ]);
        await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
        const photoId = await latestPhotoId();
        const killResult = await executeKill('bob', 'alice', ROOM);
        await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

        const undoAsNonHost = callableAsNonHost('undoKillPlayer');
        await expect(undoAsNonHost({ roomId: ROOM, photoId })).rejects.toThrow(
            /permission-denied|host/i
        );

        expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    });
});
```

- [ ] **Step 1: Write the failing test**

In `src/components/undoKill.integration.test.js`, add `deleteDoc`/`doc` to the existing `import { getDocs } from 'firebase/firestore';` line:

```js
import { deleteDoc, doc, getDocs } from 'firebase/firestore';
```

Add two new imports right after the existing `emulatorHelpers` import:

```js
import { db } from '../utils/firebase';
import { normalizePlayerName } from '../game/playerNames';
```

Add this new test inside the `describe('undoKill', () => { ... })` block, after the `'restores openSeason...'` test and before `'rejects a caller who is not the room host'`:

```js
it('rejects undo when a snapshotted player no longer exists, and mutates nothing', async () => {
    await seedRoom(ROOM, [
        { name: 'alice', targets: ['bob'], score: 10 },
        { name: 'bob', score: 5, targets: [], assassins: ['alice'] },
    ]);
    await addPhotoForRoom(ROOM, 'alice', 'bob', 'https://example.com/photo.jpg');
    const photoId = await latestPhotoId();

    const killResult = await executeKill('bob', 'alice', ROOM);
    await approvePhotoForRoom(ROOM, photoId, killResult.preKillSnapshot);

    // Simulates the room's player list changing in some unexpected way
    // between the kill and the undo — delete the killer's own doc
    // directly, bypassing the normal app flow, which has no "remove a
    // player entirely" path for a still-referenced killer.
    await deleteDoc(doc(db, 'rooms', ROOM, 'players', normalizePlayerName('alice')));

    await expect(undoKill(ROOM, photoId)).rejects.toThrow(/no longer exists/i);

    // Bob (who could have been resolved and restored) must not have
    // been touched either — this is one atomic transaction, not a
    // best-effort partial restore.
    expect((await fetchPlayerForRoom('bob', ROOM)).data().isAlive).toBe(false);
    const photoSnapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
    expect(photoSnapshot.docs[0].data().status).toBe('approved');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:emulator -- --testPathPattern=undoKill`
Expected: FAIL — the current `undoKillPlayer.js` silently skips the missing `alice` and successfully restores `bob` and resets the photo to `pending`, so neither the rejection nor the "bob untouched" assertion holds.

- [ ] **Step 3: Write the implementation**

In `functions/callableFunctions/undoKillPlayer.js`, replace:

```js
            if (playerSnapshot.empty) {
                console.warn(`undoKillPlayer: player not found, skipping restore: ${key}`);
                continue;
            }
```

with:

```js
if (playerSnapshot.empty) {
    throw new functions.https.HttpsError(
        'failed-precondition',
        `Cannot undo: player ${key} no longer exists.`
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:emulator -- --testPathPattern=undoKill`
Expected: PASS — 6/6 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Then: `npx prettier --check "functions/**/*.js"` (expected: no new warnings from your change; the pre-existing `functions/index.js` warning is unrelated) and `(cd functions && npm run lint)` (expected: clean).
Then run: `npm run test:emulator` in full — expected: all suites pass, with one more test than before in the `undoKill.integration.test.js` suite.

- [ ] **Step 6: Commit**

```bash
git add functions/callableFunctions/undoKillPlayer.js src/components/undoKill.integration.test.js
git commit -m "Make undoKillPlayer fail loudly instead of silently skipping a missing player"
```

---

### Task 5: Mark items 47-50 resolved in `docs/improvements.md`

**Files:**

- Modify: `docs/improvements.md`

**Interfaces:**

- Consumes: nothing from earlier tasks except their completion — this task only makes sense once Tasks 1-4 have all landed, since its text describes what they did.
- Produces: nothing — documentation only.

- [ ] **Step 1: Append `✅ Resolved` to each heading**

Find each of these four headings in `docs/improvements.md` and append ` ✅ Resolved`:

```
### 47. `addPlayerForRoom` is now unreferenced by any production code path
### 48. Two pre-existing kill-photo blob-URL leaks in `MessageComposer.js`
### 49. `remapPlayerAsTarget` is now unreferenced by any production code path
### 50. `undoKillPlayer`'s snapshot replay has two inherent, tracked risks
```

become:

```
### 47. `addPlayerForRoom` is now unreferenced by any production code path ✅ Resolved
### 48. Two pre-existing kill-photo blob-URL leaks in `MessageComposer.js` ✅ Resolved
### 49. `remapPlayerAsTarget` is now unreferenced by any production code path ✅ Resolved
### 50. `undoKillPlayer`'s snapshot replay has two inherent, tracked risks ✅ Resolved
```

- [ ] **Step 2: Add a resolution note to each item's body**

Immediately after item 47's existing paragraph (ending "...that identity work never happened" — actually, locate the exact final sentence of item 47's body by reading the file; it ends with the sentence about the `firestore.rules` grant being worth re-examining if the function is ever removed), add:

```markdown
**Resolution:** deleted. `firestore.rules`' `players/{playerId}` write
grant needed no change — it's the same generic host-write rule every
other player-mutating function still depends on, not something scoped
to `addPlayerForRoom` alone.
```

Immediately after item 48's existing body (ends with the sentence about a `useEffect` cleanup plus a `catch`-branch revoke closing both paths), add:

```markdown
**Resolution:** fixed exactly as suggested above — a `useEffect` cleanup
revokes `previewUrl` on unmount, and `handleFileChange`'s `catch` branch
now revokes the previous `previewUrl` before setting the error.
```

Immediately after item 49's existing body (ends with "worth tracking rather than rediscovering later"), add:

```markdown
**Resolution:** deleted. No test needed updating — it never had
dedicated coverage.
```

Immediately after item 50's existing body (ends with the "silently skips a player it can't find" paragraph), add:

```markdown
**Resolution, silent-skip half:** `undoKillPlayer` now throws
(`failed-precondition`, "Cannot undo: player {name} no longer exists")
instead of warning and continuing. Since the restore already runs inside
one Firestore transaction, this aborts every write in that transaction —
no new partial-state risk, just a clear failure instead of a silent one.

**Not addressed:** the blast-radius concern (no guard against another
change to a touched player between approval and undo) is unchanged —
deliberately out of scope, per the design spec.
```

- [ ] **Step 3: Add four rows to the "✅ Fully resolved" status table**

Find the `### ✅ Fully resolved` table near the top of the file. Add four rows, matching the existing table's `| Item | How |` format and column-alignment style (Prettier will re-align the columns on the next `npm run format` regardless of your own spacing, so don't hand-align):

```markdown
| 47 — `addPlayerForRoom` unreferenced | Deleted, along with its 6-test integration describe block. `firestore.rules`' write grant needed no change — shared by other still-active functions. |
| 48 — two blob-URL leaks in `MessageComposer.js` | Fixed with a `useEffect` cleanup on unmount plus a revoke in the compression-failure `catch` branch. 2 new tests. |
| 49 — `remapPlayerAsTarget` unreferenced | Deleted. Never had dedicated test coverage. |
| 50 — `undoKillPlayer`'s silent skip | Now throws instead of warning and continuing, aborting the whole transaction. 1 new emulator test. Blast-radius half of this item is unaddressed, deliberately. |
```

- [ ] **Step 4: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass. (`npm run format` will reformat the table's column widths — that's expected, not a problem.)

- [ ] **Step 5: Commit**

```bash
git add docs/improvements.md
git commit -m "Mark improvements.md items 47-50 resolved"
```

---

## Self-Review Notes

- **Spec coverage:** "#47/#49 — delete outright" → Tasks 1 + 2. "#48 — fix the leak, following the backlog item's own suggested fix" → Task 3. "#50 — fail loudly instead of silently skipping" → Task 4, explicitly leaving the blast-radius half untouched (stated in both Task 4's scope and Task 5's "Not addressed" note). Docs closure → Task 5.
- **Placeholder scan:** none — every step has complete, concrete code. Task 5's Step 2 says "locate the exact final sentence... by reading the file" for one insertion point rather than quoting it verbatim — this is a pointer to re-verify current content immediately before editing (the file has been touched by several tasks this session since item 47's text was last read in full), not a placeholder for missing content; the insertion text itself is fully specified.
- **Type consistency:** `undoKill(roomID, photoID)`'s signature is unchanged across Task 4's test and the untouched `src/components/undoKill.js` wrapper. The new Task 4 test's imports (`deleteDoc`, `doc`, `db`, `normalizePlayerName`) match exactly what `dbCalls.js` itself imports for the same purpose, just from this test file's own directory depth.
