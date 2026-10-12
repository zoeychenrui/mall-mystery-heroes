/**
 * Shell-style, per-argument completion for the GM command bar
 * (docs/superpowers/specs/2026-08-05-shell-style-command-completion-design.md).
 *
 * Pure and synchronous — no Firebase, no React. `ChatInput.js` is
 * responsible for sourcing `players`/`missions` and applying the result;
 * this module only decides what completes the argument currently being
 * typed.
 */
import { KNOWN_COMMANDS, UNIMPLEMENTED_COMMANDS } from './commands';

// Mirrors src/game/commands.js's own TOKEN regex exactly, so a "slot" here
// is the same unit parseCommand treats as one argument — a [bracketed
// group] is one slot, not several.
const TOKEN = /\/\S+|\[[^\]]+\]|\S+/g;

const MISSION_SUBCOMMANDS = ['done', 'end', 'start', 'undo', 'view'];
const LEADERBOARD_SUBCOMMANDS = ['send', 'view'];
const OPEN_SEASON_VALUES = ['start', 'end'];

// Placeholder labels for each command's arguments, in order — used only to
// build the full-line preview shown in the suggestion dropdown (see
// `describeCandidate`). Tab/selecting a suggestion still only ever fills
// the one slot being typed; these labels are what's left *after* it, shown
// so a GM can see the whole command's shape without memorizing it.
const ARG_LABELS = {
    '/add': ['[player_name]', '[points]'],
    '/kick': ['[player_name]'],
    '/kill': ['[player_name]', '[assassin_name]'],
    '/openseason': ['[player_name]', 'start/end'],
    '/revive': ['[player_name]'],
    '/whisper': ['[player_name]', '[message]'],
    '/broadcast': ['[message]'],
    '/leaderboard': ['send/view'],
};

// `/mission`'s remaining shape depends on which sub-command was picked, so
// it's keyed separately rather than living in ARG_LABELS.
const MISSION_ARG_LABELS = {
    done: ['[player_name]', '[mission_index]'],
    end: ['[mission_index]'],
    start: [],
    undo: [],
    view: [],
};

const playerNames = (players) => players.map((player) => player.name);
const deadPlayerNames = (players) =>
    players.filter((player) => player.isAlive === false).map((player) => player.name);
const activeMissionIndices = (missions) =>
    missions.filter((mission) => !mission.isComplete).map((mission) => String(mission.taskIndex));

/**
 * Tokenizes `input` the same way `parseCommand` does. If the string ends in
 * whitespace, an extra empty token is appended — the GM has finished the
 * previous argument and is now at a fresh, not-yet-typed slot.
 */
const tokenize = (input) => {
    const tokens = [...input.matchAll(TOKEN)].map((match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
    }));
    if (input.endsWith(' ')) {
        tokens.push({ text: '', start: input.length, end: input.length });
    }
    return tokens;
};

/**
 * Narrows `candidates` to the ones matching `typed` as a case-insensitive
 * prefix, and computes the longest common prefix across the matches — what
 * Tab inserts. `null` if nothing matches.
 */
const matchCandidates = (candidates, typed) => {
    const lowerTyped = typed.toLowerCase();
    const matches = candidates.filter((candidate) =>
        candidate.toLowerCase().startsWith(lowerTyped)
    );
    if (matches.length === 0) return null;

    let prefixLength = matches[0].length;
    for (const candidate of matches.slice(1)) {
        let i = 0;
        while (i < prefixLength && candidate[i]?.toLowerCase() === matches[0][i].toLowerCase()) {
            i++;
        }
        prefixLength = Math.min(prefixLength, i);
    }
    return { matches, commonPrefix: matches[0].slice(0, prefixLength) };
};

const bracketIfMultiWord = (value) => (/\s/.test(value) ? `[${value}]` : value);

/**
 * The full-line preview shown in the suggestion dropdown for one
 * `candidate` at `slotIndex`: the command so far, `candidate` filled into
 * its slot, and placeholder labels for whatever's still unfilled after it
 * — e.g. typing "/mission d" shows "/mission done [player_name]
 * [mission_index]", not just "done". Display only; what Tab/selecting
 * actually inserts is still just the one slot (`applyCandidate` in
 * ChatInput.js).
 */
const describeCandidate = (command, slotIndex, tokens, candidate) => {
    if (slotIndex === 0) {
        // The command word itself. /mission's own remaining shape depends
        // on a sub-command that hasn't been chosen yet, so it's shown bare
        // — the sub-command slot's own suggestions spell out each variant.
        const labels = candidate === '/mission' ? [] : ARG_LABELS[candidate] || [];
        return [candidate, ...labels].join(' ');
    }

    const typed = tokens.slice(1, slotIndex).map((token) => token.text);
    const filled = bracketIfMultiWord(candidate);

    let remaining;
    if (command === '/mission') {
        const sub = (
            slotIndex === 1 ? candidate : (tokens[1]?.text || '').replace(/[[\]]/g, '')
        ).toLowerCase();
        const labels = MISSION_ARG_LABELS[sub] || [];
        remaining = slotIndex === 1 ? labels : labels.slice(slotIndex - 1);
    } else {
        remaining = (ARG_LABELS[command] || []).slice(slotIndex);
    }

    return [command, ...typed, filled, ...remaining].join(' ');
};

/**
 * Candidate values for `command`'s argument at `slotIndex` (1-based — slot
 * 0 is the command word itself, resolved separately since its candidates
 * come from `KNOWN_COMMANDS`, not live data). `args` are the already-typed
 * arguments before the current slot, bracket-stripped, needed only to
 * resolve `/mission`'s sub-command-dependent shape. `null` means this
 * position has nothing to suggest.
 */
const candidatesForSlot = (command, slotIndex, args, { players, missions }) => {
    if (UNIMPLEMENTED_COMMANDS.includes(command)) return null;

    switch (command) {
        case '/add':
            return slotIndex === 1 ? playerNames(players) : null;
        case '/kick':
            return slotIndex === 1 ? playerNames(players) : null;
        case '/kill': {
            if (slotIndex === 1) return playerNames(players);
            if (slotIndex === 2) {
                // The assassin slot only offers players who are actually
                // targeting the already-typed target — not the full
                // roster. Case-insensitive since the target name was typed
                // freehand and may not match the stored casing exactly.
                const target = (args[0] || '').toLowerCase();
                return players
                    .filter((player) =>
                        (player.targets || []).some((t) => t.toLowerCase() === target)
                    )
                    .map((player) => player.name);
            }
            return null;
        }
        case '/whisper':
            return slotIndex === 1 ? playerNames(players) : null;
        case '/openseason':
            if (slotIndex === 1) return playerNames(players);
            if (slotIndex === 2) return OPEN_SEASON_VALUES;
            return null;
        case '/revive':
            return slotIndex === 1 ? deadPlayerNames(players) : null;
        case '/leaderboard':
            return slotIndex === 1 ? LEADERBOARD_SUBCOMMANDS : null;
        case '/mission': {
            if (slotIndex === 1) return MISSION_SUBCOMMANDS;
            const sub = (args[0] || '').toLowerCase();
            if (sub === 'done') {
                if (slotIndex === 2) return playerNames(players);
                if (slotIndex === 3) return activeMissionIndices(missions);
            }
            if (sub === 'end' && slotIndex === 2) return activeMissionIndices(missions);
            return null;
        }
        default:
            return null;
    }
};

/**
 * Given the raw, unsubmitted chat bar text, decides what completes the
 * argument slot currently being typed.
 *
 * @param {string} input
 * @param {{ players?: Array<{name: string, isAlive?: boolean}>, missions?: Array<{taskIndex: number|string, isComplete: boolean}> }} [data]
 * @returns {{ applied: false } | {
 *   applied: true,
 *   tokenStart: number,
 *   tokenEnd: number,
 *   commonPrefix: string,
 *   candidates: string[],
 *   suggestionLines: string[],
 *   isUnique: boolean,
 * }}
 */
export const complete = (input, { players = [], missions = [] } = {}) => {
    const value = String(input ?? '');
    const tokens = tokenize(value);
    if (tokens.length === 0) return { applied: false };

    const slotIndex = tokens.length - 1;
    const current = tokens[slotIndex];
    const typed = current.text.replace(/[[\]]/g, '');
    const command = tokens[0].text.toLowerCase();

    let candidates;
    if (slotIndex === 0) {
        candidates = KNOWN_COMMANDS;
    } else {
        if (!KNOWN_COMMANDS.includes(command)) return { applied: false };
        const args = tokens.slice(1, slotIndex).map((token) => token.text.replace(/[[\]]/g, ''));
        candidates = candidatesForSlot(command, slotIndex, args, { players, missions });
    }

    if (!candidates) return { applied: false };

    const result = matchCandidates(candidates, typed);
    if (!result) return { applied: false };

    const isUnique = result.matches.length === 1;
    const needsBrackets = /\s/.test(result.commonPrefix);

    return {
        applied: true,
        tokenStart: current.start,
        tokenEnd: current.end,
        commonPrefix: needsBrackets ? `[${result.commonPrefix}]` : result.commonPrefix,
        candidates: result.matches,
        suggestionLines: result.matches.map((candidate) =>
            describeCandidate(command, slotIndex, tokens, candidate)
        ),
        isUnique,
    };
};

const commandCompletion = { complete };
export default commandCompletion;
