import { readPlayerSession, writePlayerSession, clearPlayerSession } from './playerSession';

// A minimal in-memory stand-in for the Storage interface, passed explicitly
// so these tests run under the `unit` project (node, no DOM) rather than
// needing jsdom's real `localStorage` — the same "inject rather than reach
// for a global" precedent CLAUDE.md already establishes for `Math.random()`
// in src/game/.
const createFakeStorage = () => {
    const store = {};
    return {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => {
            store[key] = value;
        },
        removeItem: (key) => {
            delete store[key];
        },
    };
};

describe('playerSession', () => {
    it('returns null when nothing is stored', () => {
        expect(readPlayerSession(createFakeStorage())).toBeNull();
    });

    it('round-trips a written session', () => {
        const storage = createFakeStorage();
        writePlayerSession('Fluffy42317', 'Alice', storage);

        expect(readPlayerSession(storage)).toEqual({
            roomID: 'Fluffy42317',
            playerName: 'Alice',
        });
    });

    it('clears a stored session', () => {
        const storage = createFakeStorage();
        writePlayerSession('Fluffy42317', 'Alice', storage);
        clearPlayerSession(storage);

        expect(readPlayerSession(storage)).toBeNull();
    });

    it('returns null for malformed JSON instead of throwing', () => {
        const storage = createFakeStorage();
        storage.setItem('mmh:player-session', 'not valid json{{{');

        expect(readPlayerSession(storage)).toBeNull();
    });

    it('returns null when the stored value is missing expected fields', () => {
        const storage = createFakeStorage();
        storage.setItem('mmh:player-session', JSON.stringify({ roomID: 'Fluffy42317' }));

        expect(readPlayerSession(storage)).toBeNull();
    });
});
