import React, { useCallback, useRef, useState } from 'react';
import { Box, Button, Text, Tooltip } from '@chakra-ui/react';
import { Map, Source, Layer, Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// require(), not a named import — gameBoundary.js is CommonJS by design
// (see BoundaryEditorModal.js for the same pattern and why).
const { shapeToPolygon } = require('../../game/gameBoundary');

// One provider, kept behind this component (docs/superpowers/specs/
// 2026-09-30-game-boundaries-design.md, "Open implementation choice").
// Nothing outside map_components/ should import 'react-map-gl' or
// 'mapbox-gl' directly.
//
// Read inside the component (not as a module-level constant): CRA's
// `.env` build-time substitution makes a module-level read equally
// valid in production, but a module-level read would freeze this value
// at first import in Jest, before a test's `beforeEach` has a chance to
// set/unset process.env.REACT_APP_MAPBOX_TOKEN for that test.
const getMapboxToken = () => process.env.REACT_APP_MAPBOX_TOKEN;

// Deliberately the older, pre-"Standard" style family (v9/v11), not the
// newer v12 ones. The v12 styles are Mapbox's 3D-globe-era "Standard"
// style, which keeps reasserting the globe projection no matter how
// often setProjection('mercator') is called at runtime — confirmed by
// hand, twice, against a real map. v9/v11 predate the globe feature
// entirely, so there is no 3D mode for them to fall back into; this
// sidesteps the problem at its source instead of fighting it at
// runtime. Mapbox still hosts and supports these for compatibility.
const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-v9';
const STANDARD_STYLE = 'mapbox://styles/mapbox/streets-v11';

// A workable default when there is no existing boundary and no fitTo —
// mid-latitude, zoomed out enough to orient from. The moderator can
// always pan/zoom manually from here (spec, "Moderator experience").
const FALLBACK_VIEW_STATE = { longitude: 0, latitude: 20, zoom: 1.5 };

// The one visual for a player's position dot, shared by the own-position
// marker and every other-players' marker so they cannot drift apart.
// `label` with no `alwaysShowLabel` shows on hover via a real rendered
// Tooltip (replacing the old native `title` attribute, which cannot be
// sped up or resized) — a short openDelay and a larger font, per the
// moderator's own request. `label` WITH `alwaysShowLabel` skips the
// tooltip entirely and renders the name permanently next to the dot,
// used only by a player's own view of other currently-exposed players
// (the spec's "few players are ever exposed at once" reasoning — no
// hover needed there).
const Dot = () => (
    <Box w="14px" h="14px" borderRadius="full" bg="#4299E1" border="2px solid white" />
);

const PositionDot = ({ label, alwaysShowLabel }) => {
    if (!label) return <Dot />;
    if (alwaysShowLabel) {
        return (
            <Box position="relative">
                <Dot />
                <Text
                    data-testid="always-visible-label"
                    position="absolute"
                    top="-20px"
                    left="50%"
                    transform="translateX(-50%)"
                    whiteSpace="nowrap"
                    fontSize="sm"
                    fontWeight="bold"
                    color="white"
                    bg="blackAlpha.700"
                    px="4px"
                    borderRadius="sm"
                >
                    {label}
                </Text>
            </Box>
        );
    }
    return (
        <Tooltip label={label} openDelay={150} fontSize="md" hasArrow>
            <Box>
                <Dot />
            </Box>
        </Tooltip>
    );
};

const toGeoJson = (vertices) => ({
    type: 'Feature',
    geometry: {
        type: 'Polygon',
        // GeoJSON coordinate order is [lng, lat] — the opposite of this
        // app's {lat, lng} everywhere else.
        coordinates: [vertices.map((point) => [point.lng, point.lat])],
    },
    properties: {},
});

/**
 * Shared map renderer: satellite/standard Mapbox layers, an optional
 * boundary overlay, and (via react-map-gl's default AttributionControl,
 * left enabled) provider attribution. No drawing tools here — but it
 * does expose `dragPan` so a caller mid-gesture (BoundaryEditorModal)
 * can stop the map from panning out from under a drawing tool, and
 * `children` so a caller can render its own react-map-gl primitives
 * (editing handles, a position marker) on top of the boundary overlay
 * without this component needing to know what they are.
 */
const GameMap = ({
    boundaryVertices,
    fitTo,
    dragPan = true,
    ownPosition,
    otherPositions = [],
    onMapLoad,
    onMapError,
    children,
}) => {
    const mapboxToken = getMapboxToken();

    let ownAccuracyGeoJson = null;
    if (ownPosition && Number.isFinite(ownPosition.accuracyM) && ownPosition.accuracyM > 0) {
        try {
            const ring = shapeToPolygon('circle', {
                center: { lat: ownPosition.lat, lng: ownPosition.lng },
                radiusMeters: ownPosition.accuracyM,
            });
            ownAccuracyGeoJson = toGeoJson(ring);
        } catch {
            ownAccuracyGeoJson = null;
        }
    }
    const [styleMode, setStyleMode] = useState('satellite');
    const [hasError, setHasError] = useState(false);
    const hasFitRef = useRef(false);

    const handleLoad = useCallback(
        (event) => {
            const map = event.target;
            // Belt-and-suspenders: SATELLITE_STYLE/STANDARD_STYLE above
            // are already pre-globe style IDs, so this should already
            // be a no-op. Left in in case a future style change
            // reintroduces a globe-capable style — cheap insurance, not
            // the actual fix.
            map.setProjection('mercator');
            map.on('style.load', () => map.setProjection('mercator'));
            if (!hasFitRef.current && boundaryVertices && boundaryVertices.length > 0) {
                const lats = boundaryVertices.map((p) => p.lat);
                const lngs = boundaryVertices.map((p) => p.lng);
                map.fitBounds(
                    [
                        [Math.min(...lngs), Math.min(...lats)],
                        [Math.max(...lngs), Math.max(...lats)],
                    ],
                    { padding: 48, duration: 0 }
                );
                hasFitRef.current = true;
            } else if (!hasFitRef.current && fitTo) {
                // {lat, lng} — this app's coordinate convention
                // everywhere else, unlike the Map's own `initialViewState`
                // below, which is react-map-gl's own {longitude, latitude}
                // shape and stays that way.
                map.jumpTo({ center: [fitTo.lng, fitTo.lat], zoom: 15 });
                hasFitRef.current = true;
            } else if (!hasFitRef.current) {
                // Nothing to fit yet (e.g. drawing a brand-new boundary) —
                // try a one-time "locate me" instead of leaving the
                // moderator stuck at the world-view fallback. Set the
                // guard immediately, before the async result comes back,
                // so a denial/timeout doesn't leave this branch able to
                // fire again on a later load event.
                hasFitRef.current = true;
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            map.jumpTo({
                                center: [position.coords.longitude, position.coords.latitude],
                                zoom: 15,
                            });
                        },
                        () => {
                            // Denied, unavailable, or timed out — stay at
                            // FALLBACK_VIEW_STATE. This is a convenience,
                            // not a requirement, so no error UI here.
                        },
                        { timeout: 10000 }
                    );
                }
            }
            if (onMapLoad) onMapLoad(map);
        },
        [boundaryVertices, fitTo, onMapLoad]
    );

    const handleError = useCallback(
        (event) => {
            // eslint-disable-next-line no-console
            console.error('GameMap: mapbox-gl error event', event?.error ?? event);
            setHasError(true);
            if (onMapError) onMapError();
        },
        [onMapError]
    );

    const handleRetry = () => {
        hasFitRef.current = false;
        setHasError(false);
    };

    if (!mapboxToken) {
        return (
            <Box
                data-testid="game-map-unconfigured"
                h="100%"
                w="100%"
                bg="gray.800"
                color="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                p="24px"
                textAlign="center"
            >
                <Text>
                    Map is not configured. Ask whoever runs this app to set REACT_APP_MAPBOX_TOKEN.
                </Text>
            </Box>
        );
    }

    if (hasError) {
        return (
            <Box
                data-testid="game-map-error"
                h="100%"
                w="100%"
                bg="gray.800"
                color="white"
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                gap="12px"
            >
                <Text>Map failed to load.</Text>
                <Button onClick={handleRetry}>Retry</Button>
            </Box>
        );
    }

    return (
        <Box h="100%" w="100%" position="relative" data-testid="game-map">
            <Map
                mapboxAccessToken={mapboxToken}
                initialViewState={FALLBACK_VIEW_STATE}
                mapStyle={styleMode === 'satellite' ? SATELLITE_STYLE : STANDARD_STYLE}
                dragPan={dragPan}
                onLoad={handleLoad}
                onError={handleError}
                reuseMaps
            >
                {boundaryVertices && boundaryVertices.length > 0 && (
                    <Source id="game-boundary" type="geojson" data={toGeoJson(boundaryVertices)}>
                        <Layer
                            id="game-boundary-fill"
                            type="fill"
                            paint={{ 'fill-color': '#38B2AC', 'fill-opacity': 0.2 }}
                        />
                        <Layer
                            id="game-boundary-line"
                            type="line"
                            paint={{ 'line-color': '#38B2AC', 'line-width': 3 }}
                        />
                    </Source>
                )}
                {ownAccuracyGeoJson && (
                    <Source id="own-position-accuracy" type="geojson" data={ownAccuracyGeoJson}>
                        <Layer
                            id="own-position-accuracy-fill"
                            type="fill"
                            paint={{ 'fill-color': '#4299E1', 'fill-opacity': 0.15 }}
                        />
                    </Source>
                )}
                {ownPosition && (
                    <Marker longitude={ownPosition.lng} latitude={ownPosition.lat}>
                        <PositionDot />
                    </Marker>
                )}
                {otherPositions.map((position) => (
                    <Marker
                        key={position.id}
                        data-testid="other-position-marker"
                        longitude={position.lng}
                        latitude={position.lat}
                    >
                        <PositionDot
                            label={position.label}
                            alwaysShowLabel={position.alwaysShowLabel}
                        />
                    </Marker>
                ))}
                {children}
            </Map>
            <Button
                position="absolute"
                top="12px"
                right="12px"
                size="sm"
                onClick={() =>
                    setStyleMode((mode) => (mode === 'satellite' ? 'standard' : 'satellite'))
                }
            >
                {styleMode === 'satellite' ? 'Standard map' : 'Satellite'}
            </Button>
        </Box>
    );
};

export default GameMap;
