import { normalizePlayerName, resolvePlayerDisplayName } from './playerNames';

describe('normalizePlayerName', () => {
    it('lowercases a single-word name', () => {
        expect(normalizePlayerName('Alice')).toBe('alice');
    });

    it('strips all internal whitespace from a multi-word name (improvements item 35)', () => {
        expect(normalizePlayerName('Alice Smith')).toBe('alicesmith');
    });

    it('strips leading and trailing whitespace too', () => {
        expect(normalizePlayerName('  Alice  ')).toBe('alice');
    });

    it('collapses names that differ only in whitespace/case to the same key', () => {
        expect(normalizePlayerName('Alice Smith')).toBe(normalizePlayerName('alice   smith'));
    });
});

describe('resolvePlayerDisplayName', () => {
    const players = [{ name: 'Alice Smith' }, { name: 'Bob' }];

    it('resolves a normalized (lowercased, whitespace-stripped) name back to its stored casing', () => {
        expect(resolvePlayerDisplayName('alicesmith', players)).toBe('Alice Smith');
    });

    it('works from a raw, differently-cased name too, not just an already-normalized one', () => {
        expect(resolvePlayerDisplayName('BOB', players)).toBe('Bob');
    });

    it('falls back to the input unchanged if no player matches', () => {
        expect(resolvePlayerDisplayName('nobody', players)).toBe('nobody');
    });
});
