import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
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
const driveSnapshots = ({ room, player }) => {
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
        } else {
            onNext({ docs: [] });
        }
        return unsubscribe;
    });
    return listeners;
};

const renderScreen = (navigation = { navigate: jest.fn() }) =>
    render(<GameScreen route={{ params: { roomID: 'ROOM1' } }} navigation={navigation} />);

beforeEach(() => {
    jest.clearAllMocks();
    tagRefsByPath();
    playerSession.readPlayerSession.mockResolvedValue({ roomID: 'ROOM1', playerName: 'Alice' });
    playerSession.clearPlayerSession.mockResolvedValue(undefined);
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
                [ROOM_PATH, PLAYER_PATH, PLAYERS_PATH, TASKS_PATH].sort()
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
        const navigate = jest.fn();
        const { getByLabelText } = await renderScreen({ navigate });

        await fireEvent.press(getByLabelText('Leave'));
        const [title, , buttons] = alertSpy.mock.calls.at(-1);
        expect(title).toBe('WARNING');
        await buttons.find((button) => button.text === 'Confirm').onPress();

        expect(callables.leaveGame).toHaveBeenCalledWith('ROOM1');
        expect(signOut).toHaveBeenCalledTimes(1);
        expect(playerSession.clearPlayerSession).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('Join');
        alertSpy.mockRestore();
    });

    it('clears the session and returns to Join when the room doc is gone', async () => {
        onSnapshot.mockImplementation((ref, onNext) => {
            if (ref.path === ROOM_PATH) onNext({ exists: () => false, data: () => undefined });
            return jest.fn();
        });
        const navigate = jest.fn();
        await renderScreen({ navigate });
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('Join'));
        expect(playerSession.clearPlayerSession).toHaveBeenCalled();
    });
});
