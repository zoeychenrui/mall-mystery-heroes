import { generateRoomCode, isBlockedRoomCode } from './roomId';

describe('generateRoomCode', () => {
    it('returns a 4-character code', () => {
        expect(generateRoomCode()).toHaveLength(4);
    });

    it('only ever uses uppercase A-Z letters', () => {
        for (let i = 0; i < 200; i += 1) {
            expect(generateRoomCode()).toMatch(/^[A-Z]{4}$/);
        }
    });

    it('uses the injected rng instead of Math.random, for deterministic tests', () => {
        // A constant rng always picks the same index into the alphabet.
        const rng = () => 0;
        expect(generateRoomCode({ rng })).toBe('AAAA');
    });

    it('produces a different code with a different rng', () => {
        const rng = () => 0.999999;
        expect(generateRoomCode({ rng })).toBe('ZZZZ');
    });
});

describe('isBlockedRoomCode', () => {
    it('flags a known offensive word', () => {
        expect(isBlockedRoomCode('FUCK')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isBlockedRoomCode('fuck')).toBe(true);
        expect(isBlockedRoomCode('FuCk')).toBe(true);
    });

    it('does not flag an ordinary code', () => {
        expect(isBlockedRoomCode('WXKR')).toBe(false);
    });
});
