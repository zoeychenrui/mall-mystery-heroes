// AsyncStorage wrapper for remembering "I'm <name> in room <id>" across app
// restarts. Mirrors the web app's src/utils/playerSession.js (same key, same
// JSON shape and validation), but async, because AsyncStorage's API is
// promise-based. The storage backend is an injectable parameter so the tests
// can supply a fake without touching the native module.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PLAYER_SESSION_KEY = 'mmh:player-session';

export const readPlayerSession = async (storage = AsyncStorage) => {
    const stored = await storage.getItem(PLAYER_SESSION_KEY);
    if (!stored) return null;
    try {
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed.roomID !== 'string' || typeof parsed.playerName !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
};

export const writePlayerSession = async (roomID, playerName, storage = AsyncStorage) => {
    await storage.setItem(PLAYER_SESSION_KEY, JSON.stringify({ roomID, playerName }));
};

export const clearPlayerSession = async (storage = AsyncStorage) => {
    await storage.removeItem(PLAYER_SESSION_KEY);
};
