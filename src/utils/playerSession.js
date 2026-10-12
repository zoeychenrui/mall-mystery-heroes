// A small localStorage wrapper for remembering "I'm <name> in room <id>"
// across tab closes
// (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
// The storage backend is an injectable parameter, not read from `window`
// internally, so this stays testable under the `unit` (node, no DOM)
// project rather than requiring jsdom.
const PLAYER_SESSION_KEY = 'mmh:player-session';

export const readPlayerSession = (storage = window.localStorage) => {
    const stored = storage.getItem(PLAYER_SESSION_KEY);
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

export const writePlayerSession = (roomID, playerName, storage = window.localStorage) => {
    storage.setItem(PLAYER_SESSION_KEY, JSON.stringify({ roomID, playerName }));
};

export const clearPlayerSession = (storage = window.localStorage) => {
    storage.removeItem(PLAYER_SESSION_KEY);
};
