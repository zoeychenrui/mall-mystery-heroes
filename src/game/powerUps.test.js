const {
    POWER_UPS,
    purchaseBlockReason,
    cooldownRemaining,
    pickRandomPingTarget,
    purchaseLogText,
    formatSeconds,
} = require('./powerUps');

const byId = (id) => POWER_UPS.find((p) => p.id === id);

describe('POWER_UPS catalog', () => {
    it('has the 8 items from the spec', () => {
        expect(POWER_UPS).toHaveLength(8);
    });

    it('only the picked-player ping and camera block need a target', () => {
        const needing = POWER_UPS.filter((p) => p.needsTarget).map((p) => p.id);
        expect(needing.sort()).toEqual(['block-camera', 'global-ping-picked']);
    });
});

describe('purchaseBlockReason', () => {
    const base = { score: 100, cooldownEndsAtMs: null, nowMs: 1000, targetName: null };

    it('returns null when the purchase is allowed', () => {
        expect(purchaseBlockReason({ ...base, item: byId('horcrux') })).toBeNull();
    });

    it('blocks when the player cannot afford it', () => {
        expect(purchaseBlockReason({ ...base, score: 3, item: byId('horcrux') })).toBe(
            'Not enough points'
        );
    });

    it('blocks a purchase while the item is on cooldown', () => {
        expect(
            purchaseBlockReason({
                ...base,
                item: byId('horcrux'),
                cooldownEndsAtMs: 1000,
                nowMs: 999,
            })
        ).toBe('On cooldown');
    });

    it('allows a purchase when the cooldown has ended', () => {
        expect(
            purchaseBlockReason({
                ...base,
                item: byId('horcrux'),
                cooldownEndsAtMs: 1000,
                nowMs: 1000,
            })
        ).toBeNull();
    });

    it('requires a player for an item that needs a target', () => {
        expect(
            purchaseBlockReason({
                ...base,
                item: byId('global-ping-picked'),
                targetName: null,
            })
        ).toBe('Pick a player');
    });

    it('treats an empty selection as no player picked', () => {
        expect(
            purchaseBlockReason({ ...base, item: byId('global-ping-picked'), targetName: '' })
        ).toBe('Pick a player');
    });

    it('allows a targeted item once a player is picked', () => {
        expect(
            purchaseBlockReason({
                ...base,
                item: byId('global-ping-picked'),
                targetName: 'alice',
            })
        ).toBeNull();
    });

    it('allows the free ad item with zero points', () => {
        const adItem = byId('watch-ad');
        expect(adItem).toBeDefined();
        expect(
            purchaseBlockReason({
                ...base,
                item: adItem,
                score: 0,
            })
        ).toBeNull();
    });
});

describe('purchaseBlockReason — eliminated players', () => {
    const base = { score: 100, cooldownEndsAtMs: null, nowMs: 1000, targetName: null };

    it('blocks an eliminated player even when they could otherwise afford it', () => {
        expect(purchaseBlockReason({ ...base, item: byId('watch-ad'), isAlive: false })).toBe(
            "Eliminated players can't shop"
        );
    });

    it('allows an alive player', () => {
        expect(purchaseBlockReason({ ...base, item: byId('watch-ad'), isAlive: true })).toBeNull();
    });
});

describe('pickRandomPingTarget', () => {
    const players = [
        { name: 'Alice', isAlive: true },
        { name: 'Bob', isAlive: true },
        { name: 'Carol', isAlive: false },
        { name: 'Dave', isAlive: true },
    ];

    it('picks among alive players other than the buyer, using the injected rng', () => {
        // Eligible, in order: Bob, Dave. rng 0 → first, rng 0.99 → last.
        expect(pickRandomPingTarget(players, 'alice', () => 0)).toBe('Bob');
        expect(pickRandomPingTarget(players, 'alice', () => 0.99)).toBe('Dave');
    });

    it('never picks the buyer or a dead player', () => {
        for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
            expect(['Bob', 'Dave']).toContain(pickRandomPingTarget(players, 'ALICE', () => roll));
        }
    });

    it('returns null when nobody else is alive', () => {
        expect(
            pickRandomPingTarget([{ name: 'Alice', isAlive: true }], 'alice', () => 0)
        ).toBeNull();
    });
});

describe('purchaseBlockReason — Horcrux', () => {
    const base = { score: 100, cooldownEndsAtMs: null, nowMs: 1000, targetName: null };

    it('blocks a second Horcrux while one is active', () => {
        expect(purchaseBlockReason({ ...base, item: byId('horcrux'), horcruxActive: true })).toBe(
            'Horcrux already active'
        );
    });

    it('only affects the Horcrux itself', () => {
        expect(
            purchaseBlockReason({ ...base, item: byId('mystery-box'), horcruxActive: true })
        ).toBeNull();
    });
});

describe('purchaseLogText', () => {
    it('names the buyer, the item, and the points spent', () => {
        expect(purchaseLogText({ buyerName: 'alice', item: byId('horcrux') })).toBe(
            'alice bought Horcrux (-20 pts)'
        );
    });

    it('appends what the purchase did', () => {
        expect(
            purchaseLogText({
                buyerName: 'alice',
                item: byId('global-ping-random'),
                detail: 'pinged bob',
            })
        ).toBe(`alice bought ${byId('global-ping-random').name} (-3 pts) — pinged bob`);
    });

    it('leaves out the price for the free ad', () => {
        expect(
            purchaseLogText({ buyerName: 'alice', item: byId('watch-ad'), detail: '+3 points' })
        ).toBe('alice bought Watch an ad — +3 points');
    });
});

describe('cooldownRemaining', () => {
    it('is full right after purchase', () => {
        expect(
            cooldownRemaining({ cooldownEndsAtMs: 90000, nowMs: 0, cooldownSeconds: 90 })
        ).toEqual({ secondsLeft: 90, fractionLeft: 1 });
    });
    it('is half full half way through', () => {
        expect(
            cooldownRemaining({ cooldownEndsAtMs: 90000, nowMs: 45000, cooldownSeconds: 90 })
        ).toEqual({ secondsLeft: 45, fractionLeft: 0.5 });
    });

    it('never becomes negative after cooldown passed', () => {
        expect(
            cooldownRemaining({ cooldownEndsAtMs: 90000, nowMs: 120000, cooldownSeconds: 90 })
        ).toEqual({ secondsLeft: 0, fractionLeft: 0 });
    });
});

describe('formatSeconds', () => {
    it('shows minutes and zero-padded seconds', () => {
        expect(formatSeconds(150)).toBe('2:30');
        expect(formatSeconds(65)).toBe('1:05');
        expect(formatSeconds(9)).toBe('0:09');
    });
});
