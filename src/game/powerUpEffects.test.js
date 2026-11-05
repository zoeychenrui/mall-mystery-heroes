const {
    AD_REWARD_POINTS,
    CAMERA_BLOCK_MS,
    HORCRUX_GRACE_MS,
    MYSTERY_BOX_OUTCOMES,
    rollMysteryBox,
    resolveMysteryOutcome,
    mysteryOutcomeLabel,
    isHorcruxActive,
    isCameraBlocked,
    pingEntry,
    pingMessageText,
    staleLocationAlerts,
} = require('./powerUpEffects');
const { POWER_UPS } = require('./powerUps');

const priceOf = (itemId) => POWER_UPS.find((p) => p.id === itemId).cost;

describe('constants from the spec', () => {
    it('ad always gives 3 points, camera blocks for 30s, horcrux grace is 5s', () => {
        expect(AD_REWARD_POINTS).toBe(3);
        expect(CAMERA_BLOCK_MS).toBe(30000);
        expect(HORCRUX_GRACE_MS).toBe(5000);
    });
});

describe('MYSTERY_BOX_OUTCOMES', () => {
    it('has weights totalling exactly 100', () => {
        const total = MYSTERY_BOX_OUTCOMES.reduce((sum, outcome) => sum + outcome.weight, 0);
        expect(total).toBe(100);
    });

    it("matches the spec's stated expected value of 3.49 points", () => {
        const value = (outcome) =>
            outcome.kind === 'points'
                ? outcome.points
                : outcome.kind === 'item'
                  ? priceOf(outcome.itemId)
                  : 0;
        const expected =
            MYSTERY_BOX_OUTCOMES.reduce(
                (sum, outcome) => sum + value(outcome) * outcome.weight,
                0
            ) / 100;
        expect(expected).toBeCloseTo(3.49, 5);
    });

    it('trash is 36%, Horcrux 1%', () => {
        expect(MYSTERY_BOX_OUTCOMES.find((o) => o.kind === 'trash').weight).toBe(36);
        expect(MYSTERY_BOX_OUTCOMES.find((o) => o.itemId === 'horcrux').weight).toBe(1);
    });

    it('only grants items that exist in the shop', () => {
        const ids = POWER_UPS.map((p) => p.id);
        for (const outcome of MYSTERY_BOX_OUTCOMES.filter((o) => o.kind === 'item')) {
            expect(ids).toContain(outcome.itemId);
        }
    });
});

describe('rollMysteryBox', () => {
    it('maps the bottom of the range to the first outcome (trash)', () => {
        expect(rollMysteryBox(() => 0)).toEqual({ kind: 'trash', weight: 36 });
    });

    it('maps 0.36 (just past trash) to the second outcome', () => {
        expect(rollMysteryBox(() => 0.36)).toEqual({ kind: 'points', points: 1, weight: 5 });
    });

    it('maps the very top of the range to the last outcome (Horcrux)', () => {
        expect(rollMysteryBox(() => 0.9999)).toEqual({
            kind: 'item',
            itemId: 'horcrux',
            weight: 1,
        });
    });

    it('produces each outcome at its stated rate over evenly spaced rolls', () => {
        const counts = new Map();
        for (let i = 0; i < 10000; i++) {
            const outcome = rollMysteryBox(() => i / 10000);
            counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
        }
        for (const outcome of MYSTERY_BOX_OUTCOMES) {
            expect(counts.get(outcome)).toBe(outcome.weight * 100);
        }
    });
});

describe('resolveMysteryOutcome', () => {
    const base = { cooldownEndsAtMs: null, nowMs: 1000, horcruxActive: false };

    it('passes trash and points straight through', () => {
        expect(resolveMysteryOutcome({ ...base, outcome: { kind: 'trash' } })).toEqual({
            kind: 'trash',
        });
        expect(resolveMysteryOutcome({ ...base, outcome: { kind: 'points', points: 7 } })).toEqual({
            kind: 'points',
            points: 7,
        });
    });

    it('grants a usable item', () => {
        expect(
            resolveMysteryOutcome({ ...base, outcome: { kind: 'item', itemId: 'ping-targets' } })
        ).toEqual({ kind: 'item', itemId: 'ping-targets' });
    });

    it("refunds the item's price when that item is on cooldown", () => {
        expect(
            resolveMysteryOutcome({
                ...base,
                cooldownEndsAtMs: 5000,
                outcome: { kind: 'item', itemId: 'ping-targets' },
            })
        ).toEqual({ kind: 'refund', itemId: 'ping-targets', points: priceOf('ping-targets') });
    });

    it('refunds 20 points for a Horcrux while one is already active', () => {
        expect(
            resolveMysteryOutcome({
                ...base,
                horcruxActive: true,
                outcome: { kind: 'item', itemId: 'horcrux' },
            })
        ).toEqual({ kind: 'refund', itemId: 'horcrux', points: 20 });
    });
});

describe('mysteryOutcomeLabel', () => {
    it('describes each kind of result for the reveal screen', () => {
        expect(mysteryOutcomeLabel({ kind: 'trash' })).toBe('Trash — better luck next time');
        expect(mysteryOutcomeLabel({ kind: 'points', points: 1 })).toBe('+1 point');
        expect(mysteryOutcomeLabel({ kind: 'points', points: 15 })).toBe('+15 points');
        expect(mysteryOutcomeLabel({ kind: 'item', itemId: 'horcrux' })).toBe('Horcrux');
        expect(mysteryOutcomeLabel({ kind: 'refund', itemId: 'horcrux', points: 20 })).toBe(
            'Horcrux — already active, refunded +20 points'
        );
    });
});

describe('isHorcruxActive', () => {
    it('is false without a Horcrux', () => {
        expect(isHorcruxActive({}, 1000)).toBe(false);
        expect(isHorcruxActive({ horcrux: false }, 1000)).toBe(false);
    });

    it('is true while held and not yet triggered', () => {
        expect(isHorcruxActive({ horcrux: true, horcruxEndsAtMs: null }, 1000)).toBe(true);
    });

    it('stays true for the grace period after it saves the player, then ends', () => {
        const triggered = { horcrux: true, horcruxEndsAtMs: 6000 };
        expect(isHorcruxActive(triggered, 5999)).toBe(true);
        expect(isHorcruxActive(triggered, 6000)).toBe(false);
    });
});

describe('isCameraBlocked', () => {
    it('is blocked only before the stored end time', () => {
        expect(isCameraBlocked(null, 1000)).toBe(false);
        expect(isCameraBlocked(2000, 1999)).toBe(true);
        expect(isCameraBlocked(2000, 2000)).toBe(false);
    });
});

describe('pingEntry', () => {
    const nowMs = 100000;

    it('copies a fresh position as a snapshot', () => {
        expect(
            pingEntry({
                name: 'bob',
                status: { lat: 1, lng: 2, accuracyMeters: 8, lastUsableMs: nowMs - 10000 },
                nowMs,
            })
        ).toEqual({
            name: 'bob',
            lat: 1,
            lng: 2,
            accuracyMeters: 8,
            capturedAtMs: nowMs - 10000,
            isStale: false,
        });
    });

    it('marks a position older than 30s as stale but still includes it', () => {
        const entry = pingEntry({
            name: 'bob',
            status: { lat: 1, lng: 2, accuracyMeters: 8, lastUsableMs: nowMs - 31000 },
            nowMs,
        });
        expect(entry.isStale).toBe(true);
        expect(entry.lat).toBe(1);
    });

    it('has no position when the player never reported one', () => {
        expect(pingEntry({ name: 'bob', status: null, nowMs })).toEqual({
            name: 'bob',
            lat: null,
            lng: null,
            accuracyMeters: null,
            capturedAtMs: null,
            isStale: true,
        });
    });
});

describe('pingMessageText', () => {
    const entry = (name) => ({ name });

    it('announces who was pinged and who pinged them globally', () => {
        expect(
            pingMessageText({
                itemId: 'global-ping-random',
                pings: [entry('bob')],
                buyerName: 'alice',
            })
        ).toBe('📍 bob has been pinged by alice!');
    });

    it('lists the pinged players for personal pings', () => {
        expect(
            pingMessageText({ itemId: 'ping-targets', pings: [entry('bob'), entry('carol')] })
        ).toBe('📍 Your targets: bob, carol');
        expect(pingMessageText({ itemId: 'ping-assassins', pings: [entry('dave')] })).toBe(
            '📍 Your assassins: dave'
        );
    });
});

describe('staleLocationAlerts', () => {
    const nowMs = 200000;

    it('returns a GM alert for each stale or missing position, none for fresh', () => {
        const pings = [
            { name: 'fresh', capturedAtMs: nowMs - 5000, isStale: false },
            { name: 'old', capturedAtMs: nowMs - 125000, isStale: true },
            { name: 'none', capturedAtMs: null, isStale: true },
        ];
        expect(staleLocationAlerts(pings, nowMs)).toEqual([
            "⚠️ old's location is stale (last fix 2 min ago) — check their GPS",
            '⚠️ none has no location on record — check their GPS',
        ]);
    });
});
