import { useEffect, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

// expo-image-picker's own native crop screen (allowsEditing) can only ever
// show a square on iOS — that's a hard limitation of UIImagePickerController
// itself, not something the library's options can override. This replaces
// that step with a custom one that shows an actual circular guide, matching
// exactly how the final avatar will look (bug report: "should be a circle
// to properly visualize how profile pic will actually look").
//
// The circle's diameter in display points. Also the side length of the
// square crop this produces — the crop is always a square, just displayed
// behind a circular mask here and in AvatarCircle everywhere else.
const CONTAINER_SIZE = 280;
const MIN_SCALE = 1;
const MAX_SCALE = 3;

export const clampScale = (scale) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

// The image is displayed at "cover" size for the container (the smallest
// size that still fills a CONTAINER_SIZE square with no gaps, preserving
// the original aspect ratio), then the user's own scale/translate are
// applied on top of that. Shared by clampTranslate and computeCropRect so
// the two can never disagree about where the image actually sits.
const coverSize = (assetWidth, assetHeight) => {
    const aspectRatio = assetWidth / assetHeight;
    return aspectRatio >= 1
        ? { width: CONTAINER_SIZE * aspectRatio, height: CONTAINER_SIZE }
        : { width: CONTAINER_SIZE, height: CONTAINER_SIZE / aspectRatio };
};

// Keeps the image covering the whole circle at every scale — past this,
// panning would reveal empty space outside the photo instead of more of it.
export const clampTranslate = ({ assetWidth, assetHeight, scale, translateX, translateY }) => {
    const { width, height } = coverSize(assetWidth, assetHeight);
    const maxOffsetX = Math.max(0, (width * scale - CONTAINER_SIZE) / 2);
    const maxOffsetY = Math.max(0, (height * scale - CONTAINER_SIZE) / 2);
    // `+ 0` normalizes a -0 result (e.g. clamping -30 against a 0 bound)
    // to plain 0 — no visual difference either way, but it keeps this
    // function's output comparable with === / toEqual.
    return {
        x: Math.max(-maxOffsetX, Math.min(maxOffsetX, translateX)) + 0,
        y: Math.max(-maxOffsetY, Math.min(maxOffsetY, translateY)) + 0,
    };
};

// Converts the on-screen pan/zoom state into a square crop rectangle in
// the original photo's own pixel coordinates, for
// expo-image-manipulator's `crop` action. A pure function — exercised
// directly in AvatarCropModal.test.js, since simulating real two-finger
// pinch gestures through PanResponder in a component test is far more
// fragile than testing the math it feeds on its own.
export const computeCropRect = ({ assetWidth, assetHeight, scale, translateX, translateY }) => {
    const { width: coverWidth } = coverSize(assetWidth, assetHeight);
    // Pixels of the original photo per on-screen point, at scale 1 — the
    // same ratio whichever axis it's derived from, since coverSize
    // preserves the original aspect ratio exactly.
    const pixelsPerPoint = assetWidth / coverWidth;

    // Where the visible CONTAINER_SIZE square falls within the scaled
    // image, in that scaled image's own top-left-origin coordinates.
    const { width: baseWidth, height: baseHeight } = coverSize(assetWidth, assetHeight);
    const visibleLeft = (baseWidth * scale) / 2 - CONTAINER_SIZE / 2 - translateX;
    const visibleTop = (baseHeight * scale) / 2 - CONTAINER_SIZE / 2 - translateY;

    // Back out to scale-1 ("cover-space") coordinates, then to the
    // original photo's own pixel space.
    const originX = (visibleLeft / scale) * pixelsPerPoint;
    const originY = (visibleTop / scale) * pixelsPerPoint;
    const size = (CONTAINER_SIZE / scale) * pixelsPerPoint;

    return {
        // Clamped defensively against floating-point rounding only —
        // clampTranslate already keeps the real gesture in bounds.
        originX: Math.round(Math.max(0, Math.min(assetWidth - size, originX))),
        originY: Math.round(Math.max(0, Math.min(assetHeight - size, originY))),
        width: Math.round(size),
        height: Math.round(size),
    };
};

// `asset` is the just-captured { uri, width, height } from
// launchCameraAsync, or null while nothing is pending. onUsePhoto receives
// the computed crop rect; onRetake re-opens the camera for a new capture;
// onCancel abandons this capture and returns to the caller's own preview
// (AvatarButton.js's "Your Photo" modal), without retaking.
const AvatarCropModal = ({ asset, onUsePhoto, onRetake, onCancel }) => {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    // Snapshot of where a gesture started, read inside onPanResponderMove
    // (which only ever sees stale closures over scale/translate state from
    // render time) rather than relying on that state directly for the
    // running delta.
    const gestureStart = useRef({ translate: { x: 0, y: 0 }, scale: 1, pinchDistance: null });

    // A fresh capture (Retake) should always start centered and
    // unzoomed, not wherever the previous one was left.
    useEffect(() => {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
    }, [asset?.uri]);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                gestureStart.current = { translate, scale, pinchDistance: null };
            },
            onPanResponderMove: (evt, gestureState) => {
                if (!asset) return;
                const { touches } = evt.nativeEvent;
                if (touches.length >= 2) {
                    const [first, second] = touches;
                    const distance = Math.hypot(
                        first.pageX - second.pageX,
                        first.pageY - second.pageY
                    );
                    if (gestureStart.current.pinchDistance == null) {
                        // First move of a new two-finger gesture — record
                        // the starting distance/scale, don't jump yet.
                        gestureStart.current.pinchDistance = distance;
                        gestureStart.current.scale = scale;
                        return;
                    }
                    const nextScale = clampScale(
                        gestureStart.current.scale *
                            (distance / gestureStart.current.pinchDistance)
                    );
                    setScale(nextScale);
                    setTranslate((current) =>
                        clampTranslate({
                            assetWidth: asset.width,
                            assetHeight: asset.height,
                            scale: nextScale,
                            translateX: current.x,
                            translateY: current.y,
                        })
                    );
                } else {
                    setTranslate(
                        clampTranslate({
                            assetWidth: asset.width,
                            assetHeight: asset.height,
                            scale,
                            translateX: gestureStart.current.translate.x + gestureState.dx,
                            translateY: gestureStart.current.translate.y + gestureState.dy,
                        })
                    );
                }
            },
        })
    ).current;

    if (!asset) return null;

    const { width: imageWidth, height: imageHeight } = coverSize(asset.width, asset.height);

    const handleUsePhoto = () => {
        onUsePhoto(
            computeCropRect({
                assetWidth: asset.width,
                assetHeight: asset.height,
                scale,
                translateX: translate.x,
                translateY: translate.y,
            })
        );
    };

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.overlay}>
                <View style={styles.content}>
                    <Text style={styles.title}>Adjust Photo</Text>
                    <View style={styles.cropFrame} {...panResponder.panHandlers}>
                        <Image
                            testID="crop-image"
                            source={{ uri: asset.uri }}
                            style={{
                                width: imageWidth,
                                height: imageHeight,
                                transform: [
                                    { translateX: translate.x },
                                    { translateY: translate.y },
                                    { scale },
                                ],
                            }}
                        />
                    </View>
                    <Text style={styles.hint}>Drag to move, pinch to zoom</Text>
                    <View style={styles.actionsRow}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retake photo"
                            onPress={onRetake}
                            style={styles.secondaryButton}
                        >
                            <Text style={styles.secondaryButtonText}>Retake</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Use photo"
                            onPress={handleUsePhoto}
                            style={styles.primaryButton}
                        >
                            <Text style={styles.primaryButtonText}>Use Photo</Text>
                        </Pressable>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel adjusting photo"
                        onPress={onCancel}
                    >
                        <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    content: {
        backgroundColor: '#1A202C', // gray.800
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        gap: 12,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    cropFrame: {
        width: CONTAINER_SIZE,
        height: CONTAINER_SIZE,
        borderRadius: CONTAINER_SIZE / 2,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    hint: {
        color: '#A0AEC0', // gray.400
        fontSize: 13,
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 4,
    },
    secondaryButton: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#A0AEC0',
    },
    secondaryButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    primaryButton: {
        backgroundColor: '#285E61', // teal.700
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    cancelText: {
        color: '#A0AEC0', // gray.400
        marginTop: 4,
    },
});

export default AvatarCropModal;
