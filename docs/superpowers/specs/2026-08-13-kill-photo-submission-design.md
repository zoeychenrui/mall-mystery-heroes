# Kill-photo submission

## Problem

`PhotosDisplay.js` (the GM's photo-moderation queue — approve/deny/undo,
approving actually calls `executeKill`) has been fully built and working
since early in this repo's history, but nothing has ever fed it a photo.
Every spec since 2026-08-07 has explicitly deferred "kill-photo
submission" as a separate, not-yet-designed sub-project — the
`MessageComposer.js` photo button has sat disabled, with no wiring at
all, the whole time. There is no function anywhere that creates a
`photos` document, no camera/file-capture UI anywhere in the app, and no
Firebase Storage upload code anywhere in the codebase. `storage.rules` is
currently wide open (`allow read, write: if request.auth != null` on
every path in the bucket) — deliberately left unscoped because nothing
used Storage yet.

This is that deferred round: let a player actually capture or pick a
photo, submit it as proof of a kill against their assigned target, and
have it land in the GM's existing moderation queue exactly as
`PhotosDisplay.js` already expects.

## Decisions made

- **Target is auto-filled from the player's real assigned target(s),
  not free-typed.** `playerData.targets` is already fetched by
  `PlayerGame.js`. A player can only claim a kill on someone actually
  assigned to them — not a typo-prone free-text field.
- **Capture via a native file input with `capture="environment"`,
  not a custom camera UI.** Opens the device camera directly on mobile,
  falls back to a file picker on desktop. No `getUserMedia` stream
  lifecycle, no manual permission handling — the browser owns all of
  that.
- **Photos are resized and re-compressed client-side before upload.**
  Max dimension 1600px, re-encoded as JPEG at quality 0.8 via the Canvas
  API. Keeps uploads fast on weak venue connections and keeps Storage
  costs down.
- **`storage.rules` gets path-scoped, not room-membership-scoped.**
  Restricted to `rooms/{roomId}/photos/**`, still open to any signed-in
  user within that path (no Firestore lookup to verify room membership).
  Matches this app's existing trust model (client-trusted names,
  everywhere else this session) and avoids cross-service Storage rules,
  which this repo has no test/emulator setup for.
- **The photo capture flow is a modal, triggered by the composer's
  existing 📷 button.** That button has sat inert with a comment
  anticipating exactly this. The target-picker + capture + preview flow
  needs more room than the slim composer bar — a modal matches this
  app's existing pattern for `TaskCreationModal`/`TaskListModal` in the
  GM console.
- **`assassin`/`target`/`url` stay client-trusted.** Same level as
  `sender` in chat messages, whisper recipients, and everywhere else a
  name is written in this app — no new identity verification. The
  `firestore.rules` grant does verify the two fields that matter for
  moderation integrity: a player can only create a photo with
  `status: 'pending'` and `originalPlayerData: null` — they can't
  self-approve a kill or forge the pre-kill snapshot the Undo flow
  relies on.
- **On upload failure, the modal stays open and lets the player retry.**
  A live outdoor game on venue wifi/cellular makes a flaky upload a real,
  expected failure mode, not a hypothetical one — losing the captured
  photo and making them start over would be a real cost.

## Architecture

### Data: `photos` schema (unchanged) and the new write path

The `photos` document shape is already established and already consumed
by `PhotosDisplay.js` (`docs/data-model.md`):

```
rooms/{roomID}/photos/{autoId}
  url                : string
  assassin           : string
  target             : string
  timestamp          : Timestamp (serverTimestamp())
  status             : 'pending' | 'approved' | 'denied'
  originalPlayerData : { score, targets, assassins } | null
```

A new function in `src/components/firebase_calls/dbCalls.js`:

```js
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

### Security: `firestore.rules`

The `photos` match block currently allows `write` only to
`isHostOfExistingRoom(roomId)`. Add a player-scoped `allow create`,
mirroring the pattern already used for `playerMessages`' chat grant:

```
allow create: if isPlayerOfRoom(roomId) &&
  request.resource.data.status == 'pending' &&
  request.resource.data.originalPlayerData == null;
```

The existing host `allow write` is untouched — the GM can still do
everything (including the status transitions Approve/Deny/Undo already
perform).

### Storage: `src/components/firebase_calls/storageCalls.js` (revived)

A new file, mirroring `dbCalls.js`'s role for Firestore — the only place
the Storage client SDK is touched. (A file by this name existed once,
had a broken call signature and no callers, and was deleted;
this is a fresh implementation, not a resurrection of that code.)

```js
import { storage } from '../../utils/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Uploads a kill-photo Blob (already resized/compressed by
// compressImage) to this room's photo path and returns its public
// download URL, ready to write into the photos Firestore document
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
export const uploadKillPhoto = async (roomID, photoBlob) => {
    const photoID = crypto.randomUUID();
    const photoRef = ref(storage, `rooms/${roomID}/photos/${photoID}.jpg`);
    await uploadBytes(photoRef, photoBlob, { contentType: 'image/jpeg' });
    return getDownloadURL(photoRef);
};
```

`src/utils/firebase.js` already exports `storage` (`getStorage(app)`,
with `connectStorageEmulator` already wired up alongside `db`/`auth`) —
it was set up in advance of any real usage. `storageCalls.js` is the
first module to actually import and use it.

### Security: `storage.rules`

Replaces the current wide-open rule:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /rooms/{roomId}/photos/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Anything outside `rooms/{roomId}/photos/**` is no longer reachable —
closing the "any signed-in user, any path in the bucket" hole the file's
own header comment flagged as a placeholder to revisit once real upload
code existed.

### Compression: `src/utils/compressImage.js` (new, pure-ish)

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

`scale` is clamped to a max of `1` so a photo already smaller than
1600px on its long edge isn't upscaled.

### UI: `KillPhotoModal.js` (new)

`src/components/player_messages_components/KillPhotoModal.js`, props
`{ isOpen, onClose, roomID, playerName, targets }`:

- If `targets.length === 1`, that target is auto-selected, no picker
  shown. If more than one, a simple radio group.
- A file input (`accept="image/*" capture="environment"`) styled as a
  "Take Photo" button. Once a file is chosen: shows a thumbnail preview,
  runs it through `compressImage`, enables Submit.
- Submit: `uploadKillPhoto(roomID, compressedBlob)` →
  `addPhotoForRoom(roomID, playerName, selectedTarget, url)` → closes the
  modal on success.
- On failure, the modal stays open with the photo/target selection
  intact, shows an inline error (`Alert` component, matching this app's
  existing error-display convention), and Submit is clickable again —
  no re-capture needed to retry.

### `MessageComposer.js`: wiring the 📷 button

Gains two new props: `targets` (array, threaded from `PlayerGame.js`)
and internal `isPhotoModalOpen` state. The button:

```jsx
<Button
    isDisabled={disabled || targets.length === 0}
    onClick={() => setIsPhotoModalOpen(true)}
    mr={2}
    aria-label="Send photo"
>
    📷
</Button>
<KillPhotoModal
    isOpen={isPhotoModalOpen}
    onClose={() => setIsPhotoModalOpen(false)}
    roomID={roomID}
    playerName={playerName}
    targets={targets}
/>
```

`disabled` is the existing `!playerName` flag already gating the text
input/Send button; `targets.length === 0` is the new condition specific
to the photo button — a player with no assigned target can't claim a
kill.

### `PlayerGame.js`: threading `targets`

One new prop on the existing `<MessageComposer>` call site:

```jsx
<MessageComposer roomID={roomID} playerName={playerName} targets={playerData?.targets ?? []} />
```

`playerData` is already fetched by `PlayerGame.js` for its own
target-display text (`Your target: ...`) — no new subscription needed.

## Testing

- `compressImage.test.js`: given a mocked `Image`/`canvas` (jsdom has no
  real Canvas rendering — this needs a controlled mock of
  `HTMLCanvasElement.prototype.getContext`/`toBlob` and `Image`), a
  larger-than-max image is scaled down preserving aspect ratio; a
  smaller-than-max image is not upscaled (`scale` clamps to 1); the
  returned value is a `Blob`.
- `storageCalls.integration.test.js` (emulator-backed, mirrors
  `dbCalls.integration.test.js`'s pattern): `uploadKillPhoto` uploads a
  Blob and returns a real, fetchable download URL from the Storage
  emulator.
- `dbCalls.integration.test.js`: `addPhotoForRoom` writes the correct
  shape (`status: 'pending'`, `originalPlayerData: null`), readable via
  the existing `fetchPhotosQueryByAscendingTimestampForRoom`.
- `test/firestore.rules.test.js`: a player of the room can create a
  photo with `status: 'pending'` and `originalPlayerData: null`; a
  player cannot create one with `status: 'approved'` or a non-null
  `originalPlayerData`; a stranger (not a player or host) still cannot
  create any `photos` document, unchanged from today.
- `test/storage.rules.test.js` (new — no `storage.rules` test file
  exists in this repo yet; this is the first one, needs its own small
  emulator-test harness mirroring `test/firestore.rules.test.js`'s
  `@firebase/rules-unit-testing` setup but for
  `initializeTestEnvironment`'s `storage` option): a signed-in user can
  read/write under `rooms/{roomId}/photos/**`; a signed-in user cannot
  read/write outside that path; an unauthenticated request is denied
  everywhere. `jest.config.js`'s existing `rules` project already
  matches any `test/**/*.rules.test.js`, so this file needs no jest
  config change — but `package.json`'s `test:rules` script currently
  runs `firebase emulators:exec --only firestore ...`, which does not
  start the Storage emulator `storage.rules.test.js` needs. That script
  changes to `--only firestore,storage`.
- `MessageComposer.test.jsx`: the photo button is disabled when
  `targets` is empty, even if `playerName` is set; clicking it with a
  non-empty `targets` opens `KillPhotoModal` with the right props.
- `KillPhotoModal.test.jsx`: a single target auto-selects with no picker
  shown; multiple targets show a picker; choosing a file and submitting
  calls `compressImage` → `uploadKillPhoto` → `addPhotoForRoom` in order
  with the right arguments, then closes; a rejected upload keeps the
  modal open and shows an error, with Submit still clickable.

## Scope

**In scope:** `addPhotoForRoom`, the `firestore.rules` player-create
grant for `photos`, `storageCalls.js`/`uploadKillPhoto`, the
`storage.rules` path-scoping, `compressImage`, `KillPhotoModal.js`, and
`MessageComposer.js`/`PlayerGame.js`'s wiring.

**Explicitly out of scope:**

- Any change to `PhotosDisplay.js` or the GM-side moderation flow — it
  already works and needs nothing new to consume photos submitted by
  this feature.
- Room-membership verification in `storage.rules` (cross-service rules
  calling into Firestore) — an explicit, deliberate scope decision this
  round, not an oversight.
- Any UI for a player to see the status of their own submitted
  photos (pending/approved/denied) — the GM's moderation queue is the
  only place that state is currently visible; a player-facing status
  view is a future round if wanted.
- Multiple-photo submission for a single kill claim, or editing/deleting
  a submitted photo.
- Any change to how `executeKill`, `approvePhotoForRoom`, or
  `updatePhotoStatusForRoom` work.
