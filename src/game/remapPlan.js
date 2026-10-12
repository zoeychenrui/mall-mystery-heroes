const { maxTargetsFor, shuffle } = require('./targetGraph');

/**
 * Works out who should hunt whom after a kill or a revival, and returns a plan.
 * It performs no I/O.
 *
 * The previous implementation (`components/RemapPlayers.js`) issued a
 * `fetchPlayerForRoom` per candidate inside a nested loop and wrote to
 * Firestore mid-decision, so a single kill in a 20-player game could cost
 * dozens of round trips and could not be tested without a Firestore fake.
 * Here the caller fetches the alive roster once, passes it in, and hands the
 * resulting writes to the data layer — ideally as one batch.
 *
 * CommonJS require/exports — see targetGraph.js's header comment; this file
 * is also `require()`d by the Cloud Function in
 * functions/callableFunctions/killPlayer.js (docs/improvements.md item 4).
 *
 * @param roster       alive players: [{ name, targets: string[], assassins: string[] }]
 * @param needTargets  names that are short of targets
 * @param needAssassins names that are short of assassins
 * @returns {{
 *   writes: {player: string, targets: string[], assassins: string[]}[],
 *   added: {targets: Record<string,string[]>, assassins: Record<string,string[]>},
 *   logs: string[]
 * }}
 */
const planRemap = (roster, { needTargets = [], needAssassins = [], rng = Math.random } = {}) => {
    const maxTargets = maxTargetsFor(roster.length);

    // Local mutable copy: assignments made for one player must be visible to
    // the next, otherwise a candidate can be over-subscribed within one plan.
    const state = new Map(
        roster.map((player) => [
            player.name,
            { targets: [...player.targets], assassins: [...player.assassins] },
        ])
    );

    const touched = new Set();
    const added = { targets: {}, assassins: {} };
    const logs = [];

    const link = (hunter, victim) => {
        state.get(hunter).targets.push(victim);
        state.get(victim).assassins.push(hunter);
        touched.add(hunter);
        touched.add(victim);
        logs.push(`New target for ${hunter}: ${victim}`);
    };

    /**
     * Candidates in preference order: a random pass over players that satisfy
     * every rule, then — only if the player is still short — a pass ordered by
     * fewest assassins that relaxes the saturation rule. Relaxing beats
     * leaving a player with nothing to hunt.
     */
    const candidatesForTarget = (player) => {
        const alive = [...state.keys()];
        const eligible = shuffle(alive, rng).filter((name) => {
            const candidate = state.get(name);
            return (
                name !== player &&
                !state.get(player).targets.includes(name) &&
                !candidate.targets.includes(player) &&
                candidate.assassins.length < maxTargets
            );
        });

        const fallback = alive
            .filter((name) => name !== player && !state.get(player).targets.includes(name))
            .sort((a, b) => state.get(a).assassins.length - state.get(b).assassins.length);

        return [...eligible, ...fallback];
    };

    const candidatesForAssassin = (player) => {
        const alive = [...state.keys()];
        const eligible = shuffle(alive, rng).filter((name) => {
            const candidate = state.get(name);
            return (
                name !== player &&
                !state.get(player).assassins.includes(name) &&
                !candidate.assassins.includes(player) &&
                candidate.targets.length < maxTargets
            );
        });

        const fallback = alive
            .filter((name) => name !== player && !state.get(player).assassins.includes(name))
            .sort((a, b) => state.get(a).targets.length - state.get(b).targets.length);

        return [...eligible, ...fallback];
    };

    for (const player of needTargets) {
        if (!state.has(player)) continue;
        const before = [...state.get(player).targets];

        for (const candidate of candidatesForTarget(player)) {
            if (state.get(player).targets.length >= maxTargets) break;
            if (state.get(player).targets.includes(candidate)) continue;
            link(player, candidate);
        }

        added.targets[player] = state.get(player).targets.filter((t) => !before.includes(t));
    }

    for (const player of needAssassins) {
        if (!state.has(player)) continue;
        const before = [...state.get(player).assassins];

        for (const candidate of candidatesForAssassin(player)) {
            if (state.get(player).assassins.length >= maxTargets) break;
            if (state.get(player).assassins.includes(candidate)) continue;
            link(candidate, player);
        }

        added.assassins[player] = state.get(player).assassins.filter((a) => !before.includes(a));
    }

    const writes = [...touched].map((player) => ({
        player,
        targets: state.get(player).targets,
        assassins: state.get(player).assassins,
    }));

    return { writes, added, logs };
};

module.exports = { planRemap };
