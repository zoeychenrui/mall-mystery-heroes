import { readPlayerSession, writePlayerSession, clearPlayerSession } from './playerSession';

const createFakeStorage = () => {
    const store = {};
    return {
        getItem: async (key) => (key in store ? store[key] : null),
        setItem: async (key, value) => { store[key] = value; },
        removeItem: async (key) => { delete store[key]; },
    };
};

describe('playerSession', () => {
    it('returns null when nothing is stored', async () => {
        await expect(readPlayerSession(createFakeStorage())).resolves.toBeNull();
    });

    it('round-trips a written session', async () => {
        const storage = createFakeStorage();
        await writePlayerSession('Fluffy42317', 'Alice', storage);
        await expect(readPlayerSession(storage)).resolves.toEqual({
            roomID: 'Fluffy42317',
            playerName: 'Alice',
        });
    });

    it('clears a stored session', async () => {
        const storage = createFakeStorage();
        await writePlayerSession('Fluffy42317', 'Alice', storage);
        await clearPlayerSession(storage);
        await expect(readPlayerSession(storage)).resolves.toBeNull();
    });

    it('returns null for malformed JSON instead of throwing', async () => {
        const storage = createFakeStorage();
        await storage.setItem('mmh:player-session', 'not valid json{{{');
        await expect(readPlayerSession(storage)).resolves.toBeNull();
    });

    it('returns null when the stored value is missing expected fields', async () => {
        const storage = createFakeStorage();
        await storage.setItem('mmh:player-session', JSON.stringify({ roomID: 'Fluffy42317' }));
        await expect(readPlayerSession(storage)).resolves.toBeNull();
    });
});
