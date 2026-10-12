# Kill-photo submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can capture or pick a photo, claim it as proof of a kill against one of their assigned targets, and have it land — pending, unmodified — in the GM's existing `PhotosDisplay.js` moderation queue.

**Architecture:** A new player-scoped `firestore.rules` grant lets a player create a `photos` document (locked to `status: 'pending'`, `originalPlayerData: null` — no self-approval, no forged undo snapshot). A revived `storageCalls.js` uploads a client-compressed photo to a newly path-scoped Storage bucket and returns its URL; `dbCalls.addPhotoForRoom` writes the Firestore document. A new `KillPhotoModal`, opened by `MessageComposer.js`'s previously-inert 📷 button, ties capture → compress → upload → write together, with the player's real assigned target(s) auto-filled from `PlayerGame.js`'s already-fetched `playerData`.

**Tech Stack:** React (CRA), Firebase Firestore + Storage client SDK, Chakra UI, Jest + React Testing Library (jsdom project for `.test.jsx`/`.test.js`, node project for `.test.js` utils, Firebase emulator for integration/rules projects).

## Global Constraints

- Run `npm run format && npm run lint && npm test && npm run build` before considering any task done (`CLAUDE.md`).
- Firestore reads/writes only ever happen through `src/components/firebase_calls/dbCalls.js`; Storage reads/writes only ever happen through `src/components/firebase_calls/storageCalls.js` — the same one-file-per-service boundary.
- `assassin`/`target`/`url` are client-trusted, same level as `sender` in chat messages and everywhere else a name is written in this app — no new identity verification.
- A player may only **create** a `photos` document with `status: 'pending'` and `originalPlayerData: null` — never any other status, never a non-null `originalPlayerData`. The existing host `allow write` (used by Approve/Deny/Undo) is untouched.
- `storage.rules` is path-scoped to `rooms/{roomId}/photos/**`, not room-membership-scoped — any signed-in user (`request.auth != null`) within that path, no Firestore lookup.
- Photos are resized to a max dimension of 1600px (never upscaled) and re-encoded as JPEG at quality 0.8 client-side before upload.
- Target selection is auto-filled from `playerData.targets` — never free-typed.
- On a failed upload, the modal stays open with the photo/target selection intact and shows an inline error; Submit remains clickable with no re-capture needed.
- `PhotosDisplay.js`, `executeKill`, `approvePhotoForRoom`, and `updatePhotoStatusForRoom` are unchanged — this plan is entirely about feeding that existing queue, not modifying it.

---

## Task 1: `firestore.rules` — players can create `photos` documents

**Files:**

- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.js`

**Interfaces:**

- Consumes: `isPlayerOfRoom(roomId)` (already exists, `firestore.rules:56-61`).
- Produces: a player-create grant on `photos`, consumed by Task 2's `addPhotoForRoom` in production.

- [ ] **Step 1: Write the failing tests**

In `test/firestore.rules.test.js`, rename the `photos` describe block (currently titled `'rooms/{roomId}/photos/{photoId} (interim: host-only write, see firestore.rules comment)'`, at line 342) to `'rooms/{roomId}/photos/{photoId}'` — the "interim: host-only write" framing is no longer accurate. Add these three tests inside that same describe block, after the existing `'allows the host to write'` test:

```js
it('allows a player to create a photo with pending status and no originalPlayerData', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: 'https://example.com/photo.jpg',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
        })
    );
});

it('denies a player creating a photo with a non-pending status', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: 'https://example.com/photo.jpg',
            assassin: 'bob',
            target: 'alice',
            status: 'approved',
            originalPlayerData: null,
        })
    );
});

it('denies a player creating a photo with a non-null originalPlayerData', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(
        addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
            url: 'https://example.com/photo.jpg',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: { score: 10, targets: [], assassins: [] },
        })
    );
});
```

`PLAYER_UID` is already seeded as a joined player of `room-a` (`test/firestore.rules.test.js:76`) — no new seed data needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — the first new test fails (`assertSucceeds` receives a permission-denied rejection), since no player-create grant exists yet. The second and third tests pass vacuously at this point (a player can't create anything yet, so denial is already true for the wrong reason) — expected; Step 5 makes them meaningful.

- [ ] **Step 3: Write minimal implementation**

In `firestore.rules`, replace the `photos` match block (`:105-109`):

```
      // Interim scope — see file header.
      match /photos/{photoId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
      }
```

with:

```
      // Interim scope — see file header.
      match /photos/{photoId} {
        allow read: if isHostOrPlayerOfRoom(roomId);
        allow write: if isHostOfExistingRoom(roomId);
        // Lets a player submit a kill-photo claim without general write
        // access to this collection — scoped narrowly so a player can't
        // self-approve a kill (status must start pending) or forge the
        // pre-kill snapshot the Undo flow relies on (originalPlayerData
        // must be null)
        // (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
        allow create: if isPlayerOfRoom(roomId) &&
          request.resource.data.status == 'pending' &&
          request.resource.data.originalPlayerData == null;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS, all 3 new tests, plus every pre-existing rules test.

- [ ] **Step 5: Confirm the two denial tests are real checks, not vacuous passes**

Temporarily change the new rule's condition from `request.resource.data.status == 'pending'` to `true`, rerun:

Run: `npm run test:rules`
Expected: the `'denies a player creating a photo with a non-pending status'` test now FAILS, proving that test is a real check.

Restore the condition. Then temporarily change `request.resource.data.originalPlayerData == null` to `true`, rerun — the `'denies a player creating a photo with a non-null originalPlayerData'` test should now FAIL. Restore the condition. Rerun once more to confirm all rules tests pass again.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules test/firestore.rules.test.js
git commit -m "Let players create kill-photo claims in playerMessages' sibling photos collection"
```

---

## Task 2: `dbCalls.js` — `addPhotoForRoom`

**Files:**

- Modify: `src/components/firebase_calls/dbCalls.js`
- Modify: `src/components/firebase_calls/dbCalls.integration.test.js`

**Interfaces:**

- Produces: `addPhotoForRoom(roomID, assassin, target, url) → Promise<void>`, consumed by Task 6's `KillPhotoModal.js`.

- [ ] **Step 1: Write the failing test**

In `src/components/firebase_calls/dbCalls.integration.test.js`, add `addPhotoForRoom` and `fetchPhotosQueryByAscendingTimestampForRoom` to the existing `import { ... } from './dbCalls';` block, keeping alphabetical order:

```js
import {
    addChatMessageForRoom,
    addLogForRoom,
    addPhotoForRoom,
    addPlayerForRoom,
    addPlayerMessageForRoom,
    endGame,
    fetchAliveRosterForRoom,
    fetchAllPlayersForRoom,
    fetchAssassinsForPlayer,
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
    fetchTaskIndexThenIncrement,
    updateIsAliveForPlayer,
    updateIsCompleteToTrueForTaskByIndex,
    updatePointsForPlayer,
} from './dbCalls';
```

Add this new describe block anywhere after the existing import/setup section:

```js
describe('addPhotoForRoom', () => {
    it('writes a pending photo with no originalPlayerData', async () => {
        await seedRoom(ROOM, []);

        await addPhotoForRoom(ROOM, 'bob', 'alice', 'https://example.com/photo.jpg');

        const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
        expect(snapshot.docs).toHaveLength(1);
        expect(snapshot.docs[0].data()).toEqual({
            url: 'https://example.com/photo.jpg',
            assassin: 'bob',
            target: 'alice',
            status: 'pending',
            originalPlayerData: null,
            timestamp: expect.anything(),
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:emulator`
Expected: FAIL — `addPhotoForRoom is not a function`, since it doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/components/firebase_calls/dbCalls.js`, add `addPhotoForRoom` immediately after `approvePhotoForRoom` (`:214-221`):

```js
// Player-submitted kill-photo claim — a distinct write from
// approvePhotoForRoom/updatePhotoStatusForRoom (which are GM-only status
// transitions); always starts pending with no originalPlayerData, matching
// what firestore.rules requires for a player-authored create
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
export const addPhotoForRoom = async (roomID, assassin, target, url) => {
    const photosRef = collection(db, 'rooms', roomID, 'photos');
    await addDoc(photosRef, {
        url,
        assassin,
        target,
        timestamp: serverTimestamp(),
        status: 'pending',
        originalPlayerData: null,
    });
};
```

`collection`, `addDoc`, and `serverTimestamp` are already imported in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:emulator`
Expected: PASS, the new test plus every other test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/components/firebase_calls/dbCalls.js src/components/firebase_calls/dbCalls.integration.test.js
git commit -m "Add addPhotoForRoom"
```

---

## Task 3: `storageCalls.js` — `uploadKillPhoto`

**Files:**

- Modify: `package.json`
- Create: `src/components/firebase_calls/storageCalls.js`
- Create: `src/components/firebase_calls/storageCalls.integration.test.js`

**Interfaces:**

- Consumes: `storage` (already exported from `src/utils/firebase.js`, with `connectStorageEmulator` already wired up).
- Produces: `uploadKillPhoto(roomID, photoBlob) → Promise<string>` (the download URL), consumed by Task 6's `KillPhotoModal.js`.

- [ ] **Step 1: Write the failing test**

In `package.json`, `test:emulator`'s `--only` flag needs to also start the Storage emulator for this task's integration test to have anything to connect to. Change (`:33`):

```json
        "test:emulator": "node functions/scripts/sync-shared-game-logic.js && firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,auth,functions \"jest --selectProjects integration --runInBand\"",
```

to:

```json
        "test:emulator": "node functions/scripts/sync-shared-game-logic.js && firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,auth,functions,storage \"jest --selectProjects integration --runInBand\"",
```

Create `src/components/firebase_calls/storageCalls.integration.test.js`:

```js
/**
 * Layer 1 — the data layer against the Storage emulator.
 *
 * Run with `npm run test:emulator`, which now also starts the Storage
 * emulator (package.json's test:emulator script gained `,storage`
 * alongside firestore,auth,functions for this file).
 */
import { uploadKillPhoto } from './storageCalls';

const ROOM = 'test-room';

describe('uploadKillPhoto', () => {
    it('uploads a blob and returns a real, fetchable download URL', async () => {
        const photoBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });

        const url = await uploadKillPhoto(ROOM, photoBlob);

        expect(url).toEqual(expect.stringContaining('http'));
        const response = await fetch(url);
        expect(response.ok).toBe(true);
        const downloaded = new Uint8Array(await response.arrayBuffer());
        expect(Array.from(downloaded)).toEqual([1, 2, 3, 4]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:emulator`
Expected: FAIL — `Cannot find module './storageCalls'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/firebase_calls/storageCalls.js`:

```js
import { storage } from '../../utils/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Uploads a kill-photo Blob (already resized/compressed by compressImage)
// to this room's photo path and returns its public download URL, ready to
// write into the photos Firestore document via addPhotoForRoom
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
export const uploadKillPhoto = async (roomID, photoBlob) => {
    const photoID = crypto.randomUUID();
    const photoRef = ref(storage, `rooms/${roomID}/photos/${photoID}.jpg`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:emulator`
Expected: PASS, the new test plus every other test across the integration project (confirm the earlier `dbCalls.integration.test.js`/other integration suites are unaffected by the Storage emulator now also running).

- [ ] **Step 5: Commit**

```bash
git add package.json src/components/firebase_calls/storageCalls.js src/components/firebase_calls/storageCalls.integration.test.js
git commit -m "Add storageCalls.js and uploadKillPhoto"
```

---

## Task 4: `storage.rules` — path-scope photo uploads

**Files:**

- Modify: `package.json`
- Modify: `storage.rules`
- Create: `test/storage.rules.test.js`

**Interfaces:**

- Produces: a path-scoped Storage rule restricting reachable paths to `rooms/{roomId}/photos/**`. No code-level interface — this task is rules-only.

- [ ] **Step 1: Write the failing tests**

In `package.json`, `test:rules`'s `--only` flag needs to also start the Storage emulator. Change (`:34`):

```json
        "test:rules": "firebase emulators:exec --project demo-mall-mystery-heroes --only firestore \"jest --selectProjects rules --runInBand\"",
```

to:

```json
        "test:rules": "firebase emulators:exec --project demo-mall-mystery-heroes --only firestore,storage \"jest --selectProjects rules --runInBand\"",
```

Create `test/storage.rules.test.js` — this repo's first Storage rules test file, mirroring `test/firestore.rules.test.js`'s `@firebase/rules-unit-testing` setup but using the `storage` emulator option instead of `firestore`:

```js
/**
 * Layer 2 — Firebase Storage security rules, against the emulator.
 *
 * Run with `npm run test:rules`, which now also starts the Storage
 * emulator (package.json's test:rules script gained `,storage` alongside
 * firestore for this file). This repo's first storage.rules test file —
 * mirrors test/firestore.rules.test.js's @firebase/rules-unit-testing
 * setup, adapted for the `storage` emulator option instead of `firestore`
 * (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

const PROJECT_ID = 'demo-mall-mystery-heroes';
const testBytes = new Uint8Array([1, 2, 3, 4]);

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        storage: {
            rules: fs.readFileSync(path.resolve(__dirname, '../storage.rules'), 'utf8'),
            host: 'localhost',
            port: 9199,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearStorage();
});

describe('rooms/{roomId}/photos/**', () => {
    it("allows a signed-in user to write into a room's photos path", async () => {
        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertSucceeds(uploadBytes(ref(storage, 'rooms/room-a/photos/photo.jpg'), testBytes));
    });

    it("allows a signed-in user to read from a room's photos path", async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await uploadBytes(ref(context.storage(), 'rooms/room-a/photos/photo.jpg'), testBytes);
        });

        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertSucceeds(getBytes(ref(storage, 'rooms/room-a/photos/photo.jpg')));
    });

    it('denies an unauthenticated write', async () => {
        const storage = testEnv.unauthenticatedContext().storage();
        await assertFails(uploadBytes(ref(storage, 'rooms/room-a/photos/photo.jpg'), testBytes));
    });
});

describe('paths outside rooms/{roomId}/photos/**', () => {
    it('denies a signed-in user writing outside the photos path', async () => {
        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertFails(uploadBytes(ref(storage, 'rooms/room-a/other.jpg'), testBytes));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — the current `storage.rules` allows any path for any signed-in user, so `'denies a signed-in user writing outside the photos path'` fails (the write succeeds when it should be denied); the other three tests pass vacuously against the current wide-open rule (real checks come in Step 5).

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `storage.rules` with:

```
rules_version = '2';

// Path-scoped, not room-membership-scoped (docs/superpowers/specs/
// 2026-08-13-kill-photo-submission-design.md) — the kill-photo submission
// feature is the first thing in this repo to actually upload to Storage.
// Only rooms/{roomId}/photos/** is reachable; any signed-in user can
// read/write within that path, same trust level as everywhere else a
// player-provided value is trusted in this app (no per-player auth
// identity to scope against, and no cross-service rules calling into
// Firestore to verify room membership — this repo has no test setup for
// that). Revisit if that identity work ever happens.
service firebase.storage {
  match /b/{bucket}/o {
    match /rooms/{roomId}/photos/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS, all 4 new tests, plus every pre-existing rules test (confirm `test/firestore.rules.test.js` is unaffected by the Storage emulator now also running).

- [ ] **Step 5: Confirm the denial tests are real checks, not vacuous passes**

Temporarily change `match /rooms/{roomId}/photos/{allPaths=**}` to `match /{allPaths=**}` (restoring the old wide-open scope), rerun:

Run: `npm run test:rules`
Expected: `'denies a signed-in user writing outside the photos path'` now FAILS (the out-of-scope write succeeds), proving that test is a real check.

Restore the path scoping to `match /rooms/{roomId}/photos/{allPaths=**}`. Then temporarily change `allow read, write: if request.auth != null;` to `allow read, write: if true;`, rerun — `'denies an unauthenticated write'` should now FAIL. Restore the condition. Rerun once more to confirm all rules tests pass again.

- [ ] **Step 6: Commit**

```bash
git add package.json storage.rules test/storage.rules.test.js
git commit -m "Path-scope storage.rules to rooms/{roomId}/photos/**"
```

---

## Task 5: `compressImage` — client-side resize/compress

**Files:**

- Create: `src/utils/compressImage.js`
- Create: `src/utils/compressImage.test.js`

**Interfaces:**

- Produces: `compressImage(file) → Promise<Blob>`, consumed by Task 6's `KillPhotoModal.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/compressImage.test.js`:

```js
/**
 * Layer 1(ish) — pure-ish browser utility, jsdom project (touches the
 * Canvas/Image APIs — browser APIs, not Firebase/React).
 *
 * jsdom implements the DOM API surface (Image, the canvas element,
 * URL.createObjectURL) but does not actually decode/rasterize image bytes
 * or implement canvas 2D rendering — CanvasRenderingContext2D.drawImage
 * and HTMLCanvasElement.toBlob are both stubbed as no-ops that never
 * fire, so these tests replace both with manual mocks that simulate real
 * width/height/onload timing, and spy on document.createElement to
 * inspect the actual canvas element's width/height after compressImage
 * resolves — a real, non-vacuous check of the scaling math, not just
 * "did toBlob get called."
 */
import { compressImage } from './compressImage';

describe('compressImage', () => {
    let createdCanvas;

    beforeEach(() => {
        HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: jest.fn() }));
        HTMLCanvasElement.prototype.toBlob = jest.fn((callback) => {
            callback(new Blob(['fake'], { type: 'image/jpeg' }));
        });
        global.URL.createObjectURL = jest.fn(() => 'blob:fake-url');
        global.URL.revokeObjectURL = jest.fn();

        const realCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tag) => {
            const element = realCreateElement(tag);
            if (tag === 'canvas') createdCanvas = element;
            return element;
        });
    });

    afterEach(() => {
        document.createElement.mockRestore();
    });

    const mockImageWithDimensions = (width, height) => {
        const OriginalImage = global.Image;
        global.Image = class {
            set src(_value) {
                this.width = width;
                this.height = height;
                setTimeout(() => this.onload());
            }
        };
        return () => {
            global.Image = OriginalImage;
        };
    };

    it('scales a larger-than-max image down to the 1600px max dimension, preserving aspect ratio', async () => {
        const restore = mockImageWithDimensions(3200, 1600);
        const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

        const result = await compressImage(file);

        expect(createdCanvas.width).toBe(1600);
        expect(createdCanvas.height).toBe(800);
        expect(result).toBeInstanceOf(Blob);
        restore();
    });

    it('does not upscale an image already smaller than the max dimension', async () => {
        const restore = mockImageWithDimensions(400, 300);
        const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

        const result = await compressImage(file);

        expect(createdCanvas.width).toBe(400);
        expect(createdCanvas.height).toBe(300);
        expect(result).toBeInstanceOf(Blob);
        restore();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=compressImage`
Expected: FAIL — `Cannot find module './compressImage'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/compressImage.js`:

```js
// Resizes and re-compresses an image File before upload — mobile camera
// photos can be several MB, and this keeps uploads fast on weak venue
// connections and keeps Storage costs down
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
// Touches the Canvas API (a browser API, not Firebase/React), same
// category as MessageFeed.js's DOM scroll handling.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export const compressImage = (file) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = image.width * scale;
            canvas.height = image.height * scale;
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
            URL.revokeObjectURL(image.src);
        };
        image.onerror = reject;
        image.src = URL.createObjectURL(file);
    });
```

`scale` is clamped to a max of `1` so a photo already smaller than 1600px on its long edge isn't upscaled.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=compressImage`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/compressImage.js src/utils/compressImage.test.js
git commit -m "Add compressImage, a client-side resize/re-encode helper"
```

---

## Task 6: `KillPhotoModal` — capture, preview, submit

**Files:**

- Create: `src/components/player_messages_components/KillPhotoModal.js`
- Create: `src/components/player_messages_components/KillPhotoModal.test.jsx`

**Interfaces:**

- Consumes: `compressImage(file)` (Task 5), `uploadKillPhoto(roomID, photoBlob)` (Task 3), `addPhotoForRoom(roomID, assassin, target, url)` (Task 2).
- Produces: `KillPhotoModal` (default export, props `{ isOpen, onClose, roomID, playerName, targets }`), consumed by Task 7's `MessageComposer.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/player_messages_components/KillPhotoModal.test.jsx`:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Explicit mock factories for compressImage, uploadKillPhoto, and
 * addPhotoForRoom — not auto-mocked, matching this codebase's established
 * convention for dbCalls.js/firebase-adjacent modules (see
 * ChatInput.test.jsx for the underlying reasoning).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KillPhotoModal from './KillPhotoModal';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import { addPhotoForRoom } from '../firebase_calls/dbCalls';

jest.mock('../../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    addPhotoForRoom: jest.fn(),
}));

const onClose = jest.fn();

const mountModal = (targets = ['bob']) =>
    render(
        <ChakraProvider>
            <KillPhotoModal
                isOpen
                onClose={onClose}
                roomID="room-a"
                playerName="alice"
                targets={targets}
            />
        </ChakraProvider>
    );

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    addPhotoForRoom.mockResolvedValue(undefined);
});

describe('KillPhotoModal', () => {
    it('auto-selects the only target and shows no picker when there is exactly one', () => {
        mountModal(['bob']);

        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('shows a picker when there is more than one target', () => {
        mountModal(['bob', 'carol']);

        expect(screen.getByRole('radio', { name: 'bob' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'carol' })).toBeInTheDocument();
    });

    it('calls compressImage, uploadKillPhoto, then addPhotoForRoom in order, then closes', async () => {
        mountModal(['bob']);

        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(compressImage).toHaveBeenCalledWith(fakeFile));

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        expect(addPhotoForRoom).toHaveBeenCalledWith(
            'room-a',
            'alice',
            'bob',
            'https://example.com/photo.jpg'
        );
    });

    it('keeps the modal open and shows an error when the upload fails, with Submit still clickable', async () => {
        uploadKillPhoto.mockRejectedValue(new Error('network error'));
        mountModal(['bob']);

        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(compressImage).toHaveBeenCalled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(
            await screen.findByText(
                'Could not submit the photo. Check your connection and try again.'
            )
        ).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern=KillPhotoModal`
Expected: FAIL — `Cannot find module './KillPhotoModal'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/player_messages_components/KillPhotoModal.js`:

```jsx
import React, { useRef, useState } from 'react';
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Image,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Radio,
    RadioGroup,
    Stack,
} from '@chakra-ui/react';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import { addPhotoForRoom } from '../firebase_calls/dbCalls';

// A player submits a kill-photo claim against one of their assigned
// targets — capture/pick a photo, resize/compress it client-side, upload
// to Storage, then write the photos document PhotosDisplay.js's
// moderation queue already consumes
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
const KillPhotoModal = ({ isOpen, onClose, roomID, playerName, targets }) => {
    const [selectedTarget, setSelectedTarget] = useState(targets[0] ?? '');
    const [compressedBlob, setCompressedBlob] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setError(null);
        const blob = await compressImage(file);
        setCompressedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const url = await uploadKillPhoto(roomID, compressedBlob);
            await addPhotoForRoom(roomID, playerName, selectedTarget, url);
            onClose();
        } catch (submitError) {
            console.error('Error submitting kill photo:', submitError);
            setError('Could not submit the photo. Check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} initialFocusRef={fileInputRef}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {targets.length > 1 && (
                        <RadioGroup value={selectedTarget} onChange={setSelectedTarget} mb={4}>
                            <Stack>
                                {targets.map((target) => (
                                    <Radio key={target} value={target}>
                                        {target}
                                    </Radio>
                                ))}
                            </Stack>
                        </RadioGroup>
                    )}
                    <Input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleFileChange}
                        aria-label="Take Photo"
                        mb={4}
                    />
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
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    <Button
                        colorScheme="teal"
                        onClick={handleSubmit}
                        isDisabled={!compressedBlob || isSubmitting}
                        isLoading={isSubmitting}
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern=KillPhotoModal`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/KillPhotoModal.js src/components/player_messages_components/KillPhotoModal.test.jsx
git commit -m "Add KillPhotoModal: capture, compress, upload, submit"
```

---

## Task 7: Wire the composer's 📷 button and thread `targets`

**Files:**

- Modify: `src/components/player_messages_components/MessageComposer.js`
- Modify: `src/components/player_messages_components/MessageComposer.test.jsx`
- Modify: `src/pages/PlayerGame.js`
- Modify: `src/pages/PlayerGame.test.jsx`

**Interfaces:**

- Consumes: `KillPhotoModal` (Task 6, props `{ isOpen, onClose, roomID, playerName, targets }`).
- Produces: nothing new consumed elsewhere — this is the plan's final integration point.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/components/player_messages_components/MessageComposer.test.jsx` with:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages and opens the
 * kill-photo submission modal
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
 * docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
 *
 * KillPhotoModal has its own thorough test file (KillPhotoModal.test.jsx)
 * — stubbed here so this file stays focused on MessageComposer's own
 * wiring logic (the photo button's enable/disable condition, and that it
 * opens the modal with the right props), same reasoning
 * GameMasterView.test.jsx stubs ChatInput.
 *
 * Explicit mock factory for dbCalls.js, not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 *
 * Interactions that trigger `handleSend` (async — it `await`s
 * `addChatMessageForRoom`) are followed by a `waitFor` on their resulting
 * assertion, not a manual `act(async () => { ... })` wrapper around the
 * `userEvent` call: `userEvent`'s methods already wrap themselves in `act`
 * internally, and wrapping them again is the exact anti-pattern
 * `testing-library/no-unnecessary-act` exists to flag.
 *
 * This file's `userEvent.type` calls do still print "not wrapped in
 * act(...)" warnings during typing — investigated (final review,
 * chat-send-and-efficiency, fix round 2) and found to be a pre-existing,
 * repo-wide characteristic of `@testing-library/user-event@13.5.0`
 * (package.json) under React 18, not something this file's tests trigger
 * uniquely or incorrectly: `ChatInput.test.jsx`, untouched by this
 * feature, prints over a thousand of the identical warning from its own
 * `userEvent.type` calls. Manually re-wrapping `userEvent` in `act()`
 * silences the symptom but is the anti-pattern the lint rule above exists
 * to catch, and isn't this codebase's existing convention (ChatInput
 * doesn't do it either) — fixing the root cause would mean upgrading
 * `@testing-library/user-event` to v14 across the whole suite, out of
 * scope for this feature. Tests here still pass deterministically.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
}));
jest.mock('./KillPhotoModal', () => (props) => (
    <div>{`kill-photo-modal-stub isOpen=${props.isOpen} roomID=${props.roomID} playerName=${props.playerName} targets=${JSON.stringify(props.targets)}`}</div>
));

const mountComposer = (playerName = 'Alice', targets = ['bob']) =>
    render(
        <ChakraProvider>
            <MessageComposer roomID="room-a" playerName={playerName} targets={targets} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    addChatMessageForRoom.mockResolvedValue(undefined);
});

describe('MessageComposer', () => {
    it('renders an enabled message input and Send button', () => {
        mountComposer();

        expect(screen.getByPlaceholderText('Type a message...')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('enables the photo button when playerName and targets are both set', () => {
        mountComposer('Alice', ['bob']);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeEnabled();
    });

    it('disables the photo button when targets is empty, even if playerName is set', () => {
        mountComposer('Alice', []);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('disables the photo button when playerName is empty, even if targets is set', () => {
        mountComposer('', ['bob']);

        expect(screen.getByRole('button', { name: 'Send photo' })).toBeDisabled();
    });

    it('opens KillPhotoModal with the right props when the photo button is clicked', async () => {
        mountComposer('Alice', ['bob']);

        expect(
            screen.getByText(
                'kill-photo-modal-stub isOpen=false roomID=room-a playerName=Alice targets=["bob"]'
            )
        ).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));

        expect(
            screen.getByText(
                'kill-photo-modal-stub isOpen=true roomID=room-a playerName=Alice targets=["bob"]'
            )
        ).toBeInTheDocument();
    });

    it('sends the typed message when Send is clicked', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hey where are you');
        await userEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() =>
            expect(addChatMessageForRoom).toHaveBeenCalledWith(
                'hey where are you',
                'Alice',
                'room-a'
            )
        );
    });

    it('sends the typed message when Enter is pressed', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi{Enter}');

        await waitFor(() =>
            expect(addChatMessageForRoom).toHaveBeenCalledWith('hi', 'Alice', 'room-a')
        );
    });

    it('does not send on Shift+Enter, so a future multiline input could still get a newline', async () => {
        mountComposer();

        await userEvent.type(
            screen.getByPlaceholderText('Type a message...'),
            'hi{Shift>}{Enter}{/Shift}'
        );

        expect(addChatMessageForRoom).not.toHaveBeenCalled();
    });

    it('clears the input after sending', async () => {
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        await waitFor(() => expect(addChatMessageForRoom).toHaveBeenCalled());
        expect(input).toHaveValue('');
    });

    it('does not send a blank or whitespace-only message', async () => {
        mountComposer();

        await userEvent.type(screen.getByPlaceholderText('Type a message...'), '   {Enter}');

        expect(addChatMessageForRoom).not.toHaveBeenCalled();
    });

    it('restores the typed text if the send fails, instead of losing it', async () => {
        addChatMessageForRoom.mockRejectedValue(new Error('network error'));
        mountComposer();
        const input = screen.getByPlaceholderText('Type a message...');

        await userEvent.type(input, 'hi{Enter}');

        await waitFor(() => expect(input).toHaveValue('hi'));
    });

    it('disables the input and Send button when playerName is empty', () => {
        mountComposer('');

        expect(screen.getByPlaceholderText('Type a message...')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });
});
```

In `src/pages/PlayerGame.test.jsx`, replace the `MessageComposer` stub (`:51-55`):

```jsx
jest.mock('../components/player_messages_components/MessageComposer', () => (props) => (
    <div>
        message-composer-stub roomID={props.roomID} playerName={props.playerName}
    </div>
));
```

with:

```jsx
jest.mock('../components/player_messages_components/MessageComposer', () => (props) => (
    <div>
        message-composer-stub roomID={props.roomID} playerName={props.playerName} targets=
        {JSON.stringify(props.targets)}
    </div>
));
```

Replace the assertion at the end of the existing `'mounts the message feed even before the game has started'` test (`:272-277`):

```jsx
expect(
    screen.getByText('message-feed-stub roomID=Fluffy42317 playerName=Alice')
).toBeInTheDocument();
expect(
    screen.getByText('message-composer-stub roomID=Fluffy42317 playerName=Alice')
).toBeInTheDocument();
```

with:

```jsx
expect(
    screen.getByText('message-feed-stub roomID=Fluffy42317 playerName=Alice')
).toBeInTheDocument();
expect(
    screen.getByText('message-composer-stub roomID=Fluffy42317 playerName=Alice targets=[]')
).toBeInTheDocument();
```

(`playerData` is still `null` in this test — `gameStarted: false` means the player-doc subscription never starts — so `targets` resolves to `[]`.)

Add an assertion to the existing `'subscribes to the player doc once gameStarted is true and shows the target'` test (`:195-209`), right after its existing `'Your target: Bob'` assertion:

```jsx
expect(screen.getByText('Your target: Bob')).toBeInTheDocument();
expect(
    screen.getByText('message-composer-stub roomID=Fluffy42317 playerName=Alice targets=["Bob"]')
).toBeInTheDocument();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects dom --testPathPattern="MessageComposer|PlayerGame"`
Expected: FAIL — `MessageComposer.js` doesn't accept a `targets` prop or render `KillPhotoModal` yet, so every new/changed assertion fails.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/components/player_messages_components/MessageComposer.js` with:

```jsx
import React, { useState } from 'react';
import { Flex, Input, Button } from '@chakra-ui/react';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';
import KillPhotoModal from './KillPhotoModal';

// Sends player-authored group-chat messages and opens the kill-photo
// submission modal
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
// docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
const MessageComposer = ({ roomID, playerName, targets }) => {
    const [text, setText] = useState('');
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);

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
            <Button
                isDisabled={disabled || targets.length === 0}
                onClick={() => setIsPhotoModalOpen(true)}
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
                roomID={roomID}
                playerName={playerName}
                targets={targets}
            />
        </Flex>
    );
};

export default MessageComposer;
```

In `src/pages/PlayerGame.js`, replace the `<MessageComposer>` call site (`:119`):

```jsx
<MessageComposer roomID={roomID} playerName={playerName} />
```

with:

```jsx
<MessageComposer roomID={roomID} playerName={playerName} targets={playerData?.targets ?? []} />
```

`playerData` is already fetched by this file's existing `useState`/`useEffect` for the "Your target:" text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --selectProjects dom --testPathPattern="MessageComposer|PlayerGame"`
Expected: PASS, all tests in both files.

Then run: `npx jest --selectProjects dom --testPathPattern=KillPhotoModal`
Expected: PASS, unaffected (KillPhotoModal itself didn't change).

- [ ] **Step 5: Commit**

```bash
git add src/components/player_messages_components/MessageComposer.js src/components/player_messages_components/MessageComposer.test.jsx src/pages/PlayerGame.js src/pages/PlayerGame.test.jsx
git commit -m "Wire the composer's photo button to KillPhotoModal"
```

---

## Task 8: Docs and final gate

**Files:**

- Modify: `docs/data-model.md`
- Modify: `docs/testing.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — documentation and verification only.

- [ ] **Step 1: Update `docs/data-model.md`**

Replace the `photos` section's opening paragraph (`:191-196`):

```markdown
Kill-proof photos. **Designed to be written by a player-facing mobile app**,
not by this codebase — nothing in `dbCalls.js` writes a photo document (the
test helper that once did, `addPhotoForRoom`, had no callers and was
deleted; `improvements.md` item 14). That app doesn't exist yet
(`improvements.md` item 33), so today this collection has no writer at all
except manual/emulator seeding.
```

with:

```markdown
Kill-proof photos, written by a player claiming a kill against one of
their assigned targets — `dbCalls.addPhotoForRoom`, called from
`KillPhotoModal.js` after the photo is uploaded to Storage via
`storageCalls.uploadKillPhoto`
(docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
`firestore.rules` scopes a player's create to `status: 'pending'` and
`originalPlayerData: null` — a player can submit a claim but cannot
self-approve it or forge the pre-kill snapshot the Undo flow relies on.
```

Update the `playerMessages` section's reference to `photos` (`:223-225`), which is now stale in the same way:

```markdown
**Designed to be read by a player-facing mobile app**, not by this
codebase — the mirror case of `photos` above, which is designed to be
_written_ by that same not-yet-existing app.
```

to:

```markdown
**Designed to be read by a player-facing mobile app**, not by this
codebase — unlike `photos` above, which now has a real in-app writer
(`KillPhotoModal.js`), nothing in this codebase reads `playerMessages`
except `MessageFeed.js`/`GMChatPanel.js`, both entirely separate from
whatever a future mobile app might eventually read this collection for.
```

- [ ] **Step 2: Update `docs/testing.md`**

Run the real suites and copy their actual output — do not hand-type or estimate:

```bash
npx jest --selectProjects unit dom
npm run test:emulator
npm run test:rules
```

Update the illustrative `$ npm test` block, the module table (adding rows for `compressImage.test.js`, `KillPhotoModal.test.jsx`, `storageCalls.integration.test.js`, `test/storage.rules.test.js`; updating `MessageComposer.test.jsx`'s and `PlayerGame.test.jsx`'s descriptions to mention the photo button/`targets` wiring; updating `dbCalls.integration.test.js`'s and `test/firestore.rules.test.js`'s counts) with these runs' real counts, and update the doc's total suite/test counts (unit+dom, emulator, and rules totals) to match.

- [ ] **Step 3: Run the full gate**

```bash
npm run format
npm run lint
npm test
npm run test:emulator
npm run test:rules
npm run build
```

Expected: all succeed with zero warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add docs/data-model.md docs/testing.md
git commit -m "Document kill-photo submission"
```
