import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// RN port of the web's read-only player map: src/components/map_components/
// {GameMap.js, PlayerMapModal.js}. Shows the published game area, this
// player's own position, and every other currently-exposed ("outside")
// player, with a Recenter on Me control. Purely presentational — every
// prop (boundaryVertices, ownPosition, otherPositions, statusText) is
// handed down from GameScreen.js, which owns the Firestore subscriptions
// and the location hook (Task 11). Closing this modal does not touch
// location tracking — that keeps running at the GameScreen level exactly
// as it did before the map existed (same "closing the map doesn't stop
// reporting" rule as the web's PlayerMapModal/useBoundaryLocation split).
//
// `statusText` is GameScreen's boundaryDisplay.mapStatusText, passed
// straight through so the player sees the same words here as in Task 11's
// LocationStatusPanel — this modal is full-screen, which would otherwise
// hide the panel's status line entirely for as long as the map stays open.
//
// Coordinate order: RN Maps' Polygon/Marker both take {latitude,
// longitude} objects directly. No GeoJSON [lng, lat] flip is needed here
// (unlike the web's toGeoJson helper) since this never produces GeoJSON.
//
// A fixed, reasonably tight zoom for Recenter — this app has no "fit to
// the whole boundary" need inside the modal (the player only ever cares
// about their own position relative to it), unlike the moderator's
// boundary editor.
const RECENTER_DELTA = { latitudeDelta: 0.006, longitudeDelta: 0.006 };

// The one visual for a player's position dot, shared by the own-position
// marker and every other-player marker so they can't drift apart. Always
// shows its label right next to the dot (no tooltip/hover concept on a
// touch device) — matching the web's alwaysShowLabel marker style, the
// only style this app's player-facing map ever uses (src/components/
// map_components/GameMap.js's Dot/PositionDot).
const PositionDot = ({ label }) => (
    <View style={styles.dotWrap}>
        <View style={styles.dot} />
        {label && (
            <Text testID="always-visible-label" style={styles.dotLabel} numberOfLines={1}>
                {label}
            </Text>
        )}
    </View>
);

const GameMapModal = ({
    isOpen,
    onClose,
    boundaryVertices = [],
    ownPosition,
    otherPositions = [],
    statusText,
}) => {
    const mapRef = useRef(null);
    const insets = useSafeAreaInsets();

    const handleRecenter = () => {
        if (!mapRef.current || !ownPosition) return;
        mapRef.current.animateToRegion({
            latitude: ownPosition.lat,
            longitude: ownPosition.lng,
            ...RECENTER_DELTA,
        });
    };

    // Auto-center once, the moment a fresh position becomes available
    // while the map is open — otherwise the map opens on MapView's bare
    // default region (center of nowhere) until the player notices and
    // taps Recenter themselves. Runs again any time ownPosition's
    // identity changes (e.g. the map was opened before a fix existed,
    // then one arrives), not on every position update, so it never fights
    // a player who has since panned away.
    useEffect(() => {
        if (isOpen) handleRecenter();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ownPosition]);

    // Nothing to render, nothing to mount, while closed — keeps a native
    // MapView from sitting mounted off-screen between opens.
    if (!isOpen) return null;

    const polygonCoordinates = boundaryVertices.map((point) => ({
        latitude: point.lat,
        longitude: point.lng,
    }));

    return (
        <Modal visible={isOpen} onRequestClose={onClose} animationType="slide">
            <View style={styles.container}>
                {/* Unlike a screen reached through React Navigation, this
                    Modal is not `transparent` — it renders genuinely
                    full-screen, over the status bar/notch, so nothing here
                    gets safe-area handling for free. Only the header needs
                    it (that's what overlapped the status bar/clock on a
                    real device); the map below is fine bleeding to the
                    screen edges, so only the header gets the top inset as
                    padding. `useSafeAreaInsets()` is used here rather than
                    the `SafeAreaView` component — the component remeasures
                    its own native window on mount, which this Modal's
                    separate native window did unreliably right after the
                    OS's location-permission prompt had just been shown and
                    dismissed; the hook reads the already-correct value
                    from the stable SafeAreaProvider context instead. */}
                <View
                    testID="map-header-safe-area"
                    style={[styles.headerSafeArea, { paddingTop: insets.top }]}
                >
                    <View style={styles.header}>
                        <Text style={styles.title}>Game Area</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Close modal"
                            onPress={onClose}
                            style={styles.closeButton}
                        >
                            <Text style={styles.closeText}>✕</Text>
                        </Pressable>
                    </View>
                </View>
                {statusText && (
                    <View style={styles.statusBanner}>
                        <Text style={styles.statusText}>{statusText}</Text>
                    </View>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Recenter on Me"
                    accessibilityState={{ disabled: !ownPosition }}
                    disabled={!ownPosition}
                    onPress={handleRecenter}
                    style={[styles.recenterButton, !ownPosition && styles.recenterButtonDisabled]}
                >
                    <Text style={styles.recenterText}>Recenter on Me</Text>
                </Pressable>
                <MapView ref={mapRef} style={styles.map} testID="game-map-view">
                    {polygonCoordinates.length > 0 && (
                        <Polygon
                            testID="boundary-polygon"
                            coordinates={polygonCoordinates}
                            fillColor="rgba(56, 178, 172, 0.2)"
                            strokeColor="#38B2AC"
                            strokeWidth={3}
                        />
                    )}
                    {ownPosition && (
                        <Marker
                            testID="own-position-marker"
                            coordinate={{ latitude: ownPosition.lat, longitude: ownPosition.lng }}
                        >
                            <PositionDot />
                        </Marker>
                    )}
                    {otherPositions.map((position) => (
                        <Marker
                            key={position.id}
                            testID="other-position-marker"
                            coordinate={{ latitude: position.lat, longitude: position.lng }}
                        >
                            <PositionDot label={position.label} />
                        </Marker>
                    ))}
                </MapView>
            </View>
        </Modal>
    );
};

// Colors are the Chakra tokens the web's PlayerMapModal/GameMap use,
// resolved to hex — same palette as GameScreen.js and LocationStatusPanel.js.
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#202030',
    },
    headerSafeArea: {
        backgroundColor: '#202030',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: 'bold',
    },
    closeButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    closeText: {
        color: '#FFFFFF',
        fontSize: 18,
    },
    statusBanner: {
        backgroundColor: '#2D3748', // gray.700
        borderRadius: 6,
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 8,
    },
    statusText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    recenterButton: {
        alignSelf: 'flex-start',
        backgroundColor: '#EDF2F7', // gray.100
        borderRadius: 6,
        marginHorizontal: 16,
        marginBottom: 8,
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    recenterButtonDisabled: {
        opacity: 0.5,
    },
    recenterText: {
        color: '#1A202C', // gray.800
        fontWeight: '600',
        fontSize: 14,
    },
    map: {
        flex: 1,
    },
    dotWrap: {
        alignItems: 'center',
    },
    dot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#4299E1',
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    dotLabel: {
        position: 'absolute',
        top: -20,
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: 13,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 4,
        borderRadius: 2,
    },
});

export default GameMapModal;
