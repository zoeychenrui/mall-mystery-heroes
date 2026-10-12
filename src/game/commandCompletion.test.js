import { complete } from './commandCompletion';

const players = [
    { name: 'Alice Smith', isAlive: true, targets: ['Bob'] },
    { name: 'Alex', isAlive: true, targets: [] },
    { name: 'Bob', isAlive: false, targets: ['Alice Smith'] },
];

const missions = [
    { taskIndex: 1, isComplete: false },
    { taskIndex: 2, isComplete: false },
    { taskIndex: 3, isComplete: true },
];

describe('complete — command word (slot 0)', () => {
    it('completes a unique command word', () => {
        const result = complete('/kil', {});
        expect(result).toEqual({
            applied: true,
            tokenStart: 0,
            tokenEnd: 4,
            commonPrefix: '/kill',
            candidates: ['/kill'],
            suggestionLines: ['/kill [player_name] [assassin_name]'],
            isUnique: true,
        });
    });

    it('completes to the longest common prefix between /kick and /kill when ambiguous', () => {
        const result = complete('/ki', {});
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(false);
        expect(result.commonPrefix).toBe('/ki');
        expect(result.candidates.sort()).toEqual(['/kick', '/kill']);
    });

    it('completes to the longest common prefix across ambiguous commands', () => {
        // /add and /openseason share no prefix beyond "/", but /revive is the
        // only known command starting with "/r".
        const result = complete('/', {});
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(false);
        expect(result.commonPrefix).toBe('/');
    });

    it('does nothing for a command word matching no known command', () => {
        const result = complete('/xyz', {});
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — player-name slots', () => {
    it('completes to the longest common prefix when ambiguous', () => {
        const result = complete('/kill Al', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(false);
        expect(result.commonPrefix).toBe('Al');
        expect(result.candidates).toEqual(['Alice Smith', 'Alex']);
    });

    it('completes a unique match and wraps a multi-word name in brackets', () => {
        const result = complete('/kill Alice', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('[Alice Smith]');
    });

    it('completes the second player-name slot for /kill independently of the first', () => {
        // Bob is the only player in the fixture who targets Alice Smith, so
        // the assassin slot's candidates are scoped to just him — this also
        // exercises the assassin-filtering behavior below, not just that
        // the slot completes independently.
        const result = complete('/kill [Alice Smith] B', { players });
        expect(result.applied).toBe(true);
        expect(result.tokenStart).toBe('/kill [Alice Smith] '.length);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('offers every player when nothing has been typed yet for the slot', () => {
        const result = complete('/add ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Alice Smith', 'Alex', 'Bob']);
    });

    it("does not suggest players for /add's second (numeric) slot", () => {
        const result = complete('/add alice 5', { players });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /kill assassin slot only offers players targeting the specified target', () => {
    it('filters assassin candidates to players whose targets include the typed target', () => {
        const result = complete('/kill Bob ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Alice Smith']);
    });

    it('offers nothing when nobody targets the specified target', () => {
        const result = complete('/kill Alex ', { players });
        expect(result).toEqual({ applied: false });
    });

    it('matches the typed target against targets arrays case-insensitively', () => {
        const result = complete('/kill bob ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Alice Smith']);
    });

    it('does not filter the first (target) slot the same way', () => {
        const result = complete('/kill ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Alice Smith', 'Alex', 'Bob']);
    });
});

describe('complete — /revive only suggests dead players', () => {
    it('offers only dead players, not the full roster', () => {
        const result = complete('/revive ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Bob']);
    });

    it('completes a unique dead-player match', () => {
        const result = complete('/revive B', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('does nothing when the typed prefix matches no dead player', () => {
        // "Al" matches two *living* players, but neither is a candidate here.
        const result = complete('/revive Al', { players });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /openseason', () => {
    it('completes the player slot', () => {
        const result = complete('/openseason B', { players });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('completes the start/end literal slot', () => {
        const result = complete('/openseason bob s', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('start');
    });

    it('previews the remaining start/end slot with a slash, not a pipe', () => {
        // The pipe is an internal placeholder-list artifact, not something
        // a GM should see — the command bar has no "or" syntax, so showing
        // "start|end" reads as a literal, unrecognized argument value.
        const result = complete('/openseason B', { players });
        expect(result.suggestionLines).toEqual(['/openseason Bob start/end']);
    });
});

describe('complete — /whisper', () => {
    it('completes the player slot', () => {
        const result = complete('/whisper B', { players });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('does not suggest anything for the message slot — free text', () => {
        const result = complete('/whisper bob hel', { players });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /kick', () => {
    it('completes the player slot', () => {
        const result = complete('/kick B', { players });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Bob');
    });

    it('offers every player when nothing has been typed yet', () => {
        const result = complete('/kick ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['Alice Smith', 'Alex', 'Bob']);
    });
});

describe('complete — /broadcast', () => {
    it('does not suggest anything for the message slot — free text', () => {
        const result = complete('/broadcast hel', { players });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /leaderboard', () => {
    it('completes the literal "send" argument', () => {
        const result = complete('/leaderboard s', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('send');
    });

    it('completes the literal "view" argument', () => {
        const result = complete('/leaderboard v', { players });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('view');
    });

    it('offers both sub-commands when nothing has been typed yet', () => {
        const result = complete('/leaderboard ', { players });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['send', 'view']);
    });
});

describe('complete — /mission sub-command completes to the bare word, not a full skeleton', () => {
    it('offers all five sub-commands when nothing has been typed yet', () => {
        const result = complete('/mission ', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['done', 'end', 'start', 'undo', 'view']);
    });

    it('completes "/mission s" to the bare word "start"', () => {
        const result = complete('/mission s', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('start');
    });

    it('completes "/mission d" to the bare word "done"', () => {
        const result = complete('/mission d', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('done');
    });
});

describe('complete — /mission done', () => {
    it('completes the player slot', () => {
        const result = complete('/mission done Al', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.commonPrefix).toBe('Al');
        expect(result.candidates).toEqual(['Alice Smith', 'Alex']);
    });

    it('completes the mission-index slot, offering only active missions', () => {
        const result = complete('/mission done alice ', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['1', '2']);
    });

    it('does not offer an already-ended mission index', () => {
        const result = complete('/mission done alice 3', { players, missions });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — /mission end offers only active missions', () => {
    it('offers every active mission index', () => {
        const result = complete('/mission end ', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.candidates).toEqual(['1', '2']);
    });

    it('completes a unique index', () => {
        const result = complete('/mission end 1', { players, missions });
        expect(result.applied).toBe(true);
        expect(result.isUnique).toBe(true);
        expect(result.commonPrefix).toBe('1');
    });
});

describe('complete — /mission start, /mission view, and /mission undo take no arguments', () => {
    it('has nothing to complete after "/mission start "', () => {
        const result = complete('/mission start ', { players, missions });
        expect(result).toEqual({ applied: false });
    });

    it('has nothing to complete after "/mission view "', () => {
        const result = complete('/mission view ', { players, missions });
        expect(result).toEqual({ applied: false });
    });

    it('has nothing to complete after "/mission undo "', () => {
        const result = complete('/mission undo ', { players, missions });
        expect(result).toEqual({ applied: false });
    });
});

describe('complete — suggestionLines show the whole command in context, not just the candidate', () => {
    it('shows the full syntax for each command word, not just its name', () => {
        const result = complete('/kil', {});
        expect(result.suggestionLines).toEqual(['/kill [player_name] [assassin_name]']);
    });

    it('shows /mission bare at the command-word slot — its shape depends on an unpicked sub-command', () => {
        const result = complete('/mi', {});
        expect(result.suggestionLines).toEqual(['/mission']);
    });

    it('shows each /mission sub-command with its own full argument shape', () => {
        const result = complete('/mission ', { players, missions });
        expect(result.suggestionLines).toEqual([
            '/mission done [player_name] [mission_index]',
            '/mission end [mission_index]',
            '/mission start',
            '/mission undo',
            '/mission view',
        ]);
    });

    it('carries the already-typed sub-command and shows what remains for /mission done', () => {
        const result = complete('/mission done ', { players, missions });
        expect(result.suggestionLines).toEqual([
            '/mission done [Alice Smith] [mission_index]',
            '/mission done Alex [mission_index]',
            '/mission done Bob [mission_index]',
        ]);
    });

    it('shows nothing left to fill once the last argument is being completed', () => {
        const result = complete('/mission done alice ', { players, missions });
        expect(result.suggestionLines).toEqual(['/mission done alice 1', '/mission done alice 2']);
    });

    it('brackets a multi-word candidate in the preview the same way Tab would insert it', () => {
        const result = complete('/kill Al', { players });
        expect(result.suggestionLines).toEqual([
            '/kill [Alice Smith] [assassin_name]',
            '/kill Alex [assassin_name]',
        ]);
    });

    it("shows a literal enum, not a placeholder, for /openseason's second argument", () => {
        const result = complete('/openseason bob ', { players });
        expect(result.suggestionLines).toEqual(['/openseason bob start', '/openseason bob end']);
    });
});

describe('complete — no data provided', () => {
    it('does not throw when players/missions are omitted', () => {
        expect(() => complete('/kill al')).not.toThrow();
        expect(complete('/kill al')).toEqual({ applied: false });
    });
});
