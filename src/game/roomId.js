/**
 * Jackbox-style room codes: 4 random uppercase letters (e.g. "WXKR"),
 * replacing the old word+number scheme ("Fluffy42317") whose mixed-case
 * shape silently failed to match if a player typed it back in any other
 * case — DashBoard.js/JoinGame.js both normalize to uppercase around
 * this, so that problem doesn't recur here regardless of how the code
 * gets typed. Pure — no Firebase, no React. `Math.random` is injectable
 * as `rng`, matching src/game/remapPlan.js's/targetGraph.js's own
 * convention, so tests can be deterministic.
 *
 * No letters are excluded from the alphabet: the code is letters only,
 * never mixed with digits, so O/0 confusion never arises, and capital I
 * reads unambiguously on its own since the code is always shown in all
 * caps — there's no lowercase L for it to be confused with.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_LENGTH = 4;

// Checked case-insensitively against every generated code before it's
// ever shown to anyone (DashBoard.js's retry loop, alongside its
// existing checkForRoomIDDupes check). Deliberately short — the code is
// always exactly 4 letters, so only actual 4-letter matches are
// possible at all; no need to scan for a longer word inside it.
const BLOCKED_WORDS = [
    'FUCK',
    'SHIT',
    'CUNT',
    'TWAT',
    'COCK',
    'DICK',
    'PISS',
    'TITS',
    'WANK',
    'JIZZ',
    'SLUT',
    'TURD',
    'CRAP',
    'NAZI',
    'GOOK',
    'KIKE',
    'SPIC',
    'DYKE',
    'HOMO',
    'FART',
];

/**
 * @param {{rng?: () => number}} [options]
 * @returns {string} a 4-letter uppercase code, e.g. "WXKR"
 */
export const generateRoomCode = ({ rng = Math.random } = {}) =>
    Array.from({ length: CODE_LENGTH }, () => ALPHABET[Math.floor(rng() * ALPHABET.length)]).join(
        ''
    );

/**
 * @param {string} code
 * @returns {boolean} whether `code` is a known offensive word, checked
 *   case-insensitively regardless of how the caller happens to case it
 */
export const isBlockedRoomCode = (code) => BLOCKED_WORDS.includes(code.toUpperCase());
