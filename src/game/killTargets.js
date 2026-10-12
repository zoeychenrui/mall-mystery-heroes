/**
 * Which players a photo-approval dropdown should offer as a kill target for
 * a given assassin: everyone on the assassin's own target list, plus anyone
 * else with open season on themselves — open season makes a player a valid
 * target for anyone, not just their assigned hunter, mirroring the same
 * rule killPlayer.js already enforces server-side
 * (`assassinTargets.includes(targetKey) || targetData.openSeason`). Before
 * this, the photo dropdown only ever offered the assassin's own list, so a
 * legitimate open-season kill had no way to be approved as a kill at all
 * unless the open-season player happened to already be that assassin's own
 * target too.
 *
 * Deliberately narrower than killPlayer.js's own three-way validity check:
 * an assassin who themselves has open season does not expand this list to
 * every player — that's a separate design decision, out of scope here.
 */
import { normalizePlayerName } from './playerNames';

/**
 * @param {Array<{name: string, targets?: string[], openSeason?: boolean, isAlive?: boolean}>} players
 * @param {string} assassinName
 * @returns {string[]} deduplicated target names, the assassin's own list first
 */
export const killTargetsForAssassin = (players, assassinName) => {
    const normalizedAssassin = normalizePlayerName(assassinName);
    const assassin = players.find(
        (player) => normalizePlayerName(player.name) === normalizedAssassin
    );
    // An assassin who isn't in the roster at all can't have a kill
    // approved against them — even a legitimately open-season player
    // shouldn't show up as selectable for a moderator when the assassin
    // side of the pair no longer exists, since attempting the approval
    // would just fail server-side with a confusing error instead.
    if (!assassin) return [];
    const ownTargets = assassin.targets ?? [];

    const openSeasonTargets = players
        .filter(
            (player) =>
                player.openSeason &&
                player.isAlive &&
                normalizePlayerName(player.name) !== normalizedAssassin
        )
        .map((player) => player.name);

    return Array.from(new Set([...ownTargets, ...openSeasonTargets]));
};
