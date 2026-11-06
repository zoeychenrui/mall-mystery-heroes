import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
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

    const handlePress = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                cameraType: ImagePicker.CameraType.front,
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
        } catch (error) {
            console.error('Could not update avatar:', error);
            Alert.alert('Could not save your photo', error.message || 'Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={avatarUrl ? 'Change my photo' : 'Add my photo'}
            onPress={handlePress}
            disabled={busy}
        >
            {busy ? (
                <View
                    style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
                >
                    <ActivityIndicator testID="avatar-busy" color="#FFFFFF" />
                </View>
            ) : (
                <AvatarCircle uri={avatarUrl} name={playerName} size={size} />
            )}
        </Pressable>
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
});

export default AvatarButton;
