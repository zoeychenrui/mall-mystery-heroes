import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { updateDoc } from 'firebase/firestore';
import { auth } from '../../firebase/firebaseConfig';
import * as dbCalls from '../../firebase/dbCalls';
import * as storageCalls from '../../firebase/storageCalls';

// Same MAX_DIMENSION/JPEG_QUALITY values as ChatComposer.js's own capture
// flow (Task 10), which mirrors the web's src/utils/compressImage.js —
// mirrored here rather than imported from ChatComposer.js: that module
// eagerly builds its Cloud Functions callables at import time (callables.js),
// which would drag a second, unrelated Firebase surface into every test of
// this component just to reach two numeric constants.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

// RN has no equivalent of Chakra's `Avatar` `name`-initials fallback —
// render the first letter of the name manually wherever a photo is absent.
// Exported so GameScreen.js's target list (Task 15) renders the same
// fallback for each target's avatar.
export const getInitial = (name) => {
    const trimmed = (name ?? '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

// A circular photo, or an initials fallback when `uri` is absent.
// Presentational only — AvatarButton below wraps it in a Pressable for the
// player's own avatar; GameScreen.js's target list (Task 15) wraps it in
// its own Pressable per target instead of going through AvatarButton.
export const AvatarCircle = ({ uri, name, size = 40 }) => (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        {uri ? (
            <Image
                source={{ uri }}
                accessibilityLabel={name ? `${name}'s photo` : 'Photo'}
                style={[styles.image, { borderRadius: size / 2 }]}
            />
        ) : (
            <Text style={styles.initial}>{getInitial(name)}</Text>
        )}
    </View>
);

// Shown when the small avatar button is tapped, instead of jumping
// straight into the camera — lets the player see what they currently
// have before deciding to replace it (bug report: tapping it used to
// just blast into the camera with no preview, which felt like it came
// out of nowhere). `busy` swaps the photo for a spinner while a newly
// taken one is uploading; Close is disabled for that same stretch so the
// modal can't be dismissed mid-upload.
const AvatarPhotoModal = ({ isOpen, onClose, playerName, avatarUrl, onTakePhoto, busy }) => (
    <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
        <View style={styles.overlay}>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>Your Photo</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close your photo"
                        accessibilityState={{ disabled: busy }}
                        onPress={onClose}
                        disabled={busy}
                    >
                        <Text style={styles.close}>✕</Text>
                    </Pressable>
                </View>
                {busy ? (
                    <View style={styles.bigCircle}>
                        <ActivityIndicator testID="avatar-busy" color="#FFFFFF" />
                    </View>
                ) : (
                    <AvatarCircle uri={avatarUrl} name={playerName} size={160} />
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Take new photo"
                    onPress={onTakePhoto}
                    disabled={busy}
                    style={[styles.takePhotoButton, busy && styles.takePhotoButtonDisabled]}
                >
                    <Text style={styles.takePhotoButtonText}>Take New Photo</Text>
                </Pressable>
            </View>
        </View>
    </Modal>
);

// RN port of src/components/player_game/PlayerGameHeader.js's own-avatar
// IconButton plus src/pages/PlayerGame.js's handleAvatarChange. Unlike the
// web's hidden `<input type="file" capture="user">`, this drives
// expo-image-picker's front camera directly (CameraType.front, matching
// capture="user"), then the same expo-image-manipulator resize/compress
// step Task 10 already introduced for kill photos (ChatComposer.js) — same
// MAX_DIMENSION/JPEG_QUALITY values, imported from there rather than
// redefined. The upload (storageCalls.uploadPlayerAvatar) and the player-doc
// write are both this task's own: there is no Cloud Function involved, same
// as the web — `updateDoc` is called directly against
// `dbCalls.fetchPlayerReferenceForRoom(playerName, roomID)`, which the
// existing firestore.rules clause already permits.
const AvatarButton = ({ playerName, roomID, avatarUrl, size = 40 }) => {
    const [busy, setBusy] = useState(false);
    const [isPhotoOpen, setIsPhotoOpen] = useState(false);

    const handleTakePhoto = async () => {
        try {
            // launchCameraAsync only checks whether camera permission has
            // already been granted — if it hasn't, it rejects immediately
            // without ever showing iOS's native permission dialog (confirmed
            // from expo-image-picker's own native iOS source,
            // ImagePickerModule.swift's launchCameraAsync: it guards on
            // `hasGrantedPermission` and never calls anything that prompts).
            // requestCameraPermissionsAsync is the function that actually
            // shows that dialog the first time, and safely returns the
            // already-decided status on every call after that (it never
            // re-prompts once the user has answered), so there's no need to
            // cache the result ourselves — calling it unconditionally here
            // is as cheap as checking a cached flag would be.
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert(
                    'Camera access needed',
                    'Camera access is needed to take a photo. Enable it in Settings and try again.'
                );
                return;
            }
            // allowsEditing turns on expo-image-picker's own native
            // crop/pan-zoom screen right after capture, so the player can
            // position their face within the frame before it's used —
            // bug report: "you should be able to arrange it to fit the
            // face into the circle." On iOS the crop rectangle is always
            // a square regardless of `aspect` (confirmed in
            // expo-image-picker's own type docs) — close enough to the
            // circular AvatarCircle this ends up displayed in. aspect/
            // shape are Android-only, and get it an actual circular ('oval')
            // crop overlay there.
            const result = await ImagePicker.launchCameraAsync({
                cameraType: ImagePicker.CameraType.front,
                allowsEditing: true,
                aspect: [1, 1],
                shape: 'oval',
            });
            if (result.canceled || !result.assets?.length) return;
            const asset = result.assets[0];
            setBusy(true);
            // Same portrait-aware cap as ChatComposer.js's handleCameraPress:
            // the longer side is capped, not width alone.
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
            const blob = await (await fetch(manipulated.uri)).blob();
            const uploadedUrl = await storageCalls.uploadPlayerAvatar(
                roomID,
                auth.currentUser.uid,
                blob
            );
            await updateDoc(dbCalls.fetchPlayerReferenceForRoom(playerName, roomID), {
                avatarUrl: uploadedUrl,
            });
            setIsPhotoOpen(false);
        } catch (error) {
            console.error('Could not update avatar:', error);
            Alert.alert('Could not save your photo', error.message || 'Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={avatarUrl ? 'Change my photo' : 'Add my photo'}
                onPress={() => setIsPhotoOpen(true)}
            >
                <AvatarCircle uri={avatarUrl} name={playerName} size={size} />
            </Pressable>
            <AvatarPhotoModal
                isOpen={isPhotoOpen}
                onClose={() => setIsPhotoOpen(false)}
                playerName={playerName}
                avatarUrl={avatarUrl}
                onTakePhoto={handleTakePhoto}
                busy={busy}
            />
        </>
    );
};

const styles = StyleSheet.create({
    circle: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.12)', // whiteAlpha.200-ish
        overflow: 'hidden',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    initial: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        padding: 16,
    },
    content: {
        backgroundColor: '#1A202C', // gray.800
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        gap: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        alignSelf: 'stretch',
    },
    title: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    close: {
        color: '#FFFFFF',
        fontSize: 18,
        paddingHorizontal: 8,
    },
    bigCircle: {
        width: 160,
        height: 160,
        borderRadius: 80,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
    },
    takePhotoButton: {
        backgroundColor: '#285E61', // teal.700
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    takePhotoButtonDisabled: {
        opacity: 0.5,
    },
    takePhotoButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
});

export default AvatarButton;
