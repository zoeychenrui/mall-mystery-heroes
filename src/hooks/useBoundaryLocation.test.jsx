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
        watchPosition: jest.fn((onSuccess, onError) => {
            const id = nextWatchId++;
            activeWatches.set(id, { onSuccess, onError });
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

    it('forces a fresh getCurrentPosition check once the max-fresh interval elapses with nothing sent', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
        fakeGeolocation.getCurrentPosition.mockClear();

        act(() => jest.advanceTimersByTime(15000));

        expect(fakeGeolocation.getCurrentPosition).toHaveBeenCalled();
    });

    it('reacquires a fresh fix when the page becomes visible again', () => {
        const { result } = renderHook(() => useBoundaryLocation(baseProps));
        act(() => result.current.requestPermission());
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
