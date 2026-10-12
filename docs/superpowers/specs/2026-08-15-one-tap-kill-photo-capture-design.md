# One-Tap Kill Photo Capture Design

**Date:** 2026-08-15
**Status:** Approved

## Problem

Two related issues surfaced from live iPhone testing of the kill-photo-submission
feature:

1. The native `<input type="file">` in `KillPhotoModal.js` renders with its
   internal "choose file"/camera button not vertically centered on iOS
   Safari. A first fix attempt (`display="flex" alignItems="center"` on the
   Chakra `Input`) was deployed and confirmed not to have fixed it.
2. Tapping the 📷 button in `MessageComposer.js` opens `KillPhotoModal`
   first (empty), and the user then has to tap the file input _inside_ the
   modal to trigger the camera — two taps for something that could be one,
   since the camera opens directly on this browser anyway (no intermediate
   OS-level chooser).

Rather than keep guessing CSS fixes against a native file input — a
notoriously unreliable control to style consistently across browsers,
especially iOS Safari — the fix is to stop rendering it visibly at all,
and trigger it via `.click()` from a normal, fully-stylable button. This
also directly solves problem 2: that trigger can be the 📷 button itself,
called synchronously from its own `onClick` (preserving the trusted-user-
gesture chain browsers require to auto-open a camera/file-picker).

## Decisions

**New flow:** tap 📷 → camera opens immediately → photo taken → the modal
opens showing the preview, target picker (if the player has more than one
target), and Submit. Capture now happens _before_ the modal appears,
reversing today's order.

**Component boundary:** the hidden file input, its ref, `compressImage`/
`uploadKillPhoto`/`addPhotoForRoom` calls, and the resulting `previewUrl`/
`error`/`isSubmitting` state move from `KillPhotoModal.js` up into
`MessageComposer.js` — the always-mounted parent that owns the 📷 button.
This isn't optional: Chakra's `<Modal>` doesn't keep its children mounted
in the DOM when `isOpen` is false, so a file input living inside the modal
can't be `.click()`-triggered before the modal has ever opened. It has to
live somewhere always-mounted.

`KillPhotoModal.js` becomes presentational. It keeps its own target-picker
(`selectedTarget`/`effectiveTarget` derivation, `RadioGroup` — purely
local UI, no reason to move), but receives `previewUrl`, `error`,
`isSubmitting` as props for rendering, and calls a new `onSubmit
(effectiveTarget)` prop instead of doing the upload/write itself. It no
longer imports `compressImage`, `uploadKillPhoto`, or `addPhotoForRoom` —
and no longer needs `roomID`/`playerName` props, since it doesn't call
anything that needs them.

**Hidden input, not a styled one:** the file input becomes a plain native
`<input>` (not Chakra's `Input`, which caused the centering bug in the
first place — irrelevant now since nothing renders it visibly), wrapped in
Chakra's `VisuallyHidden` component. `VisuallyHidden` keeps the element in
the accessibility tree (so `aria-label="Take Photo"` still works for
Testing Library's `getByLabelText` and for screen readers) while removing
it from visual layout — the idiomatic Chakra pattern for "present and
functional, not rendered," and more reliable for programmatic `.click()`
triggering across browsers than `display:none`.

**Everything else is a relocation, not a redesign.** The exact reset/
error-handling logic in the current `handleFileChange`/`handleSubmit`
moves unchanged. Close still doesn't reset the captured-photo state,
matching today's behavior. `initialFocusRef` is dropped from the `Modal`
(the file input it pointed at no longer lives inside it) — Chakra's
default modal focus behavior takes over.

**New edge case introduced by moving the input:** in the old design, the
native `<input type="file">` was inside `Modal`'s conditionally-rendered
content, so it remounted fresh every time the modal opened — the browser
never saw the same DOM node twice, so re-selecting an identical file
always fired a fresh `change` event. In the new design the input is
always-mounted, so a native file input's `change` event does _not_ fire
again if the user selects the exact same file twice in a row (same file
path/identity — plausible for a gallery re-selection, not really possible
for two separate camera captures). Fix: reset `event.target.value = ''`
immediately after reading the selected file in `handleFileChange`, so the
input is always primed to fire again regardless of what's picked next.

## Data flow

```
tap 📷  →  fileInputRef.current.click()  →  camera/file picker opens
                                                     |
                                          user picks/takes a photo
                                                     |
                                    handleFileChange (MessageComposer)
                                    - event.target.value = '' (reset)
                                    - compressImage(file)
                                          |                    |
                                     success               failure
                                          |                    |
                            previewUrl/compressedBlob    error message set
                                    set                        |
                                          \                   /
                                           isPhotoModalOpen(true)
                                                     |
                                    KillPhotoModal renders: preview
                                    (if any) + target picker (if >1
                                    target) + error (if any) + Submit
                                                     |
                                    user picks target, taps Submit
                                                     |
                                    onSubmit(effectiveTarget) called
                                    (MessageComposer's handleSubmit)
                                    - uploadKillPhoto → addPhotoForRoom
                                    - success: close modal, clear state
                                    - failure: show error, stay open
```

If the user cancels the camera/picker without selecting a photo,
`event.target.files[0]` is undefined and `handleFileChange` returns
immediately — the modal never opens. This is a natural improvement over
today's flow, where cancelling still left an empty modal open.

## Components

### `src/components/player_messages_components/MessageComposer.js` (modified)

Gains: `fileInputRef` (`useRef`), `previewUrl`/`compressedBlob`/
`photoError`/`isSubmitting` state, `handleFileChange`, `handleSubmit`.
The 📷 `Button`'s `onClick` changes from `() => setIsPhotoModalOpen(true)`
to `() => fileInputRef.current.click()`. Renders a `VisuallyHidden`-
wrapped native `<input type="file" accept="image/*" capture="environment"
aria-label="Take Photo" onChange={handleFileChange} ref={fileInputRef} />`
as a sibling of the 📷 button. Passes `previewUrl`, `error={photoError}`,
`isSubmitting`, and `onSubmit={handleSubmit}` into `KillPhotoModal`
alongside the existing `isOpen`/`onClose`/`targets`.

### `src/components/player_messages_components/KillPhotoModal.js` (modified)

Props become `{ isOpen, onClose, targets = [], previewUrl, error,
isSubmitting, onSubmit }` — drops `roomID`/`playerName`. Drops the
`compressImage`/`uploadKillPhoto`/`addPhotoForRoom` imports and the file
`Input` element entirely. Submit's `isDisabled` condition becomes
`!previewUrl || isSubmitting || !effectiveTarget` (swapping
`compressedBlob` for `previewUrl` — they're always set together, and the
Blob itself no longer needs to be passed down as a prop for a presentational
component to check). Submit's `onClick` becomes `() => onSubmit
(effectiveTarget)`. `Modal` drops `initialFocusRef`.

## Testing

- **`KillPhotoModal.test.jsx`** becomes fully presentational, with no
  `compressImage`/`uploadKillPhoto`/`addPhotoForRoom` mocking needed at
  all (the component no longer imports them): auto-selects the single
  target and hides the picker when there's exactly one; shows a picker
  for more than one; shows the preview image when `previewUrl` is set;
  shows the error alert when `error` is set; Submit is disabled without a
  `previewUrl`, while `isSubmitting`, or without an `effectiveTarget`;
  clicking Submit calls `onSubmit` with the currently-selected target;
  clicking Close calls `onClose`.
- **`MessageComposer.test.jsx`** absorbs the old `KillPhotoModal.test.jsx`'s
  capture-flow tests (that behavior now genuinely lives here): mocks
  `compressImage`/`uploadKillPhoto`/`addPhotoForRoom` at the top of the
  file, same as those flow tests did before. The existing
  `jest.mock('./KillPhotoModal', ...)` stub is removed — `KillPhotoModal`
  renders for real throughout this file now that it has zero Firebase
  imports of its own, matching this codebase's established preference for
  exercising simple presentational children for real rather than stubbing
  them (see `Lobby.test.jsx`'s reasoning for `TargetGenerator`/
  `PlayerRemove`). Covers: selecting a file compresses it and opens the
  modal with the preview; compression failure opens the modal with the
  error instead; the full compress → uploadKillPhoto → addPhotoForRoom
  call order on submit (an `invocationCallOrder` assertion, ported as-is
  from the old test); submit failure keeps the modal open with the error
  and Submit still enabled; selecting the same file twice in a row still
  fires `handleFileChange` both times (pins the `event.target.value = ''`
  reset).
- **`PlayerGame.targetsIntegration.test.jsx` needs no changes.** Its
  interaction sequence — click "Send photo", then `userEvent.upload` the
  "Take Photo" input, then wait for Submit to enable, then click Submit —
  stays valid under the new implementation: the hidden input carries the
  same accessible name and is now _always_ present in the DOM (previously
  it only existed once the modal had opened), so the same query/upload
  step still finds and drives it correctly. This is worth confirming
  during implementation, not just assuming.

## Error handling

No new failure modes. The exact `try`/`catch`/`finally` structure of
`handleFileChange` and `handleSubmit` is preserved, just relocated. The
only behavioral change is _when_ the modal opens to show an error — on
compression failure it now opens for the first time (rather than staying
open, since it wasn't open yet) — which is a strictly better outcome than
before: the user always sees exactly one modal-open transition per
attempted photo, success or failure, instead of an empty modal appearing
before any photo exists.

## Out of scope

- No change to `compressImage.js`, `storageCalls.js`, `dbCalls.js`, or
  `firestore.rules`/`storage.rules` — all reused as-is.
- No change to the target-picker's own logic or the `RadioGroup` UI.
- No change to `PlayerGame.js` or how `targets` is threaded down to
  `MessageComposer`.
