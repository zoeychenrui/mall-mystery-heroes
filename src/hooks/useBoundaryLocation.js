import { useCallback, useEffect, useRef, useState } from 'react';
import { reportPlayerLocation } from '../components/reportPlayerLocation';
import { shouldSendFix, isPollDue } from '../game/locationReportCadence';

// How often the backstop timer checks whether a forced fresh poll is
// due — not the poll interval itself (MAX_FRESH_INTERVAL_MS, in
// locationReportCadence.js); just has to be frequent enough that the
// check doesn't lag noticeably behind the 15 s target.
const POLL_CHECK_INTERVAL_MS = 2000;

const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0 };

// Only for one-shot getCurrentPosition calls — never watchPosition. A
// stationary watch given a timeout can fire repeated spurious TIMEOUT
// errors even while the player hasn't moved, which would incorrectly
// flip an actually-fine "inside" player to "unavailable". A one-shot
// call has no such risk: it either gets a fix or gives up exactly once,
// which is what lets the spec's "timeout gets an actionable message"
// path actually happen on a device that can't get a fix at all (weak
// signal, indoors) instead of hanging forever.
const ONE_SHOT_TIMEOUT_MS = 10000;
const ONE_SHOT_OPTIONS = { ...GEOLOCATION_OPTIONS, timeout: ONE_SHOT_TIMEOUT_MS };

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
 * @param {{roomID: string, boundaryRevision: number|null, boundaryEnabled: boolean, isGameActive: boolean, isAlive: boolean}} args
 *   boundaryRevision/boundaryEnabled false-ish when there is no
 *   published boundary yet — tracking simply does not start. isAlive
 *   false (the player was eliminated) stops/prevents tracking the same
 *   way — an eliminated player has no reason to keep reporting their
 *   location, and the watch effect below tears down its active watch
 *   the moment this flips, the same as any other isTrackingActive
 *   transition.
 */
const useBoundaryLocation = ({
    roomID,
    boundaryRevision,
    boundaryEnabled,
    isGameActive,
    isAlive,
}) => {
    const [permissionState, setPermissionState] = useState('unknown');
    const [enabled, setEnabled] = useState(false);
    const [lastResult, setLastResult] = useState(null);
    const [ownPosition, setOwnPosition] = useState(null);
    // Bumped on every requestPermission() call. Its value is never read —
    // it exists purely as a watch-effect dependency, so a Retry call (made
    // after `enabled` is already true, and so would otherwise change none
    // of that effect's other dependencies) still forces the effect to tear
    // down and restart. That restart matters because, per the W3C
    // Geolocation spec, a PERMISSION_DENIED error on an active
    // watchPosition call kills that watch for good — the browser will not
    // resume delivering results on it even once the user later re-grants
    // permission in browser/OS settings. Only a brand-new watchPosition
    // call can receive updates again, and this is what makes Retry start
    // one.
    const [watchEpoch, setWatchEpoch] = useState(0);

    // The context this watch/poll cycle runs under, read inside the
    // position/error callbacks — which can fire well after the browser
    // call that scheduled them — so a late result for a room or
    // revision this player has since left behind is never sent.
    const contextRef = useRef({ roomID, boundaryRevision });
    useEffect(() => {
        contextRef.current = { roomID, boundaryRevision };
    }, [roomID, boundaryRevision]);

    const lastSentMsRef = useRef(null);
    // Whether a one-shot getCurrentPosition call (requestFreshFix, below)
    // is currently pending. Without this, the backstop's 2 s-interval
    // check would fire another getCurrentPosition call on every tick for
    // as long as nothing has landed yet — including the exact "a fix will
    // never arrive" scenario (weak signal, indoors) that the timeout above
    // is meant to surface — piling up concurrent calls without bound.
    const oneShotInFlightRef = useRef(false);

    const isTrackingActive =
        enabled && boundaryEnabled && isGameActive && isAlive && Boolean(roomID);

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

    // Shared one-shot fresh-fix request, used by every "force a check now"
    // path: the watch effect's own immediate check on (re)start, the
    // backstop, and the visibility-change reacquire. Centralizing it here
    // is what lets all of them share the same timeout options and the same
    // in-flight guard (oneShotInFlightRef, above) instead of each piling up
    // their own uncoordinated calls.
    const requestFreshFix = useCallback(() => {
        if (oneShotInFlightRef.current) return;
        oneShotInFlightRef.current = true;
        navigator.geolocation.getCurrentPosition(
            (position) => {
                oneShotInFlightRef.current = false;
                handlePosition(position);
            },
            (positionError) => {
                oneShotInFlightRef.current = false;
                handlePositionError(positionError);
            },
            ONE_SHOT_OPTIONS
        );
    }, [handlePosition, handlePositionError]);

    // The watch itself. Restarts (so it checks fresh under the new
    // context) whenever tracking turns on/off, the boundary revision
    // changes, or `watchEpoch` is bumped by a Retry (see its own comment
    // above) — and always tears down on unmount — "only one watch per
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
        // Reset both throttles on every (re)start, not just the very
        // first: a stale lastSentMsRef left over from the PREVIOUS
        // context (old revision, old room) could otherwise throttle away
        // THIS restart's own immediate check below — e.g. a report went
        // out just a couple of seconds before the GM republished the
        // boundary, and without this reset shouldSendFix would see "too
        // soon" and silently drop the first fresh, revision-correct fix,
        // leaving the player stuck on wrong_revision/unavailable until
        // the next natural watch event or the ~15 s backstop. A stale
        // in-flight flag could likewise block this restart's check if the
        // previous context's one-shot call never got a chance to resolve
        // before being superseded.
        lastSentMsRef.current = null;
        oneShotInFlightRef.current = false;
        const watchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            GEOLOCATION_OPTIONS
        );
        // An immediate fresh check on every (re)start — covers the very
        // first enable, a boundary revision changing while tracking is
        // already on (spec: boundary changes get "a new location
        // check"), a room change, and a Retry after a denial (which can
        // no longer rely on a live watch to ever call back again).
        requestFreshFix();
        return () => navigator.geolocation.clearWatch(watchId);
    }, [
        isTrackingActive,
        roomID,
        boundaryRevision,
        watchEpoch,
        requestFreshFix,
        handlePosition,
        handlePositionError,
    ]);

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
                requestFreshFix();
            }
        }, POLL_CHECK_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isTrackingActive, permissionState, requestFreshFix]);

    // Reacquire a fresh fix as soon as the tab becomes visible again —
    // the browser may have throttled or suspended updates while
    // hidden. Same permissionState gate as the backstop timer above,
    // and for the same reason: without it, every tab-focus after a
    // denial would re-prompt and re-report on its own.
    useEffect(() => {
        if (!isTrackingActive || permissionState === 'denied') return undefined;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                requestFreshFix();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isTrackingActive, permissionState, requestFreshFix]);

    // Enable Location / Retry. The very first call (enabled false ->
    // true) flips `isTrackingActive` on, which is enough on its own to
    // start the watch effect above. Every call AFTER that one is a no-op
    // as far as `enabled` goes (already true), so it instead bumps
    // `watchEpoch` to force that same effect to tear down its (possibly
    // dead, post-denial) watch and start a genuinely new one — whose own
    // immediate requestFreshFix call covers what a separate direct
    // getCurrentPosition call here used to do. One restart path handles
    // both first-activation and every subsequent Retry uniformly.
    const requestPermission = useCallback(() => {
        setEnabled(true);
        if (!('geolocation' in navigator)) {
            setPermissionState('unavailable');
            return;
        }
        setWatchEpoch((epoch) => epoch + 1);
    }, []);

    return { permissionState, lastResult, ownPosition, requestPermission };
};

export default useBoundaryLocation;
