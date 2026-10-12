import { parseCommand, KNOWN_COMMANDS, UNIMPLEMENTED_COMMANDS } from './commands';

describe('parseCommand', () => {
    it('splits a command from its arguments', () => {
        expect(parseCommand('/kill alice bob')).toEqual({
            ok: true,
            command: '/kill',
            args: ['alice', 'bob'],
        });
    });

    it('lowercases the command token so /Kill is accepted', () => {
        expect(parseCommand('/Kill alice bob').command).toBe('/kill');
    });

    it('preserves the case of arguments', () => {
        // Player names are stored case-preserved; normalizing is the caller's
        // decision, not the parser's.
        expect(parseCommand('/kill Alice Bob').args).toEqual(['Alice', 'Bob']);
    });

    it('tolerates extra whitespace between arguments', () => {
        expect(parseCommand('  /add   alice    5  ').args).toEqual(['alice', '5']);
    });

    it('strips the square brackets carried in from an autosuggest entry', () => {
        expect(parseCommand('/kill [player] [assassin]').args).toEqual(['player', 'assassin']);
    });

    it('rejects an empty input instead of throwing', () => {
        // `value.match(...)` returns null for empty input and the old code
        // called .map() on it before its own guard — pressing Enter on an
        // empty box threw a TypeError.
        expect(parseCommand('')).toEqual({ ok: false, error: 'EMPTY' });
    });

    it('rejects a whitespace-only input instead of throwing', () => {
        expect(parseCommand('   ')).toEqual({ ok: false, error: 'EMPTY' });
    });

    it('rejects an unknown command and reports what was typed', () => {
        expect(parseCommand('/teleport alice')).toEqual({
            ok: false,
            error: 'UNKNOWN_COMMAND',
            command: '/teleport',
        });
    });

    it('rejects plain chat text that is not a command', () => {
        expect(parseCommand('hello everyone')).toEqual({
            ok: false,
            error: 'UNKNOWN_COMMAND',
            command: 'hello',
        });
    });

    it('accepts a command with no arguments', () => {
        expect(parseCommand('/leaderboard')).toEqual({
            ok: true,
            command: '/leaderboard',
            args: [],
        });
    });

    it.each(KNOWN_COMMANDS)('accepts %s', (command) => {
        expect(parseCommand(`${command} x y`).ok).toBe(true);
    });

    it('lists every unimplemented command as a known command', () => {
        // ChatInput.js checks UNIMPLEMENTED_COMMANDS.includes(commandLine)
        // only after parseCommand has already accepted it — an entry here
        // that isn't in KNOWN_COMMANDS would be dead, since parseCommand
        // would reject it as UNKNOWN_COMMAND first (improvements item 21).
        // UNIMPLEMENTED_COMMANDS is currently empty (/whisper, /broadcast,
        // /leaderboard are all implemented) — this guards any future addition.
        expect(UNIMPLEMENTED_COMMANDS.every((command) => KNOWN_COMMANDS.includes(command))).toBe(
            true
        );
    });
});
