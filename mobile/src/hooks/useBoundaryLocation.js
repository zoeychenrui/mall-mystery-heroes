import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as callables from '../firebase/callables';
import { shouldSendFix, isPollDue } from '../../../src/game/locationReportCadence';

// The expo-location port of the web's src/hooks/useBoundaryLocation.js.
// Same structure, same state, same cadence (shared locationReportCadence.js),
// same gates — only the platform calls differ. The differences that matter:
//
// - Permission is its own call here. The browser asks implicitly the first
//   time watchPosition/getCurrentPosition runs and reports a refusal as a
//   PERMISSION_DENIED error on that call; expo-location instead has an
//   explicit requestForegroundPermissionsAsync (prompts) and
//   getForegroundPermissionsAsync (just reads the current answer, never
//   prompts). Only requestPermission (Enable Location / Retry) ever calls the
//   prompting one — every automatic path (watch restarts, backstop,
//   foreground) uses the non-prompting read, keeping the web's rule that
//   only an explicit tap may ask again.
// - expo-location errors carry no portable PERMISSION_DENIED/TIMEOUT code
//   (the native exception codes differ between iOS and Android), so a
//   failed watch/one-shot is classified by re-reading the permission: not
//   granted -> 'permission_denied', granted -> 'unavailable' (location
//   services off, no provider). 'timeout' comes from this hook's own
//   timeout race below, since getCurrentPositionAsync has none.
// - The tab-visibility reacquire becomes an AppState 'change' -> 'active'
//   listener (phone unlocked / app brought back).

// How often the backstop timer checks whether a forced fresh poll is due —
// not the poll interval itself (MAX_FRESH_INTERVAL_MS, in
// locationReportCadence.js).
const POLL_CHECK_INTERVAL_MS = 2000;

// timeInterval/distanceInterval 0: deliver every update the OS produces,
// the equivalent of the browser's maximumAge: 0 watch. Throttling outgoing
// reports is shouldSendFix's job, not the watch's.
const WATCH_OPTIONS = {
    accuracy: Location.Accuracy.High,
    timeInterval: 0,
    distanceInterval: 0,
};

// Only for one-shot getCurrentPositionAsync calls, never the watch — same
// reasoning as the web: a stationary watch given a timeout could fire
// spurious timeouts while the player simply hasn't moved, but a one-shot
// call either gets a fix or gives up exactly once, which is what lets a
// device that can't get a fix at all (weak signal, indoors) surface the
// actionable "timeout" message instead of hanging forever.
// getCurrentPositionAsync has no timeout option of its own, so this hook
// races it against a timer.
const ONE_SHOT_TIMEOUT_MS = 10000;
const ONE_SHOT_OPTIONS = { accuracy: Location.Accuracy.High };
const ONE_SHOT_TIMED_OUT = Symbol('one-shot timed out');

// The current OS answer without prompting, or null if even reading it failed.
const readPermissionStatus = async () => {
    try {
        const response = await Location.getForegroundPermissionsAsync();
        return response?.status ?? null;
    } catch (err) {
        console.error('Error reading location permission:', err);
        return null;
    }
};

// Why a location call failed, from the permission read above: anything but
// a definite "not granted" (granted, or unreadable) means the permission is
// not the problem.
const reasonForPermissionStatus = (status) =>
    status === 'granted' || status === null ? 'unavailable' : 'permission_denied';

/**
 * Owns exactly one expo-location watch per mounted player session:
 * requests permission on demand, reports fixes/errors to the server at
 * locationReportCadence.js's cadence, forces a fresh check on a watch that
 * has gone quiet or on the app returning to the foreground, and tears
 * everything down on every dependency change and on unmount.
 *
 * Does not derive the player's DISPLAYED status — GameScreen.js does that
 * from a live subscription to the player's own boundaryStatuses doc, same as
 * the web's PlayerGame.js. This hook only ever writes (via
 * callables.reportPlayerLocation), plus surfaces its own permission state
 * and the latest acquired position for the map.
 *
 * @param {{roomID: string, boundaryRevision: number|null, boundaryEnabled: boolean, isGameActive: boolean, isAlive: boolean}} args
 * @returns {{permissionState: 'unknown'|'granted'|'denied'|'unavailable', ownPosition: {lat: number, lng: number, accuracyM: number, acquiredAtMs: number}|null, requestPermission: () => Promise<void>}}
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
    const [ownPosition, setOwnPosition] = useState(null);
    // Bumped on every successful requestPermission() call (and on a
    // foreground return that finds permission re-granted). Its value is never
    // read — it exists purely as a watch-effect dependency, so a Retry made
    // after `enabled` is already true still tears the watch down and starts
    // a brand-new one. The web needs this because a PERMISSION_DENIED kills
    // a browser watch for good; expo-location's exact semantic after a
    // revoke/re-grant isn't guaranteed either way across iOS/Android, so a
    // fresh watch is the only safe assumption here too.
    const [watchEpoch, setWatchEpoch] = useState(0);

    // The context this watch/poll cycle runs under, read inside callbacks
    // that can fire well after the call that scheduled them, so a late
    // result for a room or revision this player has since left is never sent.
    const contextRef = useRef({ roomID, boundaryRevision });
    useEffect(() => {
        contextRef.current = { roomID, boundaryRevision };
    }, [roomID, boundaryRevision]);

    const lastSentMsRef = useRef(null);
    // Whether a one-shot call (requestFreshFix) is pending, so the backstop's
    // 2 s ticks and foreground events never pile up concurrent calls while a
    // fix is still on its way (or never coming).
    const oneShotInFlightRef = useRef(false);
    // Identifies the one-shot call that currently owns oneShotInFlightRef.
    // The watch effect clears it on every teardown, so a one-shot started
    // under a superseded watch (old room/revision, eliminated, unmounted)
    // that lands late is ignored outright — it neither reports nor clears
    // the in-flight flag of the newer call that replaced it.
    const oneShotTokenRef = useRef(null);
    // The pending one-shot's timeout timer, cleared on every watch teardown
    // so a superseded call's timer doesn't linger for up to 10 s after
    // unmount (its result would be ignored via the token anyway).
    const oneShotTimeoutRef = useRef(null);

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
        callables.reportPlayerLocation(payload).catch((err) => {
            // A rejected report (revision_conflict, game ended, rate-limited)
            // is not a location failure and must never bubble into
            // GameScreen's session-expiry handling. The next watch/poll
            // cycle picks up whatever actually changed on its own.
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

    // reason: 'permission_denied' | 'timeout' | 'unavailable' — the same
    // three error values the reportPlayerLocation callable accepts.
    const handlePositionError = useCallback(
        (reason) => {
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

    // A failed watch/one-shot: see the header comment for why the reason is
    // read back from the permission state rather than the error itself.
    const handleLocationFailure = useCallback(
        async (err) => {
            const status = await readPermissionStatus();
            const reason = reasonForPermissionStatus(status);
            if (reason !== 'permission_denied') {
                console.error('Error getting location:', err);
            }
            handlePositionError(reason);
        },
        [handlePositionError]
    );

    // Shared one-shot fresh-fix request, used by every "force a check now"
    // path: the watch effect's own immediate check on (re)start, the
    // backstop, and the foreground reacquire — so all of them share the same
    // timeout and the same in-flight guard.
    const requestFreshFix = useCallback(() => {
        if (oneShotInFlightRef.current) return;
        oneShotInFlightRef.current = true;
        const token = {};
        oneShotTokenRef.current = token;

        let timeoutId;
        const timeout = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => reject(ONE_SHOT_TIMED_OUT), ONE_SHOT_TIMEOUT_MS);
        });
        oneShotTimeoutRef.current = timeoutId;
        Promise.race([Location.getCurrentPositionAsync(ONE_SHOT_OPTIONS), timeout]).then(
            (position) => {
                clearTimeout(timeoutId);
                if (oneShotTokenRef.current !== token) return;
                oneShotInFlightRef.current = false;
                handlePosition(position);
            },
            (err) => {
                clearTimeout(timeoutId);
                if (oneShotTokenRef.current !== token) return;
                oneShotInFlightRef.current = false;
                if (err === ONE_SHOT_TIMED_OUT) {
                    handlePositionError('timeout');
                } else {
                    handleLocationFailure(err);
                }
            }
        );
    }, [handlePosition, handlePositionError, handleLocationFailure]);

    // The watch itself. Restarts whenever tracking turns on/off, the room or
    // boundary revision changes, or `watchEpoch` is bumped — and always tears
    // down on unmount: "only one watch per mounted player session." `roomID`
    // is listed explicitly for the same reason as the web: isTrackingActive
    // only flips on true/false transitions, so a room-to-room change with
    // tracking on throughout would otherwise never restart the watch.
    //
    // Unlike the browser, starting a watch is async here (permission read,
    // then watchPositionAsync resolving to a subscription), so `cancelled`
    // guards every step against a teardown that happened mid-start — a
    // subscription that resolves after teardown is removed immediately
    // rather than leaked.
    useEffect(() => {
        if (!isTrackingActive) return undefined;
        // Reset both throttles on every (re)start, same as the web: a stale
        // lastSentMsRef from the PREVIOUS context could otherwise throttle
        // away this restart's own immediate check, and a stale in-flight flag
        // could block it outright.
        lastSentMsRef.current = null;
        oneShotInFlightRef.current = false;
        oneShotTokenRef.current = null;

        let cancelled = false;
        let subscription = null;

        const start = async () => {
            const status = await readPermissionStatus();
            if (cancelled) return;
            if (status !== 'granted') {
                handlePositionError(reasonForPermissionStatus(status));
                return;
            }
            let nextSubscription;
            try {
                nextSubscription = await Location.watchPositionAsync(
                    WATCH_OPTIONS,
                    handlePosition,
                    (err) => {
                        if (!cancelled) handleLocationFailure(err);
                    }
                );
            } catch (err) {
                if (!cancelled) handleLocationFailure(err);
                return;
            }
            if (cancelled) {
                nextSubscription.remove();
                return;
            }
            subscription = nextSubscription;
            // An immediate fresh check on every (re)start — first enable, a
            // boundary revision or room change, and a Retry.
            requestFreshFix();
        };
        start();

        return () => {
            cancelled = true;
            subscription?.remove();
            clearTimeout(oneShotTimeoutRef.current);
            oneShotTokenRef.current = null;
            oneShotInFlightRef.current = false;
        };
    }, [
        isTrackingActive,
        roomID,
        boundaryRevision,
        watchEpoch,
        requestFreshFix,
        handlePosition,
        handlePositionError,
        handleLocationFailure,
    ]);

    // Backstop: force a fresh one-shot check if nothing has been sent
    // recently enough on its own (some platforms stop firing watch callbacks
    // while the position hasn't changed). Gated on permissionState, same as
    // the web: once denied, isTrackingActive stays true, so without this gate
    // the timer would re-check and re-report permission_denied every ~15 s.
    useEffect(() => {
        if (!isTrackingActive || permissionState === 'denied') return undefined;
        const intervalId = setInterval(() => {
            if (isPollDue(lastSentMsRef.current, Date.now())) {
                requestFreshFix();
            }
        }, POLL_CHECK_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isTrackingActive, permissionState, requestFreshFix]);

    // Reacquire a fresh fix as soon as the app returns to the foreground —
    // the RN equivalent of the web's visibilitychange handler. iOS suspends
    // foreground-only location updates while the app is backgrounded, and a
    // player locking/unlocking their phone is constant in live play.
    //
    // Same denied gate as the backstop: while denied, a foreground return
    // never requests a fix (which would just re-report permission_denied)
    // and never prompts. It only does a silent, non-prompting read of the
    // OS permission — the one moment a player is likely to have just come
    // back from flipping location on in Settings — and, if it is now
    // granted, restarts the watch exactly the way Retry would. That restart
    // is what moves permissionState back off 'denied' (on its first fix).
    useEffect(() => {
        if (!isTrackingActive) return undefined;
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState !== 'active') return;
            if (permissionState === 'denied') {
                readPermissionStatus().then((status) => {
                    if (status === 'granted') setWatchEpoch((epoch) => epoch + 1);
                });
                return;
            }
            requestFreshFix();
        });
        return () => subscription.remove();
    }, [isTrackingActive, permissionState, requestFreshFix]);

    // Enable Location / Retry — the only path that may show the OS prompt.
    // Once the prompt resolves, the first call flips `enabled` on (starting
    // the watch effect) and every call bumps `watchEpoch` so a Retry gets a
    // genuinely new watch. The prompt's own answer is not acted on here
    // beyond showing 'denied' straight away: the watch effect re-reads
    // permission on start and reports permission_denied itself, the same
    // single path a revision change after a denial goes through.
    //
    // `enabled` is set only AFTER the prompt resolves, never before: setting
    // it first would start the watch effect while the prompt is still up,
    // whose permission read would see 'undetermined' and report a denial the
    // player never made.
    const requestPermission = useCallback(async () => {
        let response;
        try {
            response = await Location.requestForegroundPermissionsAsync();
        } catch (err) {
            // e.g. the native module is missing or the app was built
            // without a location usage description — nothing a Retry fixes.
            console.error('Error requesting location permission:', err);
            setPermissionState('unavailable');
            return;
        }
        if (response?.status !== 'granted') setPermissionState('denied');
        setEnabled(true);
        setWatchEpoch((epoch) => epoch + 1);
    }, []);

    return { permissionState, ownPosition, requestPermission };
};

export default useBoundaryLocation;
