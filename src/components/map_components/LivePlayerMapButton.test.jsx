/**
 * Layer 2 — React Testing Library. GameMap is stubbed (it has its own
 * thorough tests); this file stays focused on LivePlayerMapButton's own
 * job: opening the modal, subscribing to the room's boundary statuses, and
 * turning each live, fresh status into a GameMap otherPositions entry
 * labeled with the matching player's name.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import LivePlayerMapButton from './LivePlayerMapButton';

let lastGameMapProps;
jest.mock('./GameMap', () => (props) => {
    lastGameMapProps = props;
    return <div data-testid="mock-game-map" />;
});

let snapshotCallback;
let snapshotErrorCallback;
jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn((ref, callback, errorCallback) => {
        snapshotCallback = callback;
        snapshotErrorCallback = errorCallback;
        return jest.fn();
    }),
}));

jest.mock('../firebase_calls/dbCalls', () => ({
    fetchBoundaryStatusesQueryForRoom: jest.fn(() => 'statuses-query'),
}));

const makeSnapshot = (docs) => ({
    docs: docs.map(([id, data]) => ({ id, data: () => data })),
});

const NOW = 1_700_000_000_000;

const renderButton = (props = {}) =>
    render(
        <ChakraProvider>
            <LivePlayerMapButton
                roomID="room-a"
                players={[{ name: 'Alice' }, { name: 'Bob' }]}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    lastGameMapProps = undefined;
    snapshotCallback = undefined;
    snapshotErrorCallback = undefined;
});

afterEach(() => jest.useRealTimers());

describe('LivePlayerMapButton', () => {
    it('opens the map modal on click', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));
        expect(screen.getByTestId('mock-game-map')).toBeInTheDocument();
    });

    it('turns each fresh status into a labeled otherPositions entry', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW - 1000 },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'alice', lat: 10, lng: 20, label: 'Alice' },
        ]);
    });

    it('excludes a status whose last usable fix has gone stale', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW - 60000 },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it('excludes a status with no lastUsableReceivedAt at all', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(makeSnapshot([['alice', { lat: 10, lng: 20 }]]));
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it('removes a position once it goes stale from time passing alone, with no new snapshot delivered', () => {
        // Finding 1: a disconnected player's status doc can sit fresh
        // forever with no new snapshot ever arriving. The fix stores the
        // raw doc data and re-derives freshness at render time against a
        // local ticker, so the position must disappear on its own once
        // GAME_BOUNDARY_CONFIG.freshnessMs passes — without the mocked
        // onSnapshot callback ever firing again.
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'alice', lat: 10, lng: 20, label: 'Alice' },
        ]);

        act(() => {
            jest.advanceTimersByTime(31000);
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it('excludes a position whose lat/lng are not finite numbers, even when otherwise fresh', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: null,
                            lng: undefined,
                            lastUsableReceivedAt: { toMillis: () => NOW },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it('clears positions when the subscription reports an error', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'alice',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'alice', lat: 10, lng: 20, label: 'Alice' },
        ]);

        act(() => {
            snapshotErrorCallback({ code: 'permission-denied', message: 'nope' });
        });

        expect(lastGameMapProps.otherPositions).toEqual([]);
    });

    it("resolves a dead player's real name from the players prop, same as any other player — the component does no filtering of its own, so the caller must pass everyone, not just the alive-names list", () => {
        // Carol is not alive, but her name is still present here — simulating
        // a caller now passing the FULL roster (Step 3's HeaderExecution fix),
        // not just arrayOfAlivePlayers (which, being alive-only by
        // construction, would never have included her).
        renderButton({ players: [{ name: 'Alice' }, { name: 'Carol' }] });
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    [
                        'carol',
                        {
                            lat: 10,
                            lng: 20,
                            lastUsableReceivedAt: { toMillis: () => NOW },
                        },
                    ],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'carol', lat: 10, lng: 20, label: 'Carol' },
        ]);
    });

    it('falls back to the raw document id as the label when no matching player name is found', () => {
        renderButton({ players: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Live Player Map' }));

        act(() => {
            snapshotCallback(
                makeSnapshot([
                    ['alice', { lat: 10, lng: 20, lastUsableReceivedAt: { toMillis: () => NOW } }],
                ])
            );
        });

        expect(lastGameMapProps.otherPositions).toEqual([
            { id: 'alice', lat: 10, lng: 20, label: 'alice' },
        ]);
    });
});
