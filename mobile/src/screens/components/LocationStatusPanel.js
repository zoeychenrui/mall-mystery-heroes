import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GAME_BOUNDARY_CONFIG } from '../../../../src/game/gameBoundary';
import { formatMessageTime } from '../../../../src/utils/formatMessageTime';

// The RN port of the web's location status UI: the rendering in
// src/components/player_game/PlayerBoundaryPanel.js, plus the display
// derivation that src/pages/PlayerGame.js does right before rendering it
// (the constants below and deriveBoundaryDisplay). Kept together here so
// GameScreen stays thin — it derives liveBoundaryStatus, calls
// deriveBoundaryDisplay once, and hands the result to both this panel and
// (Task 12) the map's status line, so both always show the same words.

// Plain-language text for every reason deriveFreshStatus/gameBoundary.js
// and the reportPlayerLocation callable can produce for an `unavailable`
// status — verbatim from src/pages/PlayerGame.js. wrong_revision/wrong_uid
// are internal consistency reasons, so both fold into the same generic
// "still checking" message; invalid_fix/poor_accuracy are classifyFix
// reasons that can arrive via the stored status doc's own `reason`.
export const UNAVAILABLE_REASON_TEXT = {
    stale: 'No recent location reading.',
    no_fix: 'No location reading yet.',
    wrong_revision: 'Still checking against the updated game area.',
    wrong_uid: 'Still checking against the updated game area.',
    permission_denied: 'Location permission was denied.',
    timeout: 'Could not get a location fix in time.',
    unavailable: 'Location services are unavailable on this device.',
    invalid_fix: 'Location services are unavailable on this device.',
    poor_accuracy: 'Location accuracy is too low right now.',
    clock_skew: "This device's clock looks out of sync — check it and retry.",
};
export const DEFAULT_UNAVAILABLE_TEXT = 'Checking your location status.';
// Reasons worth offering Retry for in the unavailable box — the ones a fresh
// attempt could plausibly fix. permission_denied already gets its own Retry
// via the permissionState === 'denied' box, so it is left out here to avoid
// a second, redundant button.
export const UNAVAILABLE_RETRY_REASONS = new Set(['timeout', 'unavailable']);

const STATUS_TEXT = {
    inside: 'In game area.',
    near: 'You are near the edge of the game area; check the map.',
    outside:
        'You are outside the game area — your location is visible to everyone until you return.',
    unavailable: null, // handled separately — needs its own explanation/Retry
};

/**
 * Everything the panel and the map's status line show, derived from the
 * player's live status, their stored status doc, and the local clock — the
 * same render-time computation as src/pages/PlayerGame.js, not stored state.
 *
 * @param {{liveBoundaryStatus: {status: string, reason: string|null}, boundaryStatusDoc: object|null, nowMs: number}} args
 */
export const deriveBoundaryDisplay = ({ liveBoundaryStatus, boundaryStatusDoc, nowMs }) => {
    // The countdown to exposure, from fields already on the player's own
    // status doc: `near` plus a recorded outsideSince means an outside run
    // has started but the server hasn't confirmed `outside` yet.
    const outsideSinceMs = boundaryStatusDoc?.outsideSince?.toMillis?.() ?? null;
    const isApproachingExposure = liveBoundaryStatus.status === 'near' && outsideSinceMs !== null;
    const secondsUntilExposed = isApproachingExposure
        ? Math.max(
              0,
              Math.ceil((GAME_BOUNDARY_CONFIG.confirmMinSpanMs - (nowMs - outsideSinceMs)) / 1000)
          )
        : null;

    // null (not '') when there has never been a successful check, so the
    // render can tell "no time to show" apart from "time formatted as empty".
    const lastCheckTime =
        liveBoundaryStatus.status === 'unavailable'
            ? formatMessageTime(boundaryStatusDoc?.lastUsableReceivedAt ?? null)
            : null;

    const statusText = STATUS_TEXT[liveBoundaryStatus.status];

    // deriveFreshStatus checks staleness first, so a player with no recent
    // usable fix always gets 'stale' even when the stored doc carries a
    // truer, more specific reason from an error report — prefer that one.
    const unavailableReason =
        liveBoundaryStatus.status === 'unavailable'
            ? liveBoundaryStatus.reason === 'stale' && boundaryStatusDoc?.reason
                ? boundaryStatusDoc.reason
                : (liveBoundaryStatus.reason ?? 'no_fix')
            : null;
    const unavailableText = unavailableReason
        ? (UNAVAILABLE_REASON_TEXT[unavailableReason] ?? DEFAULT_UNAVAILABLE_TEXT)
        : null;
    const showUnavailableRetry = UNAVAILABLE_RETRY_REASONS.has(unavailableReason);

    // The same words on the page and inside the map, independent of whether
    // the page itself is currently showing them (e.g. suppressed while
    // permissionState is still 'unknown').
    const mapStatusText =
        liveBoundaryStatus.status === 'unavailable'
            ? `Location unavailable: ${unavailableText}`
            : statusText;

    return {
        isApproachingExposure,
        secondsUntilExposed,
        statusText,
        unavailableText,
        lastCheckTime,
        showUnavailableRetry,
        mapStatusText,
    };
};

const SmallButton = ({ label, onPress }) => (
    <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
        <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
);

const LocationStatusPanel = ({
    enabled,
    isAlive,
    permissionState,
    requestPermission,
    liveBoundaryStatus,
    isApproachingExposure,
    secondsUntilExposed,
    statusText,
    unavailableText,
    lastCheckTime,
    showUnavailableRetry,
}) => {
    const [isInsideStatusDismissed, setIsInsideStatusDismissed] = useState(false);

    // A dismissed "In game area." banner stays hidden until the status
    // actually leaves `inside` — a fresh inside snapshot doesn't bring it back.
    useEffect(() => {
        if (liveBoundaryStatus.status !== 'inside') {
            setIsInsideStatusDismissed(false);
        }
    }, [liveBoundaryStatus.status]);

    if (!enabled || isAlive === false) return null;

    const showGreenStatus =
        liveBoundaryStatus.status !== 'outside' &&
        liveBoundaryStatus.status !== 'unavailable' &&
        !isApproachingExposure;

    return (
        <View style={styles.panel} pointerEvents="box-none">
            {permissionState === 'unknown' && (
                <View style={[styles.box, styles.prompt]}>
                    <Text style={[styles.text, styles.textWithButton]}>
                        Turn on location so we can check that you are inside the game area. The
                        moderator sees your boundary status. Other players cannot see your location
                        unless you leave the game area. Keep the game open for location updates.
                    </Text>
                    <SmallButton label="Enable Location" onPress={requestPermission} />
                </View>
            )}
            {permissionState === 'denied' && (
                <View style={[styles.box, styles.warning]}>
                    <Text style={[styles.text, styles.textWithButton]}>
                        Location permission was denied. Enable it in your browser or device
                        settings, then retry.
                    </Text>
                    <SmallButton label="Retry" onPress={requestPermission} />
                </View>
            )}
            {permissionState === 'unavailable' && (
                <View style={[styles.box, styles.warning]}>
                    <Text style={styles.text}>
                        Location services are unavailable on this device.
                    </Text>
                </View>
            )}
            {isApproachingExposure && (
                <View style={[styles.compactBox, styles.approaching]}>
                    <Text style={[styles.text, styles.bold, styles.centered]}>
                        {`Return to the game area — your location will be revealed to everyone in ${secondsUntilExposed}s.`}
                    </Text>
                </View>
            )}
            {liveBoundaryStatus.status === 'outside' && (
                <View style={[styles.compactBox, styles.outside]}>
                    <Text style={[styles.text, styles.bold, styles.centered]}>{statusText}</Text>
                </View>
            )}
            {showGreenStatus &&
                (liveBoundaryStatus.status === 'inside' ? (
                    !isInsideStatusDismissed && (
                        <View style={[styles.statusCard, styles.insideRow]}>
                            <Text style={[styles.text, styles.flexText]}>{statusText}</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Dismiss location status"
                                hitSlop={8}
                                onPress={() => setIsInsideStatusDismissed(true)}
                                style={styles.dismissButton}
                            >
                                <Text style={styles.dismissText}>✕</Text>
                            </Pressable>
                        </View>
                    )
                ) : (
                    <View style={styles.statusCard}>
                        <Text style={styles.text}>{statusText}</Text>
                    </View>
                ))}
            {permissionState !== 'unknown' && liveBoundaryStatus.status === 'unavailable' && (
                <View style={[styles.box, styles.warning]}>
                    <Text style={[styles.text, showUnavailableRetry && styles.textWithButton]}>
                        {`Location unavailable: ${unavailableText}${
                            lastCheckTime ? ` Last confirmed at ${lastCheckTime}.` : ''
                        }`}
                    </Text>
                    {showUnavailableRetry && (
                        <SmallButton label="Retry" onPress={requestPermission} />
                    )}
                </View>
            )}
        </View>
    );
};

// Colors are the Chakra tokens PlayerBoundaryPanel.js uses, resolved to hex.
const styles = StyleSheet.create({
    // Overlays the top of the chat area, like the web's absolutely
    // positioned Box (top 2, left/right 2, maxH 50%, zIndex 2).
    panel: {
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        maxHeight: '50%',
        zIndex: 2,
    },
    box: {
        borderRadius: 6,
        padding: 12,
        marginBottom: 8,
    },
    compactBox: {
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
    },
    prompt: {
        backgroundColor: '#1A365D', // blue.900
    },
    warning: {
        backgroundColor: '#7B341E', // orange.800
    },
    approaching: {
        backgroundColor: '#9C4221', // orange.700
    },
    outside: {
        backgroundColor: '#63171B', // red.900
    },
    statusCard: {
        backgroundColor: '#22543D', // green.800
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        shadowColor: '#000000',
        shadowOpacity: 0.3,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    insideRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        color: '#FFFFFF',
    },
    textWithButton: {
        marginBottom: 8,
    },
    bold: {
        fontWeight: 'bold',
    },
    centered: {
        textAlign: 'center',
    },
    flexText: {
        flex: 1,
    },
    button: {
        alignSelf: 'flex-start',
        backgroundColor: '#EDF2F7', // gray.100, Chakra's default solid button
        borderRadius: 6,
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    buttonPressed: {
        backgroundColor: '#E2E8F0', // gray.200
    },
    buttonText: {
        color: '#1A202C', // gray.800
        fontWeight: '600',
        fontSize: 14,
    },
    dismissButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    dismissText: {
        color: '#FFFFFF',
        fontSize: 14,
    },
});

export default LocationStatusPanel;
