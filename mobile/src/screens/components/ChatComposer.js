import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as callables from '../../firebase/callables';
import * as storageCalls from '../../firebase/storageCalls';
import { isCameraBlocked } from '../../../../src/game/powerUpEffects';
import KillPhotoModal from './KillPhotoModal';

// Same MAX_DIMENSION/JPEG_QUALITY values as the web's
// src/utils/compressImage.js — ImageManipulator does the resize/recompress
// here instead of a <canvas>.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

// A stored Firestore Timestamp, or plain ms in tests.
const toMs = (value) =>
    typeof value?.toMillis === 'function' ? value.toMillis() : (value ?? null);

// RN port of src/components/player_messages_components/MessageComposer.js
// — text-sending (Task 9) plus the camera button's capture/compress/submit
// flow (Task 10). Unlike the web version (a hidden file input, always
// mounted, with `capture="environment"`), the camera button here drives
// expo-image-picker's native camera directly: tapping it calls
// `ImagePicker.launchCameraAsync`, then `ImageManipulator.manipulateAsync`
// resizes/recompresses the result before `KillPhotoModal` ever opens, so
// (unlike the web) there's no "Processing photo…" gap the modal needs to
// cover — it only opens once a manipulated preview already exists, or
// capture/manipulation failed.
const ChatComposer = ({
    roomID,
    playerName,
    isGameActive = true,
    onOptimisticSend,
    onOptimisticSendFailed,
    players = [],
    missions = [],
    // From this player's own doc — set when someone uses "Block a player's
    // camera" on them (purchasePowerUp.js).
    cameraBlockedUntil = null,
    // GameScreen has no real value to pass yet — Task 11 builds the
    // location-permission hook `permissionState` comes from and wires
    // `permissionState === 'granted'` down here. Defaulting to `true`
    // matches the web MessageComposer.js's own `locationEnabled = true`
    // default exactly, so this component works correctly receiving
    // nothing in the meantime.
    locationEnabled = true,
}) => {
    const [text, setText] = useState('');
    const blockedUntilMs = toMs(cameraBlockedUntil);
    const [nowMs, setNowMs] = useState(Date.now());
    // One timer, set for the exact moment the block ends, so the camera
    // re-enables on its own without ticking every second.
    useEffect(() => {
        setNowMs(Date.now());
        if (blockedUntilMs == null) return undefined;
        const remainingMs = blockedUntilMs - Date.now();
        if (remainingMs <= 0) return undefined;
        const id = setTimeout(() => setNowMs(Date.now()), remainingMs);
        return () => clearTimeout(id);
    }, [blockedUntilMs]);
    const cameraBlocked = isCameraBlocked(blockedUntilMs, nowMs);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [previewUri, setPreviewUri] = useState(null);
    const [photoError, setPhotoError] = useState(null);

    // playerName can be empty when the stored session's room doesn't
    // match (GameScreen.js) — ChatFeed.js already guards its subscription
    // on the same condition; this keeps the composer from attempting a
    // chat write with sender: ''.
    const disabled = !playerName;
    // Nothing left to submit a kill for once the game's over — chat itself
    // stays open (isGameActive doesn't affect `disabled` above). A player
    // with zero targets (true of every dead player) can still submit a
    // photo — the moderator's combined target/mission dropdown may still
    // have an open mission to offer them even with no live kill target.
    const photoDisabled = disabled || !isGameActive || cameraBlocked || !locationEnabled;

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        // callables.submitChatMessage writes server-side (Admin SDK), so
        // this device's own onSnapshot listener (ChatFeed.js) has no
        // local echo of its own write — it has to wait for the same real
        // round trip any other player's message would take.
        // onOptimisticSend shows the message immediately instead,
        // standing in until the real, server-confirmed copy arrives and
        // ChatFeed.js swaps it out (see GameScreen.js for where the
        // pending list lives).
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
            await callables.submitChatMessage({ roomId: roomID, text: trimmed });
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching ChatFeed.js's own subscription-error handling —
            // log only. The typed text is restored (not left cleared) so
            // a failed send doesn't lose the player's words with no way
            // to retry.
            console.error('Error sending chat message:', error);
            setText(trimmed);
            onOptimisticSendFailed?.(pendingId);
        }
    };

    const handleCameraPress = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
            });
            if (result.canceled || !result.assets?.length) return;
            const asset = result.assets[0];
            // Same algorithm as the web's src/utils/compressImage.js: cap
            // whichever side is longer, not width alone — a portrait photo
            // (height > width, the common camera-held-vertically case)
            // would otherwise end up with its long side (height)
            // uncapped, defeating the point of compressing at all.
            const scale = Math.min(1, MAX_DIMENSION / Math.max(asset.width, asset.height));
            const manipulated = await ImageManipulator.manipulateAsync(
                asset.uri,
                [
                    {
                        resize: {
                            width: Math.round(asset.width * scale),
                            height: Math.round(asset.height * scale),
                        },
                    },
                ],
                { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
            );
            setPhotoError(null);
            setPreviewUri(manipulated.uri);
            setIsPhotoModalOpen(true);
        } catch (captureError) {
            // Mirrors the web's compressImage.js failure path
            // (MessageComposer.js's handleFileChange catch): open the modal
            // with its existing inline error banner instead of leaving the
            // failure silent — KillPhotoModal/ChatComposer already have the
            // error/photoError plumbing for this, so there is nothing new
            // to build, just actually use it.
            console.error('Error capturing photo:', captureError);
            setPreviewUri(null);
            setPhotoError('Could not read that photo. Try taking it again.');
            setIsPhotoModalOpen(true);
        }
    };

    // Closes the modal immediately, before uploadKillPhoto/submitKillPhoto
    // have even started, rather than waiting on them — this assumes
    // success (a kill-photo claim almost always succeeds) and the actual
    // upload/write keep running in the background regardless of whether
    // the modal is still open, same "assume success, alert on failure"
    // design as the web's handlePhotoSubmit (MessageComposer.js). A
    // failure surfaces via a native Alert instead of the modal's own
    // inline error banner, since the modal is already gone by the time a
    // failure could happen.
    //
    // UNVERIFIED (brief's Step 9, no physical device available to this
    // implementation): what happens if the app is backgrounded right after
    // Submit, before uploadKillPhoto/submitKillPhoto resolve — whether iOS/
    // Android keep this in-flight fetch/upload/callable running to
    // completion, or suspend/kill it, is not yet confirmed either way. A
    // future reader with a real device should record the actual behavior
    // here rather than re-discover it by testing again.
    const handlePhotoSubmit = async (claimValue) => {
        const uriToSubmit = previewUri;
        setPreviewUri(null);
        setPhotoError(null);
        setIsPhotoModalOpen(false);
        const target = claimValue.startsWith('target:') ? claimValue.slice('target:'.length) : null;
        const mission = claimValue.startsWith('mission:')
            ? Number(claimValue.slice('mission:'.length))
            : null;
        const isFunPhoto = claimValue === 'fun';
        try {
            const blob = await (await fetch(uriToSubmit)).blob();
            const url = await storageCalls.uploadKillPhoto(roomID, blob);
            await callables.submitKillPhoto({ roomId: roomID, url, target, mission, isFunPhoto });
        } catch (submitError) {
            console.error('Error submitting kill photo:', submitError);
            Alert.alert(
                'Error submitting kill photo',
                submitError.message ||
                    'Could not submit the photo. Check your connection and try again.'
            );
        }
    };

    return (
        <View style={styles.row}>
            <TextInput
                style={styles.input}
                placeholder="Type a message..."
                placeholderTextColor="#A0AEC0"
                value={text}
                onChangeText={setText}
                editable={!disabled}
                maxLength={500}
                multiline
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={handleSend}
            />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    !locationEnabled
                        ? 'Send photo (enable location first)'
                        : cameraBlocked
                          ? 'Send photo (camera blocked)'
                          : 'Send photo'
                }
                accessibilityState={{ disabled: photoDisabled }}
                disabled={photoDisabled}
                onPress={handleCameraPress}
                style={[styles.cameraButton, photoDisabled && styles.cameraButtonDisabled]}
            >
                <Text style={styles.cameraButtonText}>📷</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled }}
                disabled={disabled}
                style={[styles.sendButton, disabled && styles.sendButtonDisabled]}
                onPress={handleSend}
            >
                <Text style={styles.sendButtonText}>Send</Text>
            </Pressable>
            <KillPhotoModal
                isOpen={isPhotoModalOpen}
                onClose={() => setIsPhotoModalOpen(false)}
                previewUrl={previewUri}
                error={photoError}
                onSubmit={handlePhotoSubmit}
                players={players}
                missions={missions}
                playerName={playerName}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        padding: 8,
        borderTopWidth: 1,
        borderTopColor: '#4A5568', // gray.600
        gap: 8,
    },
    input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 120,
        color: '#FFFFFF',
        backgroundColor: 'rgba(255, 255, 255, 0.06)', // whiteAlpha.100
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    cameraButton: {
        width: 44,
        height: 44,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cameraButtonDisabled: {
        opacity: 0.5,
    },
    cameraButtonText: {
        fontSize: 20,
    },
    sendButton: {
        width: 48,
        height: 44,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#285E61', // teal.700
    },
    sendButtonDisabled: {
        opacity: 0.5,
    },
    sendButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
});

export default ChatComposer;
