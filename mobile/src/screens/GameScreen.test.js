import { Alert, BackHandler } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import * as Location from 'expo-location';
import * as callables from '../firebase/callables';
import * as playerSession from '../utils/playerSession';
import GameScreen from './GameScreen';

// Same reason as JoinScreen.test.js / ReconnectPendingScreen.test.js:
// firebaseConfig.js throws at module load under Jest (the top-level
// `firebase` package's "./auth" export map has no "react-native" condition,
// so getReactNativePersistence is undefined). GameScreen reaches it three
// ways — directly (auth, for signOut), through dbCalls.js (db), and through
// callables.js (functions) — so all three are covered here: firebaseConfig
// is stubbed, callables is replaced outright, and dbCalls is kept real but
// sits on an auto-mocked firebase/firestore.
jest.mock('../firebase/firebaseConfig', () => ({
    db: {},
    auth: {},
}));
jest.mock('../firebase/callables', () => ({
    leaveGame: jest.fn(),
    submitChatMessage: jest.fn(),
    reportPlayerLocation: jest.fn(),
}));
// Task 11's useBoundaryLocation (mounted by GameScreen) calls expo-location,
// whose native module doesn't exist under Jest. Driven per-test where the
// permission/position flow matters; otherwise it simply never starts (no
// test presses Enable Location unless it means to).
jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    getForegroundPermissionsAsync: jest.fn(),
    watchPositionAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));
jest.mock('firebase/firestore');
jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../utils/playerSession', () => ({
    readPlayerSession: jest.fn(),
    clearPlayerSession: jest.fn(),
}));

const ROOM_PATH = 'rooms/ROOM1';
const PLAYER_PATH = 'rooms/ROOM1/players/alice';
const PLAYERS_PATH = 'rooms/ROOM1/players';
const TASKS_PATH = 'rooms/ROOM1/tasks';
// Task 9's ChatFeed subscribes here too, as soon as roomID/playerName are
// both known — regardless of gameStarted/isGameActive.
const MESSAGES_PATH = 'rooms/ROOM1/playerMessages';
// Task 11: the player's own status doc and the room's outside-players
// query — both only once gameBoundary.enabled is true.
const OWN_STATUS_PATH = 'rooms/ROOM1/boundaryStatuses/alice';
const OUTSIDE_STATUSES_PATH = 'rooms/ROOM1/boundaryStatuses';

// A Firestore-Timestamp-shaped stub.
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

// Give dbCalls' doc()/collection()/query() calls a recognizable return value
// (the path they were built from), so each onSnapshot call can be told apart
// by which ref it was handed.
const tagRefsByPath = () => {
    doc.mockImplementation((db, ...segments) => ({ path: segments.join('/') }));
    collection.mockImplementation((db, ...segments) => ({ path: segments.join('/') }));
    query.mockImplementation((ref) => ref);
};

// Drives every listener GameScreen mounts from one table of snapshot data,
// keyed by ref path. Returns a per-path record of how many times each was
// subscribed and its unsubscribe mock.
const driveSnapshots = ({
    room,
    player,
    ownStatus = null,
    outsideStatuses = [],
    // 'powerUpPing'/'chat'/etc. message docs, delivered as one 'added'
    // docChanges() batch on first subscribe — same shape ChatFeed.test.js
    // builds (asDocChanges), for Task 12 tests that need a ping card's
    // "View on map" button to actually render.
    messages = [],
}) => {
    const listeners = {};
    onSnapshot.mockImplementation((ref, onNext) => {
        const unsubscribe = jest.fn();
        listeners[ref.path] = listeners[ref.path] ?? { subscribeCount: 0, unsubscribes: [] };
        listeners[ref.path].subscribeCount += 1;
        listeners[ref.path].unsubscribes.push(unsubscribe);
        if (ref.path === ROOM_PATH) {
            onNext({ exists: () => true, data: () => room });
        } else if (ref.path === PLAYER_PATH) {
            onNext({ exists: () => true, data: () => player });
        } else if (ref.path === OWN_STATUS_PATH) {
            onNext({ exists: () => ownStatus !== null, data: () => ownStatus ?? undefined });
        } else if (ref.path === OUTSIDE_STATUSES_PATH) {
            onNext({
                docs: outsideStatuses.map(({ id, ...data }) => ({ id, data: () => data })),
            });
        } else if (ref.path === MESSAGES_PATH && messages.length > 0) {
            onNext({
                docChanges: () =>
                    messages.map((message, index) => ({
                        type: 'added',
                        newIndex: index,
                        doc: { id: `message-${index}`, data: () => message },
                    })),
            });
        } else {
            // Covers the players/tasks queries (which read .docs) and
            // ChatFeed's playerMessages query (which reads .docChanges()).
            onNext({ docs: [], docChanges: () => [] });
        }
        return unsubscribe;
    });
    return listeners;
};

// Every exit to Join must be a stack reset, not navigate('Join'): in React
// Navigation 7, navigate() pushes a new Join on top and leaves GameScreen
// mounted underneath with all four listeners still live.
const RESET_TO_JOIN = { index: 0, routes: [{ name: 'Join' }] };
const makeNavigation = () => ({ navigate: jest.fn(), reset: jest.fn() });

const expectResetToJoin = (navigation) => {
    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith(RESET_TO_JOIN);
    expect(navigation.navigate).not.toHaveBeenCalled();
};

const renderScreen = (navigation = makeNavigation()) =>
    render(<GameScreen route={{ params: { roomID: 'ROOM1' } }} navigation={navigation} />);

// Same mocking approach as useBoundaryLocation.test.js's AppState.addEventListener
// spy (there's no native BackHandler module under Jest either): captures
// every 'hardwareBackPress' listener GameScreen registers so a test can fire
// it directly, the same way a real Android back-button press would.
let hardwareBackPressListeners;
const fireHardwareBackPress = () =>
    hardwareBackPressListeners.map((listener) => listener()).some(Boolean);

beforeEach(() => {
    jest.clearAllMocks();
    tagRefsByPath();
    playerSession.readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
    playerSession.clearPlayerSession.mockResolvedValue(undefined);

    hardwareBackPressListeners = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((type, listener) => {
        if (type === 'hardwareBackPress') hardwareBackPressListeners.push(listener);
        return {
            remove: jest.fn(() => {
                hardwareBackPressListeners = hardwareBackPressListeners.filter(
                    (entry) => entry !== listener
                );
            }),
        };
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('GameScreen', () => {
    it('unsubscribes every live listener exactly once on unmount', async () => {
        const listeners = driveSnapshots({
            room: { gameStarted: true, isGameActive: true },
            player: { isAlive: true, targets: [] },
        });
        const { unmount } = await renderScreen();
        await waitFor(() =>
            expect(Object.keys(listeners).sort()).toEqual(
                [ROOM_PATH, PLAYER_PATH, PLAYERS_PATH, TASKS_PATH, MESSAGES_PATH].sort()
            )
        );
        await unmount();
        Object.values(listeners).forEach(({ subscribeCount, unsubscribes }) => {
            // Subscribed once — never re-subscribed on a re-render — and
            // that one subscription torn down exactly once.
            expect(subscribeCount).toBe(1);
            expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
        });
    });

    it('shows the waiting-room text before the host starts the game', async () => {
        driveSnapshots({
            room: { gameStarted: false, isGameActive: true },
            player: { isAlive: true },
        });
        const { findByText } = await renderScreen();
        await findByText('Waiting for the host to start...');
    });

    it('subscribes to the player doc in the waiting room, before the game starts', async () => {
        const listeners = driveSnapshots({
            room: { gameStarted: false, isGameActive: true },
            player: { isAlive: true },
        });
        await renderScreen();
        await waitFor(() => expect(listeners[PLAYER_PATH]?.subscribeCount).toBe(1));
        // Players/tasks queries stay gated on gameStarted, same as the web.
        expect(listeners[PLAYERS_PATH]).toBeUndefined();
        expect(listeners[TASKS_PATH]).toBeUndefined();
    });

    it('shows the eliminated heading once the player is marked dead', async () => {
        driveSnapshots({
            room: { gameStarted: true, isGameActive: true },
            player: { isAlive: false },
        });
        const { findByText } = await renderScreen();
        await findByText("YOU'VE BEEN ELIMINATED");
        await findByText('Be on the lookout for revival missions to get back in.');
    });

    it('shows the persistent game-ended banner once the game is no longer active', async () => {
        driveSnapshots({
            room: { gameStarted: true, isGameActive: false },
            player: { isAlive: true },
        });
        const { findByText } = await renderScreen();
        await findByText('GAME ENDED. PLEASE HEAD BACK TO THE STARTING AREA.');
    });

    it('leaves the game, clears the session, and returns to Join on confirm', async () => {
        driveSnapshots({
            room: { gameStarted: false, isGameActive: true },
            player: { isAlive: true },
        });
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        callables.leaveGame.mockResolvedValue(undefined);
        const navigation = makeNavigation();
        const { getByLabelText } = await renderScreen(navigation);

        await fireEvent.press(getByLabelText('Leave'));
        const [title, , buttons] = alertSpy.mock.calls.at(-1);
        expect(title).toBe('WARNING');
        await buttons.find((button) => button.text === 'Confirm').onPress();

        expect(callables.leaveGame).toHaveBeenCalledWith('ROOM1');
        expect(signOut).toHaveBeenCalledTimes(1);
        expect(playerSession.clearPlayerSession).toHaveBeenCalledTimes(1);
        expectResetToJoin(navigation);
        alertSpy.mockRestore();
    });

    it('clears the session and resets to Join when the room doc is gone', async () => {
        onSnapshot.mockImplementation((ref, onNext) => {
            if (ref.path === ROOM_PATH) onNext({ exists: () => false, data: () => undefined });
            return jest.fn();
        });
        const navigation = makeNavigation();
        await renderScreen(navigation);
        await waitFor(() => expect(navigation.reset).toHaveBeenCalled());
        expectResetToJoin(navigation);
        expect(playerSession.clearPlayerSession).toHaveBeenCalled();
    });

    it('clears the session and resets to Join when the player doc is gone', async () => {
        onSnapshot.mockImplementation((ref, onNext) => {
            if (ref.path === ROOM_PATH) {
                onNext({ exists: () => true, data: () => ({ gameStarted: false }) });
            } else if (ref.path === PLAYER_PATH) {
                onNext({ exists: () => false, data: () => undefined });
            }
            return jest.fn();
        });
        const navigation = makeNavigation();
        await renderScreen(navigation);
        await waitFor(() => expect(navigation.reset).toHaveBeenCalled());
        expectResetToJoin(navigation);
        expect(playerSession.clearPlayerSession).toHaveBeenCalled();
    });

    it('clears the session and resets to Join on a subscription error', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        onSnapshot.mockImplementation((ref, onNext, onError) => {
            if (ref.path === ROOM_PATH) onError(new Error('permission-denied'));
            return jest.fn();
        });
        const navigation = makeNavigation();
        await renderScreen(navigation);
        await waitFor(() => expect(navigation.reset).toHaveBeenCalled());
        expectResetToJoin(navigation);
        expect(playerSession.clearPlayerSession).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    // Task 16 QA follow-up: Android's hardware back button isn't covered by
    // RootNavigator.js's gestureEnabled: false (that option is iOS-only —
    // see its comment on the Game screen), because NavigationContainer
    // installs its own global hardwareBackPress listener that pops the
    // stack independent of any per-screen gesture setting. GameScreen must
    // intercept the hardware back press itself and open the same
    // Leave-confirmation dialog the header's Leave button uses, rather than
    // letting it silently pop the screen (same bypass-Leave bug as the iOS
    // swipe-back).
    describe('hardware back button (Task 16 QA)', () => {
        it('opens the Leave confirmation instead of navigating away, and consumes the event', async () => {
            driveSnapshots({
                room: { gameStarted: false, isGameActive: true },
                player: { isAlive: true },
            });
            const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
            const navigation = makeNavigation();
            await renderScreen(navigation);

            let consumed;
            await act(() => {
                consumed = fireHardwareBackPress();
            });

            expect(consumed).toBe(true);
            const [title] = alertSpy.mock.calls.at(-1);
            expect(title).toBe('WARNING');
            expect(navigation.reset).not.toHaveBeenCalled();
            expect(navigation.navigate).not.toHaveBeenCalled();
            alertSpy.mockRestore();
        });

        it('removes the hardwareBackPress listener on unmount', async () => {
            driveSnapshots({
                room: { gameStarted: false, isGameActive: true },
                player: { isAlive: true },
            });
            const { unmount } = await renderScreen();
            expect(hardwareBackPressListeners.length).toBe(1);
            await unmount();
            expect(hardwareBackPressListeners.length).toBe(0);
        });
    });

    describe('location/boundary status (Task 11)', () => {
        const ENABLED_BOUNDARY = { enabled: true, revision: 3, vertices: [] };

        beforeEach(() => {
            Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
            Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
            Location.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
            callables.reportPlayerLocation.mockResolvedValue({ status: 'inside', reason: null });
        });

        it('subscribes to the own status doc and the outside query only once the boundary is enabled, and tears both down once', async () => {
            const listeners = driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true, targets: [] },
            });
            const { unmount } = await renderScreen();
            await waitFor(() =>
                expect(Object.keys(listeners).sort()).toEqual(
                    [
                        ROOM_PATH,
                        PLAYER_PATH,
                        PLAYERS_PATH,
                        TASKS_PATH,
                        MESSAGES_PATH,
                        OWN_STATUS_PATH,
                        OUTSIDE_STATUSES_PATH,
                    ].sort()
                )
            );
            await unmount();
            Object.values(listeners).forEach(({ subscribeCount, unsubscribes }) => {
                expect(subscribeCount).toBe(1);
                expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
            });
        });

        it('does not subscribe to either boundary listener while the boundary is disabled', async () => {
            const listeners = driveSnapshots({
                room: {
                    gameStarted: true,
                    isGameActive: true,
                    gameBoundary: { ...ENABLED_BOUNDARY, enabled: false },
                },
                player: { isAlive: true },
            });
            await renderScreen();
            await waitFor(() => expect(listeners[PLAYER_PATH]?.subscribeCount).toBe(1));
            expect(listeners[OWN_STATUS_PATH]).toBeUndefined();
            expect(listeners[OUTSIDE_STATUSES_PATH]).toBeUndefined();
        });

        it('does NOT leave the game when the own status doc subscription errors', async () => {
            onSnapshot.mockImplementation((ref, onNext, onError) => {
                if (ref.path === ROOM_PATH) {
                    onNext({
                        exists: () => true,
                        data: () => ({
                            gameStarted: true,
                            isGameActive: true,
                            gameBoundary: ENABLED_BOUNDARY,
                        }),
                    });
                } else if (ref.path === PLAYER_PATH) {
                    onNext({ exists: () => true, data: () => ({ isAlive: true }) });
                } else if (ref.path === OWN_STATUS_PATH || ref.path === OUTSIDE_STATUSES_PATH) {
                    onError(new Error('permission-denied'));
                } else {
                    onNext({ docs: [], docChanges: () => [] });
                }
                return jest.fn();
            });
            const navigation = makeNavigation();
            const { findByText } = await renderScreen(navigation);
            // Still on the game screen, showing the no-status-yet state.
            await findByText('Enable Location');
            expect(navigation.reset).not.toHaveBeenCalled();
            expect(playerSession.clearPlayerSession).not.toHaveBeenCalled();
        });

        it('renders the live status derived from the own status doc', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
                ownStatus: {
                    status: 'outside',
                    reason: null,
                    lastUsableReceivedAt: ts(Date.now()),
                    boundaryRevision: 3,
                },
            });
            const { findByText } = await renderScreen();
            await findByText(
                'You are outside the game area — your location is visible to everyone until you return.'
            );
        });

        it('shows a stale own status as unavailable', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
                ownStatus: {
                    status: 'inside',
                    reason: null,
                    lastUsableReceivedAt: ts(Date.now() - 120000),
                    boundaryRevision: 3,
                },
            });
            const { findByText, queryByText } = await renderScreen();
            // permissionState is still 'unknown', so the unavailable box is
            // suppressed and the prompt shows instead — and never "inside".
            await findByText('Enable Location');
            expect(queryByText('In game area.')).toBeNull();
        });

        it('hides the panel for an eliminated player', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: false },
            });
            const { findByText, queryByText } = await renderScreen();
            await findByText("YOU'VE BEEN ELIMINATED");
            expect(queryByText('Enable Location')).toBeNull();
        });

        it('requests a location fix and reports it once granted', async () => {
            let deliverFix;
            Location.watchPositionAsync.mockImplementation(async (options, onSuccess) => {
                deliverFix = onSuccess;
                return { remove: jest.fn() };
            });
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
            });
            const { getByRole } = await renderScreen();

            await fireEvent.press(getByRole('button', { name: 'Enable Location' }));
            await waitFor(() => expect(deliverFix).toBeDefined());
            await act(async () => {
                deliverFix({
                    coords: { latitude: 40, longitude: -74, accuracy: 10 },
                    timestamp: Date.now(),
                });
            });

            expect(callables.reportPlayerLocation).toHaveBeenCalledWith(
                expect.objectContaining({ roomId: 'ROOM1', boundaryRevision: 3, lat: 40 })
            );
        });
    });

    // GameMapModal.js itself (presentational, no Firebase of its own) has
    // its own full test suite — these only cover the wiring this file owns:
    // the Map tab (one of the five Clash-Royale-style pages, always
    // present — see BottomTabBar.test.js for why it's never hidden/
    // disabled), and handleShowPings threading a ping card's positions
    // through to the real map page. 'react-native-maps' is replaced
    // project-wide by mobile/__mocks__/react-native-maps.js (no native
    // module exists under Jest), whose MapView/Marker render as plain
    // Views carrying their testID/children straight through.
    describe('map (Task 12)', () => {
        const ENABLED_BOUNDARY = { enabled: true, revision: 1, vertices: [{ lat: 1, lng: 2 }] };

        beforeEach(() => {
            Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
            Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
            Location.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
        });

        it('shows a "zones not enabled" message on the Map page when the boundary is disabled, rather than hiding the tab', async () => {
            driveSnapshots({
                room: {
                    gameStarted: true,
                    isGameActive: true,
                    gameBoundary: { ...ENABLED_BOUNDARY, enabled: false },
                },
                player: { isAlive: true },
            });
            const { findByLabelText, findByText, queryByTestId } = await renderScreen();

            await fireEvent.press(await findByLabelText('Map'));

            expect(await findByText("Zones aren't enabled for this game.")).toBeTruthy();
            expect(queryByTestId('game-map-view')).toBeNull();
        });

        it('switches to the map page from the Map tab, and away again from the Chat tab', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
            });
            const { findByLabelText, queryByTestId } = await renderScreen();
            expect(queryByTestId('game-map-view')).toBeNull();

            await fireEvent.press(await findByLabelText('Map'));
            await waitFor(() => expect(queryByTestId('game-map-view')).toBeTruthy());

            await fireEvent.press(await findByLabelText('Chat'));
            await waitFor(() => expect(queryByTestId('game-map-view')).toBeNull());
        });

        it('disables page-swiping only while the Map page is showing, so it never fights a real device MapView for horizontal drags', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
            });
            const { findByLabelText, findByTestId } = await renderScreen();
            expect((await findByTestId('game-pager')).props.scrollEnabled).toBe(true);

            await fireEvent.press(await findByLabelText('Map'));
            expect((await findByTestId('game-pager')).props.scrollEnabled).toBe(false);

            await fireEvent.press(await findByLabelText('Chat'));
            expect((await findByTestId('game-pager')).props.scrollEnabled).toBe(true);
        });

        it('opens the map with a ping card\'s positions via "View on map"', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
                messages: [
                    {
                        type: 'powerUpPing',
                        text: 'Someone pinged',
                        source: 'shopPurchase',
                        pings: [{ name: 'carol', lat: 5, lng: 6, capturedAtMs: Date.now() }],
                    },
                ],
            });

            const { findByLabelText, findByTestId, findByText } = await renderScreen();
            await fireEvent.press(await findByLabelText('View on map'));
            await findByTestId('game-map-view');
            expect(await findByText('📍 carol')).toBeTruthy();
        });

        it('clears the ping snapshot once the player leaves the map page, rather than keeping it forever', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
                messages: [
                    {
                        type: 'powerUpPing',
                        text: 'Someone pinged',
                        source: 'shopPurchase',
                        pings: [{ name: 'carol', lat: 5, lng: 6, capturedAtMs: Date.now() }],
                    },
                ],
            });

            const { findByLabelText, findByText, queryByText } = await renderScreen();
            await fireEvent.press(await findByLabelText('View on map'));
            expect(await findByText('📍 carol')).toBeTruthy();

            await fireEvent.press(await findByLabelText('Chat'));
            await fireEvent.press(await findByLabelText('Map'));
            expect(queryByText('📍 carol')).toBeNull();
        });

        it('does not offer "View on map" once the game has ended', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: false, gameBoundary: ENABLED_BOUNDARY },
                player: { isAlive: true },
                messages: [
                    {
                        type: 'powerUpPing',
                        text: 'Someone pinged',
                        source: 'shopPurchase',
                        pings: [{ name: 'carol', lat: 5, lng: 6, capturedAtMs: Date.now() }],
                    },
                ],
            });

            const { queryByLabelText, findByText } = await renderScreen();
            await findByText('Someone pinged');
            expect(queryByLabelText('View on map')).toBeNull();
        });
    });

    // The Clash-Royale-style redesign: five swipeable pages behind a fixed
    // bottom tab bar (BottomTabBar.js), with only the center/chat page
    // carrying the header/Leave/Rules/avatar chrome — the player's own
    // framing was "leave header for the main chat alone... if u open up
    // missions/leaderboard/map, u cant see those things anwyays."
    describe('swipeable pages (Clash-Royale-style redesign)', () => {
        it('starts on the chat page, with the header visible', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true },
                player: { isAlive: true, targets: [] },
            });
            const { findByText } = await renderScreen();
            expect(await findByText('Lobby ROOM1')).toBeTruthy();
        });

        it('hides the header/Leave/Rules chrome on the Shop, Missions, Leaderboard, and Map pages', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true },
                player: { isAlive: true, targets: [] },
            });
            const { findByLabelText, queryByText, queryByLabelText } = await renderScreen();

            for (const tabLabel of ['Shop', 'Missions', 'Leaderboard', 'Map']) {
                await fireEvent.press(await findByLabelText(tabLabel));
                expect(queryByText('Lobby ROOM1')).toBeNull();
                expect(queryByLabelText('Leave')).toBeNull();
                expect(queryByLabelText('Game rules')).toBeNull();
            }
        });

        it('shows the Shop tab even before the game has started or after the player is eliminated', async () => {
            driveSnapshots({
                room: { gameStarted: false, isGameActive: true },
                player: { isAlive: false, targets: [] },
            });
            const { findByLabelText, findAllByText } = await renderScreen();

            await fireEvent.press(await findByLabelText('Shop'));
            // Both the tab bar's own label and the page's header title read
            // "Shop" — findAllByText proves the page actually mounted
            // alongside its tab, not just the tab itself.
            expect(await findAllByText('Shop')).toHaveLength(2);
        });

        it('switches to the Missions and Leaderboard pages from their own tabs', async () => {
            driveSnapshots({
                room: { gameStarted: true, isGameActive: true },
                player: { isAlive: true, targets: [], score: 42 },
            });
            const { findByLabelText, findByText, findAllByText } = await renderScreen();

            // Both the tab bar's own label and the page's header title read
            // "Missions"/"Leaderboard" — findAllByText proves the page
            // actually mounted alongside its tab, not just the tab itself.
            await fireEvent.press(await findByLabelText('Missions'));
            expect(await findByText('Active (0)')).toBeTruthy();
            expect(await findAllByText('Missions')).toHaveLength(2);

            await fireEvent.press(await findByLabelText('Leaderboard'));
            expect(await findAllByText('Leaderboard')).toHaveLength(2);
        });
    });
});
