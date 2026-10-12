/**
 * Layer 1b — the player self-registration Cloud Function, against the
 * real Functions, Firestore, and Auth emulators together.
 *
 * Run with `npm run test:emulator`. `joinRoom` is a thin wrapper around
 * `httpsCallable(functions, 'joinRoom')` — these tests call it exactly
 * the way a real player's device would, then assert on what actually
 * landed in Firestore, matching executeKill.integration.test.js's own
 * stance (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 */
import { joinRoom } from './joinRoom';
import { fetchPlayerForRoom } from './firebase_calls/dbCalls';
import { auth, db } from '../utils/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { clearFirestore, seedRoom, shutdown } from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('joinRoom', () => {
    it('adds a new player to a room still in its Lobby phase, recording who joined', async () => {
        await seedRoom(ROOM, []);

        await joinRoom(ROOM, 'Alice');

        const player = await fetchPlayerForRoom('alice', ROOM);
        expect(player.data()).toMatchObject({
            name: 'Alice',
            trimmedNameLowerCase: 'alice',
            isAlive: true,
            score: 10,
            targets: [],
            assassins: [],
            uid: auth.currentUser.uid,
        });

        const room = await getDoc(doc(db, 'rooms', ROOM));
        expect(room.data().joinedUids).toContain(auth.currentUser.uid);
    });

    it('rejects joining a room that does not exist', async () => {
        // seedRoom (for an unrelated room) is what actually signs in the
        // shared auth singleton the first time — calling it here keeps
        // this test self-contained rather than relying on an earlier test
        // in the file to have done so first, matching every test in
        // executeKill.integration.test.js.
        await seedRoom('some-other-room', []);

        await expect(joinRoom('nonexistent-room', 'Alice')).rejects.toThrow(
            'Room not found: nonexistent-room'
        );
    });

    it('rejects joining a room whose game has already started', async () => {
        await seedRoom(ROOM, [], { gameStarted: true });

        await expect(joinRoom(ROOM, 'Alice')).rejects.toThrow('This game has already started.');
    });

    it('rejects a duplicate name, case- and whitespace-insensitively', async () => {
        await seedRoom(ROOM, ['Alice']);

        await expect(joinRoom(ROOM, '  alice  ')).rejects.toThrow(/already taken/);
    });

    it('rejects a second join from the same uid under a different name in the same room (docs/improvements.md item 66)', async () => {
        await seedRoom(ROOM, []);
        await joinRoom(ROOM, 'Alice');

        await expect(joinRoom(ROOM, 'Bob')).rejects.toThrow(
            'You have already joined this room as Alice.'
        );

        await expect(fetchPlayerForRoom('bob', ROOM)).rejects.toThrow('Player not found');
    });

    it('still allows the same uid to join a different room under a new name', async () => {
        await seedRoom(ROOM, []);
        await seedRoom('some-other-room', []);
        await joinRoom(ROOM, 'Alice');

        // joinRoom resolves to undefined on success — the assertion here
        // is that this does not reject, not on the resolved value itself.
        await joinRoom('some-other-room', 'Alice');

        const player = await fetchPlayerForRoom('alice', 'some-other-room');
        expect(player.data()).toMatchObject({ name: 'Alice' });
    });

    it('rejects a roomId containing "/" rather than silently resolving to an unintended document', async () => {
        await seedRoom('some-other-room', []);

        await expect(joinRoom('SomeRoom/players/alice', 'Alice')).rejects.toThrow(
            'roomId must not contain "/".'
        );
    });

    it('rejects an all-whitespace playerName instead of crashing on doc("")', async () => {
        await seedRoom(ROOM, []);

        await expect(joinRoom(ROOM, '   ')).rejects.toThrow(
            'roomId and playerName are both required.'
        );
    });

    it('rejects joining a room the GM has already ended', async () => {
        await seedRoom(ROOM, [], { isGameActive: false, endedAt: new Date() });

        await expect(joinRoom(ROOM, 'Alice')).rejects.toThrow('This room is no longer active.');
    });
});
