# One-Tap Kill Photo Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 📷 button in `MessageComposer.js` open the camera immediately (one tap), and stop rendering the native file input visibly at all — sidestepping an iOS Safari centering bug a CSS-only fix attempt failed to resolve.

**Architecture:** Move the hidden file input, its ref, and the capture/compress/upload/write logic from `KillPhotoModal.js` up into `MessageComposer.js` (the always-mounted parent that owns the 📷 button — required because Chakra's `Modal` doesn't keep its children mounted when closed, so a file input inside it can't be triggered before the modal has ever opened). `KillPhotoModal.js` becomes a presentational component driven entirely by props.

**Tech Stack:** React (hooks), Chakra UI (`VisuallyHidden`), native `<input type="file">`, Jest + React Testing Library (jsdom).

## Global Constraints

- CLAUDE.md's four-command gate (`npm run format`, `npm run lint`, `npm test`, `npm run build`) must pass before any task is considered done.
- TDD: write the failing test first, watch it fail, then implement (per CLAUDE.md).
- Do not modify `src/utils/compressImage.js`, `src/components/firebase_calls/storageCalls.js`, `src/components/firebase_calls/dbCalls.js`, `firestore.rules`, or `storage.rules` — all reused as-is.
- Do not modify `src/pages/PlayerGame.js` or the target-picker's own internal logic (`selectedTarget`/`effectiveTarget` derivation, `RadioGroup`) beyond the prop-interface change described in Task 1.
- jsdom's simulated file-input `change` events (both `userEvent.upload` and `fireEvent.change`) do not reproduce a real browser's refusal to re-fire `change` for an identical file — confirmed by direct experiment during planning. Do not write a test that pretends otherwise (e.g. "select the same file twice, assert compressImage called twice via userEvent.upload" — this fails regardless of whether the source code is correct, because `userEvent.upload`'s own internal state, not the DOM, is what blocks the second call). Test the `event.target.value = ''` reset by asserting the input's `.value` directly, not by relying on a second `change` event actually firing.

---

### Task 1: Make `KillPhotoModal.js` presentational

**Files:**

- Modify: `src/components/player_messages_components/KillPhotoModal.js` (full current content below)
- Modify: `src/components/player_messages_components/KillPhotoModal.test.jsx` (full current content below)

**Interfaces:**

- Consumes: nothing new.
- Produces: `KillPhotoModal`, default export, props `{ isOpen, onClose, targets = [], previewUrl, error, isSubmitting, onSubmit }`. `previewUrl` is a string (object URL) or `null`/`undefined`. `error` is a string or `null`/`undefined`. `isSubmitting` is a boolean. `onSubmit` is a function called as `onSubmit(effectiveTarget)` where `effectiveTarget` is a string (the currently-selected/auto-selected target name). Task 2 renders `<KillPhotoModal isOpen={isPhotoModalOpen} onClose={...} targets={targets} previewUrl={previewUrl} error={photoError} isSubmitting={isSubmitting} onSubmit={handlePhotoSubmit} />`. **Dropped from the old interface:** `roomID`, `playerName` (this component no longer calls anything that needs them).

**Current content of `src/components/player_messages_components/KillPhotoModal.js`:**

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
const KillPhotoModal = ({ isOpen, onClose, roomID, playerName, targets = [] }) => {
    const [selectedTarget, setSelectedTarget] = useState(targets[0] ?? '');
    // Derived, not state: `targets` can arrive asynchronously after mount
    // (PlayerGame.js renders MessageComposer before playerData has loaded),
    // and useState's initializer only runs once. Recomputing this on every
    // render means it self-corrects whenever `targets` changes, instead of
    // being stuck on whatever was true at mount time.
    const effectiveTarget = targets.includes(selectedTarget) ? selectedTarget : (targets[0] ?? '');
    const [compressedBlob, setCompressedBlob] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setError(null);
        setCompressedBlob(null);
        setPreviewUrl(null);
        try {
            const blob = await compressImage(file);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(blob);
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (compressError) {
            console.error('Error compressing photo:', compressError);
            setError('Could not read that photo. Try taking it again.');
        }
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const url = await uploadKillPhoto(roomID, compressedBlob);
            await addPhotoForRoom(roomID, playerName, effectiveTarget, url);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(null);
            setPreviewUrl(null);
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
                        <RadioGroup value={effectiveTarget} onChange={setSelectedTarget} mb={4}>
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
                        display="flex"
                        alignItems="center"
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
                        isDisabled={!compressedBlob || isSubmitting || !effectiveTarget}
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

**Current content of `src/components/player_messages_components/KillPhotoModal.test.jsx`:**

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
    global.URL.revokeObjectURL = jest.fn();
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
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        expect(addPhotoForRoom).toHaveBeenCalledWith(
            'room-a',
            'alice',
            'bob',
            'https://example.com/photo.jpg'
        );
        // The order genuinely matters: the photo must be uploaded (so `url`
        // is valid) before the Firestore doc referencing that url is
        // written.
        expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
            uploadKillPhoto.mock.invocationCallOrder[0]
        );
        expect(uploadKillPhoto.mock.invocationCallOrder[0]).toBeLessThan(
            addPhotoForRoom.mock.invocationCallOrder[0]
        );
    });

    it('keeps the modal open and shows an error when the upload fails, with Submit still clickable', async () => {
        uploadKillPhoto.mockRejectedValue(new Error('network error'));
        mountModal(['bob']);

        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
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

- [ ] **Step 1: Write the failing test**

Replace the full content of `src/components/player_messages_components/KillPhotoModal.test.jsx` with:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * KillPhotoModal is presentational: MessageComposer.js owns capturing,
 * compressing, and submitting the photo, and hands this modal whatever it
 * needs to render (previewUrl/error/isSubmitting) plus an onSubmit
 * callback
 * (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
 * No compressImage/uploadKillPhoto/addPhotoForRoom mocking needed — this
 * component no longer imports any of them.
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
                isOpen
                onClose={onClose}
                targets={['bob']}
                previewUrl={null}
                error={null}
                isSubmitting={false}
                onSubmit={onSubmit}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('KillPhotoModal', () => {
    it('auto-selects the only target and shows no picker when there is exactly one', () => {
        mountModal({ targets: ['bob'] });

        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('shows a picker when there is more than one target', () => {
        mountModal({ targets: ['bob', 'carol'] });

        expect(screen.getByRole('radio', { name: 'bob' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'carol' })).toBeInTheDocument();
    });

    it('shows the preview image when previewUrl is set', () => {
        mountModal({ previewUrl: 'blob:fake-preview' });

        expect(screen.getByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
    });

    it('shows no preview image when previewUrl is not set', () => {
        mountModal({ previewUrl: null });

        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });

    it('shows the error alert when error is set', () => {
        mountModal({ error: 'Could not submit the photo. Check your connection and try again.' });

        expect(
            screen.getByText('Could not submit the photo. Check your connection and try again.')
        ).toBeInTheDocument();
    });

    it('disables Submit when there is no preview yet', () => {
        mountModal({ previewUrl: null });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('disables Submit while isSubmitting', () => {
        mountModal({ previewUrl: 'blob:fake-preview', isSubmitting: true });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('enables Submit once there is a preview and a target', () => {
        mountModal({ previewUrl: 'blob:fake-preview', targets: ['bob'] });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('calls onSubmit with the effective target when Submit is clicked', async () => {
        mountModal({ previewUrl: 'blob:fake-preview', targets: ['bob', 'carol'] });

        await userEvent.click(screen.getByRole('radio', { name: 'carol' }));
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith('carol');
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/player_messages_components/KillPhotoModal.test.jsx`
Expected: FAIL — the current component still requires `roomID`/`playerName`, still owns its own `previewUrl`/`error`/`isSubmitting` state (so passing them as props does nothing), and there's no file-less way to get a preview/error to appear.

- [ ] **Step 3: Write the implementation**

Replace the full content of `src/components/player_messages_components/KillPhotoModal.js` with:

```jsx
import React, { useState } from 'react';
import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Image,
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

// A player submits a kill-photo claim against one of their assigned
// targets. Presentational only — MessageComposer.js owns capturing,
// compressing, and uploading/writing the photo (its camera button
// triggers a hidden file input directly, always mounted so it can be
// triggered before this modal has ever opened); this modal just renders
// whatever MessageComposer hands it and reports back which target the
// user picked
// (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
const KillPhotoModal = ({
    isOpen,
    onClose,
    targets = [],
    previewUrl,
    error,
    isSubmitting,
    onSubmit,
}) => {
    const [selectedTarget, setSelectedTarget] = useState(targets[0] ?? '');
    // Derived, not state: `targets` can arrive asynchronously after mount
    // (PlayerGame.js renders MessageComposer before playerData has loaded),
    // and useState's initializer only runs once. Recomputing this on every
    // render means it self-corrects whenever `targets` changes, instead of
    // being stuck on whatever was true at mount time.
    const effectiveTarget = targets.includes(selectedTarget) ? selectedTarget : (targets[0] ?? '');

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Submit a Kill Photo</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    {targets.length > 1 && (
                        <RadioGroup value={effectiveTarget} onChange={setSelectedTarget} mb={4}>
                            <Stack>
                                {targets.map((target) => (
                                    <Radio key={target} value={target}>
                                        {target}
                                    </Radio>
                                ))}
                            </Stack>
                        </RadioGroup>
                    )}
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
                        onClick={() => onSubmit(effectiveTarget)}
                        isDisabled={!previewUrl || isSubmitting || !effectiveTarget}
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/player_messages_components/KillPhotoModal.test.jsx`
Expected: PASS — 10/10 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: `npm run lint`, `npm run build` pass. `npm test` will FAIL at this point — `MessageComposer.js` still passes `roomID`/`playerName` into `KillPhotoModal` and still relies on it owning the file input/capture logic, so `MessageComposer.test.jsx` and `PlayerGame.targetsIntegration.test.jsx` are expected to fail until Task 2 lands. Confirm the _only_ failures are in those two files (and that `KillPhotoModal.test.jsx` itself passes), then proceed — this is expected, not a bug to fix here.

- [ ] **Step 6: Commit**

```bash
git add src/components/player_messages_components/KillPhotoModal.js src/components/player_messages_components/KillPhotoModal.test.jsx
git commit -m "Make KillPhotoModal presentational, driven by props"
```

---

### Task 2: Move photo capture into `MessageComposer.js`

**Files:**

- Modify: `src/components/player_messages_components/MessageComposer.js` (full current content below)
- Modify: `src/components/player_messages_components/MessageComposer.test.jsx` (full current content below)
- Verify only (no edit expected): `src/pages/PlayerGame.targetsIntegration.test.jsx`

**Interfaces:**

- Consumes: `KillPhotoModal` from Task 1, default export, props `{ isOpen, onClose, targets = [], previewUrl, error, isSubmitting, onSubmit }` — `onSubmit` is called as `onSubmit(effectiveTarget)`. `compressImage(file) → Promise<Blob>` from `src/utils/compressImage.js` (existing, unchanged). `uploadKillPhoto(roomID, blob) → Promise<string>` from `src/components/firebase_calls/storageCalls.js` (existing, unchanged). `addPhotoForRoom(roomID, assassin, target, url) → Promise<void>` from `src/components/firebase_calls/dbCalls.js` (existing, unchanged).
- Produces: no new exports — `MessageComposer` keeps its existing default export and `{ roomID, playerName, targets }` prop signature.

**Current content of `src/components/player_messages_components/MessageComposer.js`:**

```jsx
import React, { useState } from 'react';
import { Flex, Input, Button } from '@chakra-ui/react';
import { addChatMessageForRoom } from '../firebase_calls/dbCalls';
import KillPhotoModal from './KillPhotoModal';

// Sends player-authored group-chat messages and opens the kill-photo
// submission modal
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
// docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
const MessageComposer = ({ roomID, playerName, targets = [] }) => {
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

**Current content of `src/components/player_messages_components/MessageComposer.test.jsx`:**

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

- [ ] **Step 1: Write the failing test**

Replace the full content of `src/components/player_messages_components/MessageComposer.test.jsx` with:

```jsx
/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageComposer sends player-authored group-chat messages and now also
 * owns capturing, compressing, and submitting a kill-photo claim — the
 * camera button triggers a hidden file input directly, and KillPhotoModal
 * (rendered for real here, not stubbed — it has no Firebase imports of
 * its own since the 2026-08-15 one-tap-kill-photo-capture redesign) only
 * appears once a photo has been captured
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
 * docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
 * docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
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
 *
 * jsdom's simulated file-input `change` events do not reproduce a real
 * browser's refusal to re-fire `change` for an identical file, whether
 * driven via `userEvent.upload` or `fireEvent.change` (confirmed by
 * direct experiment while planning this feature) — so the reset test
 * below asserts the input's `.value` directly rather than asserting a
 * second `change` event fires.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';
import { addChatMessageForRoom, addPhotoForRoom } from '../firebase_calls/dbCalls';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';

jest.mock('../firebase_calls/dbCalls', () => ({
    addChatMessageForRoom: jest.fn(),
    addPhotoForRoom: jest.fn(),
}));
jest.mock('../../utils/compressImage', () => ({
    compressImage: jest.fn(),
}));
jest.mock('../firebase_calls/storageCalls', () => ({
    uploadKillPhoto: jest.fn(),
}));

const mountComposer = (playerName = 'Alice', targets = ['bob']) =>
    render(
        <ChakraProvider>
            <MessageComposer roomID="room-a" playerName={playerName} targets={targets} />
        </ChakraProvider>
    );

const fakeBlob = new Blob(['fake'], { type: 'image/jpeg' });
const fakeFile = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

beforeEach(() => {
    jest.clearAllMocks();
    addChatMessageForRoom.mockResolvedValue(undefined);
    global.URL.createObjectURL = jest.fn(() => 'blob:fake-preview');
    global.URL.revokeObjectURL = jest.fn();
    compressImage.mockResolvedValue(fakeBlob);
    uploadKillPhoto.mockResolvedValue('https://example.com/photo.jpg');
    addPhotoForRoom.mockResolvedValue(undefined);
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

    it('selecting a photo compresses it and opens the modal with the preview', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalledWith(fakeFile));
        expect(await screen.findByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
    });

    it('opens the modal with an error, not a preview, when compression fails', async () => {
        compressImage.mockRejectedValue(new Error('bad file'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);

        expect(
            await screen.findByText('Could not read that photo. Try taking it again.')
        ).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });

    it('calls compressImage, uploadKillPhoto, then addPhotoForRoom in order, then closes the modal', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
        );
        expect(uploadKillPhoto).toHaveBeenCalledWith('room-a', fakeBlob);
        expect(addPhotoForRoom).toHaveBeenCalledWith(
            'room-a',
            'Alice',
            'bob',
            'https://example.com/photo.jpg'
        );
        // The order genuinely matters: the photo must be uploaded (so
        // `url` is valid) before the Firestore doc referencing that url
        // is written.
        expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
            uploadKillPhoto.mock.invocationCallOrder[0]
        );
        expect(uploadKillPhoto.mock.invocationCallOrder[0]).toBeLessThan(
            addPhotoForRoom.mock.invocationCallOrder[0]
        );
    });

    it('keeps the modal open and shows an error when the upload fails, with Submit still clickable', async () => {
        uploadKillPhoto.mockRejectedValue(new Error('network error'));
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        await userEvent.upload(screen.getByLabelText('Take Photo'), fakeFile);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(
            await screen.findByText(
                'Could not submit the photo. Check your connection and try again.'
            )
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('resets the file input value after each selection, so the same photo can be selected again', async () => {
        mountComposer();

        await userEvent.click(screen.getByRole('button', { name: 'Send photo' }));
        const fileInput = screen.getByLabelText('Take Photo');
        await userEvent.upload(fileInput, fakeFile);

        await waitFor(() => expect(compressImage).toHaveBeenCalled());
        expect(fileInput.value).toBe('');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/player_messages_components/MessageComposer.test.jsx`
Expected: FAIL — the current `MessageComposer.js` has no `Take Photo` input at all (it's stubbed away in the old test, but this new test doesn't stub `KillPhotoModal`, and the real current `KillPhotoModal` still requires `roomID`/`playerName` and owns its own capture state that these new props can't reach), and clicking "Send photo" still directly opens the modal instead of triggering a hidden file input.

- [ ] **Step 3: Write the implementation**

Replace the full content of `src/components/player_messages_components/MessageComposer.js` with:

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
        try {
            const blob = await compressImage(file);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(blob);
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (compressError) {
            console.error('Error compressing photo:', compressError);
            setPhotoError('Could not read that photo. Try taking it again.');
        } finally {
            setIsPhotoModalOpen(true);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/player_messages_components/MessageComposer.test.jsx`
Expected: PASS — 17/17 tests.

- [ ] **Step 5: Verify `PlayerGame.targetsIntegration.test.jsx` still passes unmodified**

Run: `npx jest src/pages/PlayerGame.targetsIntegration.test.jsx`
Expected: PASS — 1/1 test, with no changes to that file. This is a real check, not an assumption: its interaction sequence (click "Send photo", then `userEvent.upload` the "Take Photo" input, then wait for Submit to enable, then click Submit) should still find and drive the same accessible elements, since the hidden input carries the same `aria-label` and is now always present in the DOM. If this test fails, stop and report the exact failure — do not modify this test file to force it to pass without understanding why it broke; that would mean the design has a real gap the spec didn't anticipate.

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm test && npm run build`
Expected: all four pass — this is the first point at which the whole suite is green again, since Task 1 alone left `MessageComposer.test.jsx`/`PlayerGame.targetsIntegration.test.jsx` failing by design.

- [ ] **Step 7: Commit**

```bash
git add src/components/player_messages_components/MessageComposer.js src/components/player_messages_components/MessageComposer.test.jsx
git commit -m "Move kill-photo capture into MessageComposer for a one-tap camera flow"
```

---

## Self-Review Notes

- **Spec coverage:** "Component boundary" (state/logic moves from `KillPhotoModal` to `MessageComposer`) → Tasks 1 + 2. "Hidden input, not a styled one" (`VisuallyHidden` + plain native `<input>`) → Task 2. "New flow" (tap 📷 → camera → modal-after-capture) → Task 2. "New edge case" (`event.target.value = ''` reset) → Task 2, with the Global Constraints entry explaining why it's tested by asserting `.value` directly rather than a second-fire assertion. "`PlayerGame.targetsIntegration.test.jsx` needs no changes" → Task 2 Step 5, an explicit verification step rather than an assumption.
- **Placeholder scan:** none — every step has complete, concrete code.
- **Type consistency:** `KillPhotoModal`'s prop names (`previewUrl`, `error`, `isSubmitting`, `onSubmit`) match exactly between Task 1's definition and Task 2's call site. `onSubmit(effectiveTarget)`'s single string argument matches `handlePhotoSubmit(effectiveTarget)`'s signature in Task 2.
