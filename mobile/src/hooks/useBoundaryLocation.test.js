/**
 * Hook test for useBoundaryLocation — the expo-location port of the web's
 * src/hooks/useBoundaryLocation.js. Ports every case of the web's
 * src/hooks/useBoundaryLocation.test.jsx, swapping its fake
 * navigator.geolocation for a fake expo-location that honors the REAL
 * module's contract:
 *
 * - watchPositionAsync(options, callback, errorHandler) resolves to a
 *   subscription object whose remove() stops THAT watch specifically (not
 *   "the last one") — a single mutable slot would hide exactly the kind of
 *   cleanup bug the web's own Phase 2 review found behind an unfaithful
 *   mock.
 * - getCurrentPositionAsync is a genuine one-shot promise, independent of
 *   any active watch, and has no timeout option of its own.
 * - Permission is a separate call (getForegroundPermissionsAsync /
 *   requestForegroundPermissionsAsync), not an error delivered through the
 *   watch the way the browser does it.
 *
 * AppState's 'change' listener (the RN equivalent of the web's
 * visibilitychange) is captured via a spy so a test can fire 'active'.
 *
 * Every RNTL v14 renderHook/act call is async and awaited; `flush()` lets
 * the hook's own awaited permission check and watch start settle.
 */
import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as callables from '../firebase/callables';
import useBoundaryLocation from './useBoundaryLocation';

jest.mock('../firebase/callables', () => ({
    reportPlayerLocation: jest.fn(),
}));
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    getForegroundPermissionsAsync: jest.fn(),
    watchPositionAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

let nextWatchId;
let activeWatches;
let watchSubscriptions;
let pendingOneShots;
let osPermission;
let appStateListeners;

const makePosition = (overrides = {}) => ({
    coords: {
        latitude: 40,
        longitude: -74,
        accuracy: 10,
        ...overrides.coords,
    },
    timestamp: overrides.timestamp ?? Date.now(),
});

const permissionResponse = (status) => ({
    status,
    granted: status === 'granted',
    canAskAgain: true,
    expires: 'never',
});

// Lets every already-resolved promise chain inside the hook (permission
// check -> watchPositionAsync -> requestFreshFix) run to completion.
const flush = async () => {
    await act(async () => {
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
};

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    callables.reportPlayerLocation.mockResolvedValue({ status: 'inside', reason: null });

    // What the OS would currently say. requestForegroundPermissionsAsync
    // "prompts" by resolving to whatever this is set to at the time.
    osPermission = 'granted';
    Location.getForegroundPermissionsAsync.mockImplementation(async () =>
        permissionResponse(osPermission)
    );
    Location.requestForegroundPermissionsAsync.mockImplementation(async () =>
        permissionResponse(osPermission)
    );

    nextWatchId = 1;
    activeWatches = new Map();
    watchSubscriptions = [];
    Location.watchPositionAsync.mockImplementation(async (options, onSuccess, onError) => {
        const id = nextWatchId++;
        activeWatches.set(id, { onSuccess, onError });
        const subscription = { id, remove: jest.fn(() => activeWatches.delete(id)) };
        watchSubscriptions.push(subscription);
        return subscription;
    });

    // Each one-shot call stays pending until a test settles it explicitly,
    // exactly like a real fix that hasn't landed yet.
    pendingOneShots = [];
    Location.getCurrentPositionAsync.mockImplementation(
        () =>
            new Promise((resolve, reject) => {
                pendingOneShots.push({ resolve, reject });
            })
    );

    appStateListeners = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
        const entry = { type, listener };
        appStateListeners.push(entry);
        return {
            remove: jest.fn(() => {
                appStateListeners = appStateListeners.filter((e) => e !== entry);
            }),
        };
    });
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

const firePosition = async (watchId, position) => {
    await act(async () => {
        activeWatches.get(watchId)?.onSuccess(position);
    });
};

const resolveOneShot = async (index, position) => {
    await act(async () => {
        pendingOneShots[index].resolve(position);
    });
    await flush();
};

const rejectOneShot = async (index, error) => {
    await act(async () => {
        pendingOneShots[index].reject(error);
    });
    await flush();
};

const fireAppState = async (nextState) => {
    await act(async () => {
        appStateListeners
            .filter((entry) => entry.type === 'change')
            .forEach((entry) => entry.listener(nextState));
    });
    await flush();
};

const requestPermission = async (result) => {
    await act(async () => {
        await result.current.requestPermission();
    });
    await flush();
};

const latestWatchId = () => watchSubscriptions.at(-1).id;

const baseProps = {
    roomID: 'room-a',
    boundaryRevision: 1,
    boundaryEnabled: true,
    isGameActive: true,
    isAlive: true,
};

const renderWith = (props = baseProps) =>
    renderHook((hookProps) => useBoundaryLocation(hookProps), { initialProps: props });

describe('useBoundaryLocation', () => {
    it('does nothing until requestPermission is called — no prompt, no watch', async () => {
        await renderWith();
        await flush();
        expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();
        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('prompts, then starts a watch and an immediate one-shot check once permission is requested', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
        expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
        expect(Location.watchPositionAsync).toHaveBeenCalledWith(
            { accuracy: Location.Accuracy.High, timeInterval: 0, distanceInterval: 0 },
            expect.any(Function),
            expect.any(Function)
        );
        expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
        expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({
            accuracy: Location.Accuracy.High,
        });
    });

    it('reports an accepted fix and exposes it as ownPosition immediately', async () => {
        const { result } = await renderWith();
        await requestPermission(result);

        await firePosition(latestWatchId(), makePosition());

        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ roomId: 'room-a', boundaryRevision: 1, lat: 40, lng: -74 })
        );
        expect(result.current.ownPosition).toMatchObject({ lat: 40, lng: -74, accuracyM: 10 });
        expect(result.current.permissionState).toBe('granted');
    });

    it('throttles outgoing reports to at most one per 5 seconds, but still updates ownPosition every time', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        const watchId = latestWatchId();

        await firePosition(watchId, makePosition({ coords: { latitude: 1 } }));
        await firePosition(watchId, makePosition({ coords: { latitude: 2 } }));

        expect(callables.reportPlayerLocation).toHaveBeenCalledTimes(1);
        expect(result.current.ownPosition.lat).toBe(2);

        await act(async () => {
            jest.advanceTimersByTime(5000);
        });
        await firePosition(watchId, makePosition({ coords: { latitude: 3 } }));
        expect(callables.reportPlayerLocation).toHaveBeenCalledTimes(2);
    });

    it('stops the old watch and starts a fresh one when the boundary revision changes — a leftover old watch firing does nothing', async () => {
        const { result, rerender } = await renderWith();
        await requestPermission(result);
        const oldSubscription = watchSubscriptions[0];

        await rerender({ ...baseProps, boundaryRevision: 2 });
        await flush();

        expect(oldSubscription.remove).toHaveBeenCalledTimes(1);
        expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);

        callables.reportPlayerLocation.mockClear();
        // A real removed subscription can't deliver this — if the hook
        // actually called remove() (asserted above), nothing fires.
        await firePosition(oldSubscription.id, makePosition());
        expect(callables.reportPlayerLocation).not.toHaveBeenCalled();
    });

    it("resets the send throttle on a revision restart, so the restarted watch's own immediate check is not silently dropped", async () => {
        const { result, rerender } = await renderWith();
        await requestPermission(result);
        await resolveOneShot(0, makePosition());
        expect(callables.reportPlayerLocation).toHaveBeenCalledTimes(1);

        callables.reportPlayerLocation.mockClear();
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        await rerender({ ...baseProps, boundaryRevision: 2 });
        await flush();
        expect(pendingOneShots).toHaveLength(2);
        await resolveOneShot(1, makePosition());

        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ boundaryRevision: 2 })
        );
    });

    it('also stops the old watch and starts a fresh one when the room changes', async () => {
        const { result, rerender } = await renderWith();
        await requestPermission(result);
        const oldSubscription = watchSubscriptions[0];

        await rerender({ ...baseProps, roomID: 'room-b' });
        await flush();

        expect(oldSubscription.remove).toHaveBeenCalledTimes(1);
        callables.reportPlayerLocation.mockClear();
        await firePosition(oldSubscription.id, makePosition());
        expect(callables.reportPlayerLocation).not.toHaveBeenCalled();
    });

    it('drops a one-shot result that lands after tracking stopped (player eliminated), even for the same room and revision', async () => {
        // sendReport's own room/revision guard can't catch this one — the
        // room and revision are unchanged — so only the hook's per-watch
        // one-shot token stops an eliminated player's late fix being sent.
        const { result, rerender } = await renderWith();
        await requestPermission(result);

        await rerender({ ...baseProps, isAlive: false });
        await flush();
        callables.reportPlayerLocation.mockClear();

        await resolveOneShot(0, makePosition());
        expect(callables.reportPlayerLocation).not.toHaveBeenCalled();
    });

    it('sets permissionState to denied and reports permission_denied when the prompt is declined, without starting a watch', async () => {
        osPermission = 'denied';
        const { result } = await renderWith();
        await requestPermission(result);

        expect(result.current.permissionState).toBe('denied');
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'permission_denied' })
        );
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();
        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('classifies a one-shot failure as permission_denied when the OS no longer grants permission (revoked in Settings mid-game)', async () => {
        const { result } = await renderWith();
        await requestPermission(result);

        osPermission = 'denied';
        await rejectOneShot(0, new Error('Not authorized to use location services'));

        expect(result.current.permissionState).toBe('denied');
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'permission_denied' })
        );
    });

    it('classifies a one-shot failure as unavailable while permission is still granted (e.g. location services off)', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = await renderWith();
        await requestPermission(result);

        await rejectOneShot(0, new Error('Location services are disabled'));

        expect(result.current.permissionState).not.toBe('denied');
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'unavailable' })
        );
        consoleSpy.mockRestore();
    });

    it('classifies a watch error the same way as a one-shot error', async () => {
        const { result } = await renderWith();
        await requestPermission(result);

        osPermission = 'denied';
        await act(async () => {
            activeWatches.get(latestWatchId()).onError('Location permission revoked');
        });
        await flush();

        expect(result.current.permissionState).toBe('denied');
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'permission_denied' })
        );
    });

    it('requestPermission always makes a fresh attempt, even after an earlier one (Retry)', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);

        await requestPermission(result);
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
        expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(2);
    });

    // Review Focus: permission re-granted from OS Settings while the app is
    // running. Not just "the right mock was called" — a position update
    // after Retry must actually reach reportPlayerLocation.
    it('Retry after a denial re-requests permission and, once granted, resumes reporting on a brand-new watch', async () => {
        osPermission = 'denied';
        const { result } = await renderWith();
        await requestPermission(result);
        expect(result.current.permissionState).toBe('denied');
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();

        // The player flips the permission on in Settings, comes back, and
        // taps Retry.
        osPermission = 'granted';
        callables.reportPlayerLocation.mockClear();
        await requestPermission(result);

        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
        expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
        const watchId = latestWatchId();
        expect(activeWatches.has(watchId)).toBe(true);

        await firePosition(watchId, makePosition({ coords: { latitude: 41 } }));

        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ roomId: 'room-a', boundaryRevision: 1, lat: 41 })
        );
        expect(result.current.permissionState).toBe('granted');
    });

    it('Retry after a mid-game revocation tears down the old watch and starts a genuinely new one that reports', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        const firstSubscription = watchSubscriptions[0];

        osPermission = 'denied';
        await rejectOneShot(0, new Error('Not authorized'));
        expect(result.current.permissionState).toBe('denied');

        osPermission = 'granted';
        callables.reportPlayerLocation.mockClear();
        await requestPermission(result);

        expect(firstSubscription.remove).toHaveBeenCalled();
        expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
        const newWatchId = latestWatchId();
        expect(newWatchId).not.toBe(firstSubscription.id);

        await firePosition(newWatchId, makePosition());
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ lat: 40, lng: -74 })
        );
    });

    it('forces a fresh one-shot check once the max-fresh interval elapses with nothing sent', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        await resolveOneShot(0, makePosition());
        Location.getCurrentPositionAsync.mockClear();

        // 16000, not 15000: the backstop only ticks every 2s, so the first
        // tick actually past the 15000ms isPollDue threshold lands at 16000.
        await act(async () => {
            jest.advanceTimersByTime(16000);
        });

        expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
    });

    // Review Focus: returning to the foreground must force a fresh check,
    // the RN equivalent of the web's visibilitychange reacquire.
    it('reacquires a fresh fix when the app returns to the foreground', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        await resolveOneShot(0, makePosition());
        Location.getCurrentPositionAsync.mockClear();
        callables.reportPlayerLocation.mockClear();
        await act(async () => {
            jest.advanceTimersByTime(6000);
        });

        await fireAppState('background');
        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();

        await fireAppState('active');
        expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);

        await resolveOneShot(1, makePosition({ coords: { latitude: 42 } }));
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ lat: 42 })
        );
    });

    it('stops the backstop timer from re-checking after a denial, until requestPermission is called again', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        osPermission = 'denied';
        await rejectOneShot(0, new Error('Not authorized'));
        expect(result.current.permissionState).toBe('denied');

        Location.getCurrentPositionAsync.mockClear();
        await act(async () => {
            jest.advanceTimersByTime(20000);
        });
        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
        // And never re-prompts on its own.
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

        osPermission = 'granted';
        await requestPermission(result);
        expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
    });

    it('does not re-check or re-prompt on foreground while denied and the OS still denies', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        osPermission = 'denied';
        await rejectOneShot(0, new Error('Not authorized'));
        expect(result.current.permissionState).toBe('denied');

        Location.getCurrentPositionAsync.mockClear();
        Location.watchPositionAsync.mockClear();
        callables.reportPlayerLocation.mockClear();
        await fireAppState('active');

        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();
        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
        expect(callables.reportPlayerLocation).not.toHaveBeenCalled();

        osPermission = 'granted';
        await requestPermission(result);
        expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
    });

    it('resumes on its own when the app returns to the foreground after permission was re-granted in Settings — without prompting', async () => {
        osPermission = 'denied';
        const { result } = await renderWith();
        await requestPermission(result);
        expect(result.current.permissionState).toBe('denied');

        osPermission = 'granted';
        callables.reportPlayerLocation.mockClear();
        await fireAppState('active');

        expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
        expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
        await firePosition(latestWatchId(), makePosition({ coords: { latitude: 43 } }));
        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ lat: 43 })
        );
        expect(result.current.permissionState).toBe('granted');
    });

    it('times out a one-shot check that never lands after 10 seconds and reports timeout', async () => {
        const { result } = await renderWith();
        await requestPermission(result);

        await act(async () => {
            jest.advanceTimersByTime(10000);
        });
        await flush();

        expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'timeout' })
        );
    });

    it('does not pile up a second one-shot call from the backstop while one is already in flight', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        Location.getCurrentPositionAsync.mockClear();

        await act(async () => {
            jest.advanceTimersByTime(9000);
        });

        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('does not pile up a second one-shot call from a foreground event while one is already in flight', async () => {
        const { result } = await renderWith();
        await requestPermission(result);
        Location.getCurrentPositionAsync.mockClear();

        await fireAppState('active');

        expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('removes the watch and the AppState listener on unmount', async () => {
        const { result, unmount } = await renderWith();
        await requestPermission(result);
        const subscription = watchSubscriptions[0];

        await unmount();

        expect(subscription.remove).toHaveBeenCalledTimes(1);
        expect(appStateListeners).toHaveLength(0);
    });

    it('removes a watch whose start was still pending when the hook unmounted', async () => {
        let finishStart;
        Location.watchPositionAsync.mockImplementationOnce(
            (options, onSuccess) =>
                new Promise((resolve) => {
                    finishStart = () => {
                        const subscription = { id: 99, remove: jest.fn() };
                        watchSubscriptions.push(subscription);
                        activeWatches.set(99, { onSuccess });
                        resolve(subscription);
                    };
                })
        );
        const { result, unmount } = await renderWith();
        await requestPermission(result);
        await unmount();

        await act(async () => finishStart());
        await flush();

        expect(watchSubscriptions.at(-1).remove).toHaveBeenCalledTimes(1);
    });

    it('does not start a watch when the boundary is disabled', async () => {
        const { result } = await renderWith({ ...baseProps, boundaryEnabled: false });
        await requestPermission(result);
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    });

    it('does not start a watch when isAlive is false, even with everything else enabled', async () => {
        const { result } = await renderWith({ ...baseProps, isAlive: false });
        await requestPermission(result);
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    });

    it('stops an active watch the moment isAlive flips to false', async () => {
        const { result, rerender } = await renderWith();
        await requestPermission(result);
        const subscription = watchSubscriptions[0];

        await rerender({ ...baseProps, isAlive: false });

        expect(subscription.remove).toHaveBeenCalledTimes(1);
    });

    it('sets permissionState to unavailable when the permission request itself throws', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        Location.requestForegroundPermissionsAsync.mockRejectedValue(new Error('no plist key'));
        const { result } = await renderWith();
        await requestPermission(result);

        expect(result.current.permissionState).toBe('unavailable');
        expect(Location.watchPositionAsync).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('a rejected report is swallowed and never thrown into the hook', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        callables.reportPlayerLocation.mockRejectedValue(new Error('revision_conflict'));
        const { result } = await renderWith();
        await requestPermission(result);

        await firePosition(latestWatchId(), makePosition());
        await flush();
        expect(consoleSpy).toHaveBeenCalledWith('Error reporting location:', expect.any(Error));
        consoleSpy.mockRestore();
    });
});
