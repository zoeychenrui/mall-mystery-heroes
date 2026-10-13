/**
 * Layer 2 — React Testing Library (renderHook). navigator.geolocation
 * does not exist in jsdom at all, so this entire file replaces it with
 * a fake that honors the REAL API's contract: watchPosition returns a
 * numeric id and keeps firing until clearWatch is called with THAT id
 * specifically (not "the last one"); getCurrentPosition is a genuine
 * one-shot call, independent of any active watch. This is deliberate —
 * a single mutable slot would hide exactly the kind of cleanup bug
 * Phase 2's final review found hiding behind an unfaithful mock.
 */
import { act, renderHook } from '@testing-library/react';
import useBoundaryLocation from './useBoundaryLocation';
import { reportPlayerLocation } from '../components/reportPlayerLocation';

jest.mock('../components/reportPlayerLocation', () => ({
    reportPlayerLocation: jest.fn(),
}));

let nextWatchId;
let activeWatches;
let fakeGeolocation;

const makePosition = (overrides = {}) => ({
    coords: {
        latitude: 40,
        longitude: -74,
        accuracy: 10,
        ...overrides.coords,
    },
    timestamp: overrides.timestamp ?? Date.now(),
});

const makePositionError = (code) => ({
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
});

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    reportPlayerLocation.mockResolvedValue({ status: 'inside', reason: null });

    nextWatchId = 1;
    activeWatches = new Map();
    fakeGeolocation = {
        // A PERMISSION_DENIED error delivered to an active watch kills
        // that watch for good, per the real W3C Geolocation spec — the
        // browser will not resume delivering results on it even once the
        // user later re-grants permission. The wrapped onError mirrors
        // that by dropping the watch from activeWatches right after
        // delivering the error, so a test can tell whether the hook
        // actually started a FRESH watchPosition call afterward (Finding
        // 3) rather than relying on this one, now-dead id.
        watchPosition: jest.fn((onSuccess, onError) => {
            const id = nextWatchId++;
            const wrappedOnError = (positionError) => {
                onError(positionError);
                if (positionError.code === 1) {
                    activeWatches.delete(id);
                }
            };
            activeWatches.set(id, { onSuccess, onError: wrappedOnError });
            return id;
        }),
        clearWatch: jest.fn((id) => {
            activeWatches.delete(id);
        }),
        getCurrentPosition: jest.fn(),
    };
    Object.defineProperty(global.navigator, 'geolocation', {
        value: fakeGeolocation,
        configurable: true,
    });
});

afterEach(() => {
    jest.useRealTimers();
});

const firePosition = (watchId, position) => {
    act(() => {
        activeWatches.get(watchId)?.onSuccess(position);
    });
};

const baseProps = {
    roomID: 'room-a',
    boundaryRevision: 1,
    boundaryEnabled: true,
    isGameActive: true,
    isAlive: true,
};

describe('useBoundaryLocation', () => {
    it('does nothing until requestPermission is called', () => {
        renderHook(() => useBoundaryLocation(baseProps));
        expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('starts a watch and an immediate getCurrentPosition check once permission is requested', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(1);
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it('reports an accepted fix and exposes it as ownPosition immediately', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        firePosition(watchId, makePosition());

        expect(reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ roomId: 'room-a', boundaryRevision: 1, lat: 40, lng: -74 })
        );
        expect(result.current.ownPosition).toMatchObject({ lat: 40, lng: -74, accuracyM: 10 });
        expect(result.current.permissionState).toBe('granted');
    });

    it('throttles outgoing reports to at most one per 5 seconds, but still updates ownPosition every time', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        firePosition(watchId, makePosition({ coords: { latitude: 1 } }));
        firePosition(watchId, makePosition({ coords: { latitude: 2 } }));

        expect(reportPlayerLocation).toHaveBeenCalledTimes(1);
        expect(result.current.ownPosition.lat).toBe(2);

        act(() => jest.advanceTimersByTime(5000));
        firePosition(watchId, makePosition({ coords: { latitude: 3 } }));
        expect(reportPlayerLocation).toHaveBeenCalledTimes(2);
    });

    it('stops the old watch and starts a fresh one when the boundary revision changes — a leftover old watch firing does nothing', () => {
        const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
            initialProps: baseProps,
        });
        act(() => result.current.requestPermission());
        const oldWatchId = fakeGeolocation.watchPosition.mock.results[0].value;

        rerender({ ...baseProps, boundaryRevision: 2 });

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(oldWatchId);

        reportPlayerLocation.mockClear();
        // This simulates a late callback from the OLD watch arriving
        // after cleanup — a real cleared watch cannot do this, so if
        // the hook actually called clearWatch (asserted above),
        // activeWatches no longer has this id and nothing fires.
        firePosition(oldWatchId, makePosition());
        expect(reportPlayerLocation).not.toHaveBeenCalled();
    });

    it("resets the send throttle on a revision restart, so the restarted watch's own immediate check is not silently dropped", () => {
        // Finding 5: lastSentMsRef must not survive a watch restart. Here
        // a report goes out, then — only 2s later, well under the 5s
        // minimum send interval — the GM republishes the boundary. The
        // restarted watch's own immediate fresh check must still be sent
        // despite that short gap, because it belongs to a NEW revision,
        // not a resend of the old one.
        const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
            initialProps: baseProps,
        });
        act(() => result.current.requestPermission());
        const [initialOnSuccess] = fakeGeolocation.getCurrentPosition.mock.calls[0];
        act(() => initialOnSuccess(makePosition()));
        expect(reportPlayerLocation).toHaveBeenCalledTimes(1);

        reportPlayerLocation.mockClear();
        fakeGeolocation.getCurrentPosition.mockClear();
        act(() => jest.advanceTimersByTime(2000));

        rerender({ ...baseProps, boundaryRevision: 2 });
        const [restartedOnSuccess] = fakeGeolocation.getCurrentPosition.mock.calls[0];
        act(() => restartedOnSuccess(makePosition()));

        // Without resetting lastSentMsRef on restart, shouldSendFix would
        // see only 2s elapsed since the last send (under the 5s minimum)
        // and silently drop this report.
        expect(reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ boundaryRevision: 2 })
        );
    });

    it('also stops the old watch and starts a fresh one when the room changes', () => {
        const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
            initialProps: baseProps,
        });
        act(() => result.current.requestPermission());
        const oldWatchId = fakeGeolocation.watchPosition.mock.results[0].value;

        rerender({ ...baseProps, roomID: 'room-b' });

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(oldWatchId);
        reportPlayerLocation.mockClear();
        firePosition(oldWatchId, makePosition());
        expect(reportPlayerLocation).not.toHaveBeenCalled();
    });

    it('sets permissionState to denied and reports permission_denied on a PERMISSION_DENIED error, without throwing into the hook', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        act(() => {
            activeWatches.get(watchId)?.onError(makePositionError(1));
        });

        expect(result.current.permissionState).toBe('denied');
        expect(reportPlayerLocation).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'permission_denied' })
        );
    });

    it('requestPermission always makes a fresh attempt, even after an earlier denial (Retry)', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalledTimes(1);

        act(() => result.current.requestPermission());
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    });

    it('starts a genuinely new watchPosition call on Retry after a PERMISSION_DENIED, not just another one-shot check', () => {
        // Finding 3: a PERMISSION_DENIED error kills the active watch for
        // good (the fakeGeolocation mock above now mirrors that by
        // dropping it from activeWatches), so Retry must tear down and
        // restart the watch itself — relying solely on another one-shot
        // getCurrentPosition call would leave the player with no live
        // watch ever again, only the ~15s backstop.
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        act(() => {
            activeWatches.get(watchId)?.onError(makePositionError(1));
        });
        expect(result.current.permissionState).toBe('denied');
        // The mock already proves the watch is dead, the same way a real
        // denied watch would be.
        expect(activeWatches.has(watchId)).toBe(false);

        fakeGeolocation.watchPosition.mockClear();
        act(() => result.current.requestPermission());

        expect(fakeGeolocation.watchPosition).toHaveBeenCalledTimes(1);
        const newWatchId = fakeGeolocation.watchPosition.mock.results[0].value;
        expect(newWatchId).not.toBe(watchId);
        expect(activeWatches.has(newWatchId)).toBe(true);
    });

    it('forces a fresh getCurrentPosition check once the max-fresh interval elapses with nothing sent', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        // Resolve the watch-start effect's own immediate check first —
        // the in-flight guard (Finding 4) would otherwise still consider
        // it pending and suppress the backstop's call below, which is
        // exactly what the dedicated in-flight-guard test further down
        // exercises on purpose; this test is about the timer, not the
        // guard, so it clears the way for the timer first.
        const [initialOnSuccess] = fakeGeolocation.getCurrentPosition.mock.calls[0];
        act(() => initialOnSuccess(makePosition()));
        fakeGeolocation.getCurrentPosition.mockClear();

        // 16000, not 15000: the backstop timer only ticks every 2s
        // (POLL_CHECK_INTERVAL_MS), and lastSentMsRef is now a real
        // timestamp (set by resolving the initial check above), so the
        // first tick actually past the 15000ms isPollDue threshold lands
        // at 16000ms, not at a bare 15000ms advance.
        act(() => jest.advanceTimersByTime(16000));

        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('reacquires a fresh fix when the page becomes visible again', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        // Same reasoning as the backstop test above: resolve the initial
        // in-flight call so the guard doesn't suppress this one.
        const [initialOnSuccess] = fakeGeolocation.getCurrentPosition.mock.calls[0];
        act(() => initialOnSuccess(makePosition()));
        fakeGeolocation.getCurrentPosition.mockClear();

        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('stops the backstop timer from re-checking after a PERMISSION_DENIED error, until requestPermission is called again', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        act(() => {
            activeWatches.get(watchId)?.onError(makePositionError(1));
        });
        expect(result.current.permissionState).toBe('denied');

        fakeGeolocation.getCurrentPosition.mockClear();
        // 20s, not 15s: the backstop timer only ticks every 2s
        // (POLL_CHECK_INTERVAL_MS), so a bare 15000ms advance never
        // lands a tick past the exact 15000ms isPollDue threshold (its
        // last tick before that boundary is at 14000ms) and would pass
        // this assertion even with the bug this test exists to catch.
        act(() => jest.advanceTimersByTime(20000));
        expect(fakeGeolocation.getCurrentPosition).not.toHaveBeenCalled();

        // Only an explicit requestPermission (Enable Location/Retry) may
        // ask again — and it still does, proving the gate above isn't
        // latching the hook out of retrying altogether.
        act(() => result.current.requestPermission());
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('stops the visibility-change reacquire from firing after a PERMISSION_DENIED error, until requestPermission is called again', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        act(() => {
            activeWatches.get(watchId)?.onError(makePositionError(1));
        });
        expect(result.current.permissionState).toBe('denied');

        fakeGeolocation.getCurrentPosition.mockClear();
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(fakeGeolocation.getCurrentPosition).not.toHaveBeenCalled();

        act(() => result.current.requestPermission());
        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('passes a finite timeout to one-shot getCurrentPosition calls, so a fix that never arrives can still time out', () => {
        // Finding 4: GEOLOCATION_OPTIONS (used for watchPosition) has no
        // timeout, which is correct for the watch — but the one-shot
        // calls need one, or a device that can't get a fix (weak signal,
        // indoors) never produces the spec's "timeout gets an actionable
        // message" path at all.
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());

        const [, , options] = fakeGeolocation.getCurrentPosition.mock.calls[0];
        expect(Number.isFinite(options.timeout)).toBe(true);
        expect(options.timeout).toBeGreaterThan(0);
    });

    it('does not pile up a second getCurrentPosition call from the backstop while one is already in flight', () => {
        // Finding 4: simulates a device that can never get a fix at all —
        // the initial check is left unresolved (no success/error ever
        // delivered), exactly like a real getCurrentPosition call that is
        // taking long enough to still be pending. Every 2s backstop tick
        // over the next 10s would, without an in-flight guard, fire
        // another getCurrentPosition call since isPollDue stays true the
        // whole time (lastSentMsRef never got set).
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        fakeGeolocation.getCurrentPosition.mockClear();

        act(() => jest.advanceTimersByTime(10000));

        expect(fakeGeolocation.getCurrentPosition).not.toHaveBeenCalled();
    });

    it('clears the watch on unmount', () => {
        const { result, unmount } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        unmount();

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(watchId);
    });

    it('does not start a watch when the boundary is disabled, and sets no permission state either way', () => {
        renderHook(() => useBoundaryLocation({ ...baseProps, boundaryEnabled: false }));
        expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('does not start a watch when isAlive is false, even with everything else enabled', () => {
        renderHook(() => useBoundaryLocation({ ...baseProps, isAlive: false }));
        expect(fakeGeolocation.watchPosition).not.toHaveBeenCalled();
    });

    it('stops an active watch the moment isAlive flips to false', () => {
        const { result, rerender } = renderHook((props) => useBoundaryLocation(props), {
            initialProps: { ...baseProps, isAlive: true },
        });
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        rerender({ ...baseProps, isAlive: false });

        expect(fakeGeolocation.clearWatch).toHaveBeenCalledWith(watchId);
    });

    it('a rejected report is swallowed and never thrown into the hook', async () => {
        reportPlayerLocation.mockRejectedValue(new Error('revision_conflict'));
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        const watchId = fakeGeolocation.watchPosition.mock.results[0].value;

        firePosition(watchId, makePosition());
        await act(async () => {
            await Promise.resolve();
        });
        // No assertion beyond "this line was reached" — a thrown
        // rejection inside an effect would fail the test via an
        // unhandled error instead.
    });
});
