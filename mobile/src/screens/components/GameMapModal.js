import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';

// RN port of the web's read-only player map: src/components/map_components/
// {GameMap.js, PlayerMapModal.js}. Despite the filename, this is now one
// of GameScreen's five swipeable pages (the Clash-Royale-style redesign),
// not a popup: GameScreen renders it directly as a PagerView page. Shows
// the published game area, this player's own position, and every other
// currently-exposed ("outside") player, with a Recenter on Me control.
// Purely presentational — every prop (boundaryVertices, ownPosition,
// otherPositions, statusText) is handed down from GameScreen.js, which
// owns the Firestore subscriptions and the location hook (Task 11).
// Swiping away from this page does not touch location tracking — that
// keeps running at the GameScreen level regardless of which page is
// showing (same "closing the map doesn't stop reporting" rule as the
// web's PlayerMapModal/useBoundaryLocation split).
//
// No top-inset handling here, unlike when this was its own full-screen
// Modal: a Modal renders in a separate native window that bypasses
// whatever SafeAreaView wraps the rest of the app, which is what put the
// header under the status bar before. As a plain page inside GameScreen's
// own SafeAreaView now, it gets that handling for free, the same as the
// Shop/Missions/Leaderboard pages beside it.
//
// `statusText` is GameScreen's boundaryDisplay.mapStatusText, passed
// straight through so the player sees the same words here as in Task 11's
// LocationStatusPanel — this page is full-screen, which would otherwise
// hide the panel's status line entirely for as long as it's showing.
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
    // Whether this is the currently showing page — GameScreen passes
    // `activePage === PAGE_MAP`. This page stays mounted continuously
    // (PagerView keeps every page mounted), so without this, "auto-center
    // when a fresh position arrives" below would also fire while the
    // player is looking at a completely different tab.
    isActive = false,
    // Previously this page's own tab/entry-point just didn't exist unless
    // the host had zones enabled. Now that it's a fixed tab always
    // reachable (the Clash-Royale-style redesign has no conditionally
    // hidden tabs), an explicit message here stands in for that instead of
    // showing an interactive but permanently empty map.
    zonesEnabled = true,
    boundaryVertices = [],
    ownPosition,
    otherPositions = [],
    statusText,
}) => {
    const mapRef = useRef(null);

    const handleRecenter = () => {
        if (!mapRef.current || !ownPosition) return;
        mapRef.current.animateToRegion({
            latitude: ownPosition.lat,
            longitude: ownPosition.lng,
            ...RECENTER_DELTA,
        });
    };

    // Auto-center once, the moment a fresh position becomes available
    // while this page is the one showing — otherwise the map opens on
    // MapView's bare default region (center of nowhere) until the player
    // notices and taps Recenter themselves. Runs again any time
    // ownPosition's identity changes (e.g. this page was opened before a
    // fix existed, then one arrives).
    useEffect(() => {
        if (isActive) handleRecenter();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, ownPosition]);

    const polygonCoordinates = boundaryVertices.map((point) => ({
        latitude: point.lat,
        longitude: point.lng,
    }));

    if (!zonesEnabled) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>Game Area</Text>
                </View>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>
                        Zones aren&apos;t enabled for this game.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Game Area</Text>
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
    );
};

// Colors are the Chakra tokens the web's PlayerMapModal/GameMap use,
// resolved to hex — same palette as GameScreen.js and LocationStatusPanel.js.
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#202030',
    },
    header: {
        padding: 16,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: 'bold',
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
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    emptyStateText: {
        color: '#A0AEC0', // gray.400
        textAlign: 'center',
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
