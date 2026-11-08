import { render, fireEvent } from '@testing-library/react-native';
import JoinScreen from './JoinScreen';

// firebaseConfig.js calls initializeAuth(..., { persistence: getReactNativePersistence(...) })
// at module load time. Under Jest, 'firebase/auth' resolves to its browser
// build rather than the React Native build (the top-level `firebase`
// package's own "./auth" export map has no "react-native" condition, only
// the nested @firebase/auth package does) — getReactNativePersistence is
// undefined there and the module-level call throws the instant anything
// imports firebaseConfig.js. Mock the firebase-touching modules so this
// stays a pure unit test of JoinScreen's own rendering/input logic, same
// spirit as CLAUDE.md's "never import dbCalls.js/utils/firebase.js from a
// unit test" rule for the web app.
jest.mock('../firebase/firebaseConfig', () => ({
    auth: { currentUser: { uid: 'test-uid' } },
}));
jest.mock('firebase/auth', () => ({
    signInAnonymously: jest.fn(),
}));
jest.mock('../firebase/callables', () => ({
    joinRoom: jest.fn(),
    requestReconnect: jest.fn(),
}));
jest.mock('../utils/playerSession', () => ({
    writePlayerSession: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
    getDocs: jest.fn(),
}));
jest.mock('../firebase/dbCalls', () => ({
    fetchPlayerByUidQueryForRoom: jest.fn(() => 'the-query'),
}));

const callables = require('../firebase/callables');
const playerSession = require('../utils/playerSession');
const { getDocs } = require('firebase/firestore');
const dbCalls = require('../firebase/dbCalls');

// A fake QuerySnapshot shaped like what getDocs resolves to — only `.docs`
// is read by JoinScreen.js's recovery branch.
const snapshotWithDocs = (...datas) => ({
    docs: datas.map((data) => ({ data: () => data })),
});

describe('JoinScreen', () => {
    // Without this, mock.calls accumulate across tests in this file (no
    // global clearMocks is configured in jest.config.js) — the "fails
    // safely" tests below assert writePlayerSession/navigate were NOT
    // called, which only means something with a clean slate per test.
    beforeEach(() => {
        jest.clearAllMocks();
    });


    // @testing-library/react-native v14's `render` and `fireEvent` are both
    // async by default now (see its "Migration to 14.0" notes) — await
    // both rather than destructuring/reading off an unresolved Promise.
    it('uppercases the room code as typed, matching the web app', async () => {
        const { getByPlaceholderText } = await render(
            <JoinScreen navigation={{ navigate: jest.fn() }} />
        );
        const input = getByPlaceholderText('Game ID');
        await fireEvent.changeText(input, 'abc123');
        expect(input.props.value).toBe('ABC123');
    });

    // Real-device repro (Task 16 QA): a player swipes back out of the Game
    // screen (bypassing Leave) and tries rejoining with the same name after
    // the game has started. joinRoom.js throws
    // HttpsError('failed-precondition', 'This game has already started.'),
    // but the mobile app's firebase SDK (^13.2.0) appends the raw HTTP
    // status to that message inside @firebase/functions'
    // _errorForResponse — e.g. "This game has already started. [400]" — so
    // an exact string match against the bare backend message fails. This
    // must still fall through to the reconnect-request fallback rather
    // than surfacing the raw error.
    it('falls back to requestReconnect when joinRoom fails with an already-started error whose message was reformatted by the SDK', async () => {
        const alreadyStartedError = new Error('This game has already started. [400]');
        alreadyStartedError.code = 'functions/failed-precondition';
        callables.joinRoom.mockRejectedValueOnce(alreadyStartedError);
        callables.requestReconnect.mockResolvedValueOnce({ requestId: 'req-1' });
        const navigate = jest.fn();

        const { getByPlaceholderText, getByText } = await render(
            <JoinScreen navigation={{ navigate }} />
        );
        await fireEvent.changeText(getByPlaceholderText('Game ID'), 'abc123');
        await fireEvent.changeText(getByPlaceholderText('Your name'), 'Alice');
        await fireEvent.press(getByText('Join'));

        expect(callables.requestReconnect).toHaveBeenCalledWith('ABC123', 'Alice');
        expect(navigate).toHaveBeenCalledWith('ReconnectPending', {
            roomID: 'ABC123',
            requestId: 'req-1',
        });
    });

    // Deeper real-device repro (Task 16 QA follow-up): the player never
    // actually left — they swiped back out of GameScreen, which (before
    // this fix) bypassed the Leave flow entirely, so their uid stayed in
    // the room's joinedUids and their stored session stayed intact. The
    // above fallback kicks in exactly as before, but requestReconnect.js's
    // own joinedUids guard then rejects it too, because this device is
    // already a valid player — not someone who needs a reconnect link. That
    // rejection must be treated as a successful rejoin, not surfaced as an
    // error. Error shape matches requestReconnect.js's real
    // HttpsError('failed-precondition', 'This device is already signed in
    // as a player in this room.'), with the mobile SDK's own "[status]"
    // suffix appended (same reformatting as the "already started" case).
    it('rejoins automatically when requestReconnect reports the device is already a valid player', async () => {
        const alreadyStartedError = new Error('This game has already started. [400]');
        alreadyStartedError.code = 'functions/failed-precondition';
        callables.joinRoom.mockRejectedValueOnce(alreadyStartedError);
        const alreadyAPlayerError = new Error(
            'This device is already signed in as a player in this room. [400]'
        );
        alreadyAPlayerError.code = 'functions/failed-precondition';
        callables.requestReconnect.mockRejectedValueOnce(alreadyAPlayerError);
        getDocs.mockResolvedValueOnce(snapshotWithDocs({ name: 'Alice' }));
        const navigate = jest.fn();

        const { getByPlaceholderText, getByText, queryByText } = await render(
            <JoinScreen navigation={{ navigate }} />
        );
        await fireEvent.changeText(getByPlaceholderText('Game ID'), 'abc123');
        await fireEvent.changeText(getByPlaceholderText('Your name'), 'Alice');
        await fireEvent.press(getByText('Join'));

        expect(callables.requestReconnect).toHaveBeenCalledWith('ABC123', 'Alice');
        expect(dbCalls.fetchPlayerByUidQueryForRoom).toHaveBeenCalledWith('test-uid', 'ABC123');
        expect(playerSession.writePlayerSession).toHaveBeenCalledWith('ABC123', 'Alice');
        expect(navigate).toHaveBeenCalledWith('Game', { roomID: 'ABC123' });
        expect(queryByText(alreadyAPlayerError.message)).toBeNull();
    });

    // The actual vulnerability this recovery branch was exploitable for:
    // requestReconnect.js's "already signed in" guard fires purely off the
    // caller's OWN uid — it never checks the typed `playerName` against it.
    // An already-joined player could type a DIFFERENT real in-room player's
    // name (visible on the leaderboard) and land in Game under that other
    // player's identity, reading their targets/mission state/kill photos.
    // The fix: look up which player doc this uid actually owns and use ITS
    // stored `name`, never the typed string. Typed name and owned name
    // deliberately differ here — the owned one must win.
    it('uses the uid-owned player doc name, not the typed name, when they differ', async () => {
        const alreadyStartedError = new Error('This game has already started. [400]');
        alreadyStartedError.code = 'functions/failed-precondition';
        callables.joinRoom.mockRejectedValueOnce(alreadyStartedError);
        const alreadyAPlayerError = new Error(
            'This device is already signed in as a player in this room. [400]'
        );
        alreadyAPlayerError.code = 'functions/failed-precondition';
        callables.requestReconnect.mockRejectedValueOnce(alreadyAPlayerError);
        getDocs.mockResolvedValueOnce(snapshotWithDocs({ name: 'RealOwner' }));
        const navigate = jest.fn();

        const { getByPlaceholderText, getByText } = await render(
            <JoinScreen navigation={{ navigate }} />
        );
        await fireEvent.changeText(getByPlaceholderText('Game ID'), 'abc123');
        // Typed as someone else's name — e.g. an already-joined player
        // probing another real player visible on the leaderboard.
        await fireEvent.changeText(getByPlaceholderText('Your name'), 'SomeoneElse');
        await fireEvent.press(getByText('Join'));

        expect(playerSession.writePlayerSession).toHaveBeenCalledWith('ABC123', 'RealOwner');
        expect(playerSession.writePlayerSession).not.toHaveBeenCalledWith(
            'ABC123',
            'SomeoneElse'
        );
        expect(navigate).toHaveBeenCalledWith('Game', { roomID: 'ABC123' });
    });

    // Zero docs (the "already signed in" guard and this lookup disagree
    // about reality) or more than one (this uid somehow owns two player
    // docs in the room) are both states this recovery branch has no safe
    // guess for — it must fail into the normal error path instead of
    // picking a name.
    it.each([
        ['zero matching docs', []],
        ['more than one matching doc', [{ name: 'Alice' }, { name: 'AliceAgain' }]],
    ])('falls through to the error message when getDocs returns %s', async (_label, datas) => {
        const alreadyStartedError = new Error('This game has already started. [400]');
        alreadyStartedError.code = 'functions/failed-precondition';
        callables.joinRoom.mockRejectedValueOnce(alreadyStartedError);
        const alreadyAPlayerError = new Error(
            'This device is already signed in as a player in this room. [400]'
        );
        alreadyAPlayerError.code = 'functions/failed-precondition';
        callables.requestReconnect.mockRejectedValueOnce(alreadyAPlayerError);
        getDocs.mockResolvedValueOnce(snapshotWithDocs(...datas));
        const navigate = jest.fn();

        const { getByPlaceholderText, getByText, findByText } = await render(
            <JoinScreen navigation={{ navigate }} />
        );
        await fireEvent.changeText(getByPlaceholderText('Game ID'), 'abc123');
        await fireEvent.changeText(getByPlaceholderText('Your name'), 'Alice');
        await fireEvent.press(getByText('Join'));

        expect(await findByText(alreadyAPlayerError.message)).toBeTruthy();
        expect(playerSession.writePlayerSession).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalledWith('Game', { roomID: 'ABC123' });
    });
});
