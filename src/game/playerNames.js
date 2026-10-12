/**
 * The single normalization every player-name comparison in this codebase
 * must use. Strips all whitespace, not just leading/trailing — a name typed
 * via the command bar's bracket syntax (`/kill [Alice Smith] bob`) keeps its
 * internal space, while the stored `trimmedNameLowerCase` key does not
 * (docs/data-model.md). A plain `.toLowerCase()` on one side and this on the
 * other silently fails to match on any multi-word name (docs/improvements.md
 * item 35).
 *
 * CommonJS export — see targetGraph.js's header comment; this file is also
 * `require()`d by the Cloud Function in functions/callableFunctions/
 * killPlayer.js (docs/improvements.md item 4).
 */
const normalizePlayerName = (name) => name.replace(/\s/g, '').toLowerCase();

/**
 * Looks a name up against `players` by normalized match and returns the
 * player's actual stored casing — e.g. "alicesmith" -> "Alice Smith". Chat
 * log text and other player-facing display strings should always go
 * through this rather than showing a normalized name directly; normalized
 * names exist for matching/lookup, not for a GM to read. Falls back to the
 * input unchanged if no player matches, so a caller that already validated
 * membership can use this unconditionally.
 */
const resolvePlayerDisplayName = (name, players) => {
    const key = normalizePlayerName(name);
    const match = players.find((player) => normalizePlayerName(player.name) === key);
    return match ? match.name : name;
};

module.exports = { normalizePlayerName, resolvePlayerDisplayName };
