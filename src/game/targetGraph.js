/**
 * The target-assignment rules, as pure functions.
 *
 * Previously this logic existed in three places — `TargetGenerator.js`,
 * `ResetTargetsButton.js`, and (in a differently-shaped variant)
 * `RemapPlayers.js` — each inside a React closure, each entangled with
 * Firestore writes. Nothing here touches Firebase or React: callers pass a
 * roster in and get a plan out, then hand that plan to the data layer.
 *
 * Randomness arrives as an `rng` parameter so tests can pin it.
 *
 * CommonJS exports, not `export`/`import` — this file (and remapPlan.js,
 * which depends on it) is also `require()`d directly by the Cloud Function
 * in functions/callableFunctions/killPlayer.js (docs/improvements.md item 4),
 * which runs under plain Node with no build step. Every existing `import`
 * of this file on the client side keeps working unchanged: webpack's
 * CommonJS interop resolves named imports against `module.exports` the
 * same way it would against a real ES module.
 */

/**
 * How many targets each player should hold, given the roster size.
 * Clamped to `playerCount - 1` so a 1- or 2-player room is representable.
 */
const maxTargetsFor = (playerCount) => {
    const desired = playerCount > 15 ? 3 : playerCount > 5 ? 2 : 1;
    return Math.max(0, Math.min(desired, playerCount - 1));
};

/**
 * Fisher–Yates (Durstenfeld), on a copy.
 *
 * The three previous copies iterated forward and stopped at `length - 1`,
 * which left the final element pinned in its starting position — for a
 * 3-element array only 2 of the 6 orderings were reachable.
 */
const shuffle = (array, rng = Math.random) => {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

/**
 * Builds the initial target graph by laying the shuffled roster out in a ring
 * and having each player hunt the next `maxTargets` players clockwise.
 *
 * This replaces the previous index-walking search, which could fail to place a
 * target at all (the `had to break for ${currPlayer}` path) and left players
 * with uneven target counts. The ring gives, by construction:
 *
 *   - exactly `maxTargets` targets and `maxTargets` assassins per player
 *   - no self-targeting
 *   - no mutual pairs, whenever `2 * maxTargets < playerCount`
 *
 * @returns {{targets: Record<string,string[]>, assassins: Record<string,string[]>}}
 */
const buildTargetGraph = (players, { rng = Math.random } = {}) => {
    const ring = shuffle(players, rng);
    const count = ring.length;
    const maxTargets = maxTargetsFor(count);

    const targets = {};
    const assassins = {};
    for (const player of players) {
        targets[player] = [];
        assassins[player] = [];
    }

    for (let i = 0; i < count; i++) {
        const hunter = ring[i];
        for (let step = 1; step <= maxTargets; step++) {
            const victim = ring[(i + step) % count];
            targets[hunter].push(victim);
            assassins[victim].push(hunter);
        }
    }

    return { targets, assassins };
};

/**
 * Every alive player currently short of the room's normal per-player
 * target/assassin count for its current size — not just a single named
 * player. Used to spread a revival's new connections across whoever
 * actually needs one, rather than asking planRemap to fill only the
 * returning player's own gap, which lets it pile every new link onto
 * whichever one or two candidates happen to have room, leaving the rest
 * of the roster untouched and those candidates over their normal cap.
 *
 * @param roster alive players: [{ name, targets: string[], assassins: string[] }]
 * @returns {{needTargets: string[], needAssassins: string[]}}
 */
const playersNeedingConnections = (roster) => {
    const maxTargets = maxTargetsFor(roster.length);
    return {
        needTargets: roster
            .filter((player) => player.targets.length < maxTargets)
            .map((player) => player.name),
        needAssassins: roster
            .filter((player) => player.assassins.length < maxTargets)
            .map((player) => player.name),
    };
};

module.exports = { maxTargetsFor, shuffle, buildTargetGraph, playersNeedingConnections };
