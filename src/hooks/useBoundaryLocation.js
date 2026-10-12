import { useCallback, useEffect, useRef, useState } from 'react';
import { reportPlayerLocation } from '../components/reportPlayerLocation';
import { shouldSendFix, isPollDue } from '../game/locationReportCadence';

// How often the backstop timer checks whether a forced fresh poll is
// due — not the poll interval itself (MAX_FRESH_INTERVAL_MS, in
// locationReportCadence.js); just has to be frequent enough that the
// check doesn't lag noticeably behind the 15 s target.
const POLL_CHECK_INTERVAL_MS = 2000;

const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0 };

/**
 * Owns exactly one browser geolocation watch per mounted player
 * session: requests permission on demand, reports fixes/errors to the
 * server at locationReportCadence.js's cadence, forces a fresh check on
 * a watch that has gone quiet or on the page becoming visible again,
 * and tears everything down on every dependency change and on unmount.
 *
 * Does not derive the player's DISPLAYED status — PlayerGame.js does
 * that from a live subscription to the player's own boundaryStatuses
 * doc, so the display survives a reload even before this hook reports
 * anything this session. This hook only reports, plus surfaces its own
 * permission state and the latest acquired position for the map to
 * render — not the server's evaluated status.
 *
 * @param {{roomID: string, boundaryRevision: number|null, boundaryEnabled: boolean, isGameActive: boolean}} args
 *   boundaryRevision/boundaryEnabled false-ish when there is no
 *   published boundary yet — tracking simply does not start.
 */
const useBoundaryLocation = ({ roomID, boundaryRevision, boundaryEnabled, isGameActive }) => {
    const [permissionState, setPermissionState] = useState('unknown');
    const [enabled, setEnabled] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const [ownPosition, setOwnPosition] = useState(null);

    // The context this watch/poll cycle runs under, read inside the
    // position/error callbacks — which can fire well after the browser
    // call that scheduled them — so a late result for a room or
    // revision this player has since left behind is never sent.
    const contextRef = useRef({ roomID, boundaryRevision });
    useEffect(() => {
        contextRef.current = { roomID, boundaryRevision };
    }, [roomID, boundaryRevision]);

    const lastSentMsRef = useRef(null);

    // Tracks whether `enabled` was already true as of the start of the
    // current requestPermission call, read synchronously (state updates
    // are not visible until the next render) — see requestPermission's
    // own comment for why this matters.
    const enabledRef = useRef(enabled);

    const isTrackingActive = enabled && boundaryEnabled && isGameActive && Boolean(roomID);

    const sendReport = useCallback((payload) => {
        const current = contextRef.current;
        if (
            payload.roomId !== current.roomID ||
            payload.boundaryRevision !== current.boundaryRevision
        ) {
            return;
        }
        reportPlayerLocation(payload)
            .then((result) => setLastResult(result))
            .catch((err) => {
                // A rejected report (revision_conflict, this game has
                // ended, rate-limited) is not a geolocation failure and
                // must never bubble into PlayerGame's session-expiry
                // handling. The next watch/poll cycle picks up whatever
                // actually changed on its own.
                console.error('Error reporting location:', err);
            });
    }, []);

    const handlePosition = useCallback(
        (position) => {
            setPermissionState('granted');
            const nowMs = Date.now();
            setOwnPosition({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracyM: position.coords.accuracy,
                acquiredAtMs: nowMs,
            });
            if (!shouldSendFix(lastSentMsRef.current, nowMs)) return;
            lastSentMsRef.current = nowMs;
            const current = contextRef.current;
            sendReport({
                roomId: current.roomID,
                boundaryRevision: current.boundaryRevision,
                sampleMs: Math.round(position.timestamp),
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracyM: position.coords.accuracy,
            });
        },
        [sendReport]
    );

    const handlePositionError = useCallback(
        (positionError) => {
            const reason =
                positionError.code === positionError.PERMISSION_DENIED
                    ? 'permission_denied'
                    : positionError.code === positionError.TIMEOUT
                      ? 'timeout'
                      : 'unavailable';
            if (reason === 'permission_denied') setPermissionState('denied');
            const nowMs = Date.now();
            if (!shouldSendFix(lastSentMsRef.current, nowMs)) return;
            lastSentMsRef.current = nowMs;
            const current = contextRef.current;
            sendReport({
                roomId: current.roomID,
                boundaryRevision: current.boundaryRevision,
                sampleMs: nowMs,
                error: reason,
            });
        },
        [sendReport]
    );

    // The watch itself. Restarts (so it checks fresh under the new
    // context) whenever tracking turns on/off or the boundary revision
    // changes, and always tears down on unmount — "only one watch per
    // mounted player session." `roomID` is listed explicitly, not just
    // through `isTrackingActive` — that boolean only flips on
    // true/false transitions, so a room-to-room change with tracking
    // staying on the whole time would otherwise never restart the
    // watch, leaving the old room's watch running pointlessly (and
    // relying solely on sendReport's own guard, below, to swallow its
    // output forever instead of actually stopping it).
    useEffect(() => {
        if (!isTrackingActive) return undefined;
        if (!('geolocation' in navigator)) {
            setPermissionState('unavailable');
            return undefined;
        }
        const watchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            GEOLOCATION_OPTIONS
        );
        // An immediate fresh check on every (re)start — covers the very
        // first enable, a boundary revision changing while tracking is
        // already on (spec: boundary changes get "a new location
        // check"), and a room change.
        navigator.geolocation.getCurrentPosition(
            handlePosition,
            handlePositionError,
            GEOLOCATION_OPTIONS
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [isTrackingActive, roomID, boundaryRevision, handlePosition, handlePositionError]);

    // Backstop: force a fresh getCurrentPosition call if nothing has
    // been sent recently enough on its own. Gated on permissionState,
    // not just isTrackingActive: once a PERMISSION_DENIED error has
    // landed, isTrackingActive stays true (nothing resets `enabled`),
    // so without this check this timer would re-call
    // getCurrentPosition forever, re-triggering the OS/browser
    // permission prompt on a cadence the player never asked for and
    // re-sending the same permission_denied report every ~15s. Per
    // this plan's Review Focus: only an explicit requestPermission
    // (Enable Location/Retry) click may ask again.
    useEffect(() => {
        if (!isTrackingActive || permissionState === 'denied') return undefined;
        const intervalId = setInterval(() => {
            if (isPollDue(lastSentMsRef.current, Date.now())) {
                navigator.geolocation.getCurrentPosition(
                    handlePosition,
                    handlePositionError,
                    GEOLOCATION_OPTIONS
                );
            }
        }, POLL_CHECK_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isTrackingActive, permissionState, handlePosition, handlePositionError]);

    // Reacquire a fresh fix as soon as the tab becomes visible again —
    // the browser may have throttled or suspended updates while
    // hidden. Same permissionState gate as the backstop timer above,
    // and for the same reason: without it, every tab-focus after a
    // denial would re-prompt and re-report on its own.
    useEffect(() => {
        if (!isTrackingActive || permissionState === 'denied') return undefined;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                navigator.geolocation.getCurrentPosition(
                    handlePosition,
                    handlePositionError,
                    GEOLOCATION_OPTIONS
                );
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isTrackingActive, permissionState, handlePosition, handlePositionError]);

    // Enable Location / Retry. The very first call (enabled false ->
    // true) flips `isTrackingActive` on, which is enough on its own to
    // start the watch effect below — and that effect already makes its
    // own immediate getCurrentPosition check on every (re)start, so
    // this call must not duplicate it. Every call AFTER that one is a
    // no-op as far as `enabled` goes (already true), so the watch
    // effect's dependencies never change and it will not re-fire on its
    // own — a denial does not latch the watch effect out of trying
    // again, so this call makes its own direct, immediate attempt
    // instead. That direct attempt is the only path a user-initiated
    // Retry has.
    const requestPermission = useCallback(() => {
        const wasAlreadyEnabled = enabledRef.current;
        enabledRef.current = true;
        setEnabled(true);
        if (!('geolocation' in navigator)) {
            setPermissionState('unavailable');
            return;
        }
        if (wasAlreadyEnabled) {
            navigator.geolocation.getCurrentPosition(
                handlePosition,
                handlePositionError,
                GEOLOCATION_OPTIONS
            );
        }
    }, [handlePosition, handlePositionError]);

    return { permissionState, lastResult, ownPosition, requestPermission };
};

export default useBoundaryLocation;
