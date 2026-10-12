import React, { useEffect, useRef, useState } from 'react';
import { Flex, Input, Button, VisuallyHidden } from '@chakra-ui/react';
import { submitChatMessage } from '../submitChatMessage';
import { submitKillPhoto } from '../submitKillPhoto';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import CreateAlert from '../CreateAlert';
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
const MessageComposer = ({
    roomID,
    playerName,
    isGameActive = true,
    onOptimisticSend,
    onOptimisticSendFailed,
    players = [],
    missions = [],
}) => {
    const [text, setText] = useState('');
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [compressedBlob, setCompressedBlob] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [photoError, setPhotoError] = useState(null);
    const fileInputRef = useRef(null);
    const createAlert = CreateAlert();

    // Revokes any outstanding preview URL if the composer unmounts before
    // the player submits or dismisses their capture — otherwise the
    // browser holds that blob's memory until the tab itself closes
    // (docs/improvements.md item 48).
    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        // submitChatMessage writes server-side (Admin SDK) now, so this
        // browser's own onSnapshot listener has no local echo of its own
        // write anymore — it has to wait for the same real round trip any
        // other player's message would take. onOptimisticSend shows the
        // message immediately instead, standing in until the real,
        // server-confirmed copy arrives and MessageFeed swaps it out
        // (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md
        // regressed this; see PlayerGame.js for where the pending list lives).
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        onOptimisticSend?.({
            id: pendingId,
            type: 'chat',
            recipient: null,
            text: trimmed,
            standings: null,
            mission: null,
            sender: playerName,
            timestamp: null,
        });
        try {
            await submitChatMessage({ roomId: roomID, text: trimmed });
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching MessageFeed's own subscription-error handling — log
            // only, no toast/alert plumbing in this simple composer. The
            // typed text is restored (not left cleared) so a failed send
            // doesn't lose the player's words with no way to retry.
            console.error('Error sending chat message:', error);
            setText(trimmed);
            onOptimisticSendFailed?.(pendingId);
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
            // setPreviewUrl(null) above already cleared the reference, and
            // the useEffect cleanup (registered alongside previewUrl state)
            // revokes the stale blob URL when that happens — nothing further
            // needed here (docs/improvements.md item 48).
            console.error('Error compressing photo:', compressError);
            setPhotoError('Could not read that photo. Try taking it again.');
        }
    };

    // Closes the modal immediately, before uploadKillPhoto/submitKillPhoto
    // have even started, rather than waiting on them the way this used to
    // (they could take several real seconds, especially against a cold
    // Cloud Function). This assumes success — a kill-photo claim almost
    // always succeeds — and the actual upload/write keep running in the
    // background regardless of whether the modal is still open. A failure
    // surfaces via a toast instead of the modal's own inline error banner,
    // since the modal (and that banner) are already gone by the time a
    // failure could happen.
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

    // playerName can be empty when the stored session's room doesn't match
    // the URL (PlayerGame.js) — MessageFeed.js already guards its
    // subscription on the same condition; this keeps the composer from
    // attempting a chat write with sender: ''.
    const disabled = !playerName;
    // Nothing left to submit a kill for once the game's over — chat itself
    // stays open (isGameActive doesn't affect `disabled` above). A player
    // with zero targets (true of every dead player) can still submit a
    // photo — the moderator's combined target/mission dropdown may still
    // have an open mission to offer them even with no live kill target
    // (docs/superpowers/specs/2026-08-27-mission-completion-via-photo-design.md).
    const photoDisabled = disabled || !isGameActive;

    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input
                placeholder="Type a message..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                isDisabled={disabled}
                mr={2}
                maxLength={500}
            />
            <VisuallyHidden>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    aria-label="Take Photo"
                    disabled={photoDisabled}
                />
            </VisuallyHidden>
            <Button
                isDisabled={photoDisabled}
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
                previewUrl={previewUrl}
                error={photoError}
                onSubmit={handlePhotoSubmit}
                players={players}
                missions={missions}
                playerName={playerName}
            />
        </Flex>
    );
};

export default MessageComposer;
