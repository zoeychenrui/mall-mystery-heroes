/**
 * Parsing for the GM command bar, separated from execution.
 *
 * Previously this lived at the top of `handleCommandExecution` in
 * `ChatInput.js`, a module-private 250-line async function that also performed
 * every Firestore call — so "what does this input parse to?" could not be asked
 * without rendering a component and mocking eighteen imports.
 */

export const KNOWN_COMMANDS = [
    '/add',
    '/broadcast',
    '/kick',
    '/kill',
    '/leaderboard',
    '/mission',
    '/openseason',
    '/revive',
    '/whisper',
];

/** Commands accepted by the whitelist but not yet implemented. */
export const UNIMPLEMENTED_COMMANDS = [];

// Matches a leading /command, a [bracketed placeholder], or a bare word.
const TOKEN = /\/\S+|\[[^\]]+\]|\S+/g;

/**
 * @returns {{ok: true, command: string, args: string[]}
 *          |{ok: false, error: 'EMPTY'}
 *          |{ok: false, error: 'UNKNOWN_COMMAND', command: string}}
 */
export const parseCommand = (input) => {
    const tokens = String(input ?? '').match(TOKEN);
    if (!tokens || tokens.length === 0) {
        return { ok: false, error: 'EMPTY' };
    }

    const stripped = tokens.map((token) => token.replace(/[[\]]/g, ''));
    const command = stripped[0].toLowerCase();

    if (!KNOWN_COMMANDS.includes(command)) {
        return { ok: false, error: 'UNKNOWN_COMMAND', command };
    }

    return { ok: true, command, args: stripped.slice(1) };
};
