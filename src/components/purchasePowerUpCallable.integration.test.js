/**
 * Layer 1b — the power-up purchase Cloud Function, against the real
 * Functions, Firestore, and Auth emulators together. Same approach as
 * submitChatMessage.integration.test.js: the buyer is derived from the
 * caller's own signed-in identity, never a client-supplied name.
 *
 * Covers the authoritative half of POWER_UPS_SPEC.md: points are
 * deducted, the cooldown stored, and the item's effect applied in one
 * transaction; every block reason the shop UI shows is re-checked here.
 * Ping snapshots read the GPS system's boundaryStatuses docs, which only
 * Cloud Functions write — seeded here through the rules-bypass instance,
 * same as executeKill.integration.test.js. The mystery box's roll uses
 * Math.random server-side, so its tests check invariants, not outcomes;
 * the odds themselves are unit-tested in src/game/powerUpEffects.test.js.
 */
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDocs, setDoc, terminate, Timestamp } from 'firebase/firestore';
import {
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
} from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    createRulesBypassDb,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';
const STARTED = { gameStarted: true, isGameActive: true };

let bypass;
beforeAll(() => {
    bypass = createRulesBypassDb();
});
beforeEach(clearFirestore);
afterAll(async () => {
    await terminate(bypass);
    await shutdown();
});

// A GPS position for `name`, as reportPlayerLocation.js would store it.
const seedLocation = (name, { lat, lng, ageMs }) =>
    setDoc(doc(bypass, 'rooms', ROOM, 'boundaryStatuses', name), {
        status: 'inside',
        lat,
        lng,
        accuracyMeters: 5,
        lastUsableReceivedAt: Timestamp.fromMillis(Date.now() - ageMs),
    });
const player = async (name) => (await fetchPlayerForRoom(name, ROOM)).data();
const messages = async (type) =>
    (await getDocs(fetchPlayerMessagesQueryForRoom(ROOM))).docs
        .map((d) => d.data())
        .filter((m) => m.type === type);

// Runs `body` as a fresh signed-in player named alice, seeded into a
// started room alongside `others`, and always tears the identity down.
const logs = async () =>
    (await getDocs(fetchLogsQueryByAscendingTimestampForRoom(ROOM))).docs.map((d) => d.data());
const pings = async () =>
    (await getDocs(fetchPlayerMessagesQueryForRoom(ROOM))).docs
        .map((d) => d.data())
        .filter((m) => m.type === 'powerUpPing');

const asAlice = async ({ alice = {}, others = [], room = STARTED }, body) => {
    const identity = await createIndependentIdentity();
    try {
        await seedRoom(ROOM, [{ name: 'alice', uid: identity.uid, ...alice }, ...others], room);
        await body(
            httpsCallable(identity.functions, 'purchasePowerUp'),
            httpsCallable(identity.functions, 'claimMysteryReward')
        );
    } finally {
        await terminate(identity.db);
    }
};

describe('purchasePowerUp', () => {
    it('deducts the price and stores a cooldown on the buyer', async () => {
        await asAlice({ alice: { score: 25 } }, async (buy) => {
            const before = Date.now();
            await buy({ roomId: ROOM, itemId: 'horcrux' });

            const alice = (await fetchPlayerForRoom('alice', ROOM)).data();
            expect(alice.score).toBe(5);
            const endsAtMs = alice.powerUpCooldowns.horcrux.toMillis();
            // 360s cooldown, measured on the server's clock.
            expect(endsAtMs).toBeGreaterThanOrEqual(before + 360000 - 5000);
            expect(endsAtMs).toBeLessThanOrEqual(Date.now() + 360000 + 5000);
        });
    });

    it('treats a string score as a number and writes a number back', async () => {
        await asAlice(
            { alice: { score: '10', targets: ['bob'] }, others: [{ name: 'bob' }] },
            async (buy) => {
                await buy({ roomId: ROOM, itemId: 'ping-targets' });
                expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
            }
        );
    });

    it('rejects a purchase the player cannot afford and changes nothing', async () => {
        await asAlice({ alice: { score: 3 } }, async (buy) => {
            await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
                'Not enough points'
            );
            const alice = (await fetchPlayerForRoom('alice', ROOM)).data();
            expect(alice.score).toBe(3);
            expect(alice.powerUpCooldowns).toBeUndefined();
        });
    });

    it('rejects a second purchase while the item is on cooldown', async () => {
        await asAlice({ alice: { score: 50 } }, async (buy) => {
            await buy({ roomId: ROOM, itemId: 'horcrux' });
            await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow('On cooldown');
            expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(30);
        });
    });

    it('requires a target for a targeted item, and it must be another alive player', async () => {
        await asAlice(
            {
                alice: { score: 50 },
                others: [{ name: 'bob' }, { name: 'carol', isAlive: false }],
            },
            async (buy) => {
                const itemId = 'block-camera';
                await expect(buy({ roomId: ROOM, itemId })).rejects.toThrow('Pick a player');
                await expect(buy({ roomId: ROOM, itemId, targetName: 'alice' })).rejects.toThrow(
                    'Pick another alive player'
                );
                await expect(buy({ roomId: ROOM, itemId, targetName: 'carol' })).rejects.toThrow(
                    'Pick another alive player'
                );
                await expect(buy({ roomId: ROOM, itemId, targetName: 'nobody' })).rejects.toThrow(
                    'Pick another alive player'
                );

                await buy({ roomId: ROOM, itemId, targetName: 'Bob' });
                expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(43);
            }
        );
    });

    it('rejects an unknown item', async () => {
        await asAlice({ alice: { score: 50 } }, async (buy) => {
            await expect(buy({ roomId: ROOM, itemId: 'free-points' })).rejects.toThrow(
                'Unknown item'
            );
        });
    });

    it('rejects purchases before the game starts and after it ends', async () => {
        await asAlice(
            { alice: { score: 50 }, room: { gameStarted: false, isGameActive: true } },
            async (buy) => {
                await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
                    'The shop is only open during a game.'
                );
            }
        );
        await clearFirestore();
        await asAlice(
            { alice: { score: 50 }, room: { gameStarted: true, isGameActive: false } },
            async (buy) => {
                await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
                    'The shop is only open during a game.'
                );
            }
        );
    });

    it('rejects an eliminated player and changes nothing', async () => {
        await asAlice({ alice: { score: 50, isAlive: false } }, async (buy) => {
            await expect(buy({ roomId: ROOM, itemId: 'watch-ad' })).rejects.toThrow(
                "Eliminated players can't shop"
            );
            expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(50);
            expect(await logs()).toEqual([]);
        });
    });

    it('logs every purchase to the GM console, without a chat message for non-pings', async () => {
        await asAlice({ alice: { score: 25 } }, async (buy) => {
            await buy({ roomId: ROOM, itemId: 'horcrux' });

            expect(await logs()).toEqual([
                expect.objectContaining({
                    log: 'alice bought Horcrux (-20 pts)',
                    color: 'orange.300',
                }),
            ]);
            expect(await pings()).toEqual([]);
        });
    });

    it("announces a picked global ping to everyone with bob's location snapshot", async () => {
        await asAlice({ alice: { score: 25 }, others: [{ name: 'bob' }] }, async (buy) => {
            await seedLocation('bob', { lat: 36.1, lng: -78.9, ageMs: 5000 });

            await buy({ roomId: ROOM, itemId: 'global-ping-picked', targetName: 'bob' });

            expect(await pings()).toEqual([
                expect.objectContaining({
                    recipient: null,
                    text: '📍 bob has been pinged!',
                    pingedPlayer: 'bob',
                    pings: [
                        expect.objectContaining({
                            name: 'bob',
                            lat: 36.1,
                            lng: -78.9,
                            isStale: false,
                        }),
                    ],
                }),
            ]);
            const logLines = (await logs()).map((l) => l.log);
            expect(logLines).toContain(
                'alice bought Global ping: picked player (-6 pts) — pinged bob'
            );
            // Fresh position — no GPS alert for the GM.
            expect(logLines.some((l) => l.startsWith('⚠️'))).toBe(false);
        });
    });

    it('still pings with a stale or missing position, and alerts the GM', async () => {
        await asAlice({ alice: { score: 25 }, others: [{ name: 'bob' }] }, async (buy) => {
            await seedLocation('bob', { lat: 36.1, lng: -78.9, ageMs: 120000 });

            await buy({ roomId: ROOM, itemId: 'global-ping-picked', targetName: 'bob' });

            expect((await pings())[0].pings[0]).toEqual(
                expect.objectContaining({ lat: 36.1, isStale: true })
            );
            expect(await logs()).toContainEqual(
                expect.objectContaining({
                    log: "⚠️ bob's location is stale (last fix 2 min ago) — check their GPS",
                    color: 'orange.500',
                })
            );
        });
    });

    it('whispers a personal ping of your targets only to you', async () => {
        await asAlice(
            { alice: { score: 25, targets: ['bob'] }, others: [{ name: 'bob' }] },
            async (buy) => {
                await seedLocation('bob', { lat: 1, lng: 2, ageMs: 1000 });

                await buy({ roomId: ROOM, itemId: 'ping-targets' });

                expect(await pings()).toEqual([
                    expect.objectContaining({
                        recipient: 'alice',
                        text: '📍 Your targets: bob',
                        pings: [expect.objectContaining({ name: 'bob', lat: 1, lng: 2 })],
                    }),
                ]);
                expect((await player('alice')).score).toBe(20);
            }
        );
    });

    it('refuses a personal ping with nobody to ping, without charging', async () => {
        await asAlice({ alice: { score: 25, assassins: [] } }, async (buy) => {
            await expect(buy({ roomId: ROOM, itemId: 'ping-assassins' })).rejects.toThrow(
                'Nobody to ping'
            );
            expect((await player('alice')).score).toBe(25);
        });
    });

    it('gives 3 points for watching an ad', async () => {
        await asAlice({ alice: { score: 0 } }, async (buy) => {
            await buy({ roomId: ROOM, itemId: 'watch-ad' });
            expect((await player('alice')).score).toBe(3);
        });
    });

    it('blocks the picked player’s camera for 30 seconds and tells only them', async () => {
        await asAlice({ alice: { score: 25 }, others: [{ name: 'bob' }] }, async (buy) => {
            const before = Date.now();
            await buy({ roomId: ROOM, itemId: 'block-camera', targetName: 'bob' });

            const blockedUntil = (await player('bob')).cameraBlockedUntil.toMillis();
            expect(blockedUntil).toBeGreaterThanOrEqual(before + 30000 - 2000);
            expect(blockedUntil).toBeLessThanOrEqual(Date.now() + 30000 + 2000);
            expect(await messages('powerUpNotice')).toEqual([
                expect.objectContaining({ recipient: 'bob' }),
            ]);
        });
    });

    it('gives the buyer a Horcrux, and refuses a second while it is active', async () => {
        await asAlice(
            {
                alice: {
                    score: 100,
                    // Past cooldown, so only the non-stacking rule can block.
                    powerUpCooldowns: { horcrux: Timestamp.fromMillis(Date.now() - 1000) },
                },
            },
            async (buy) => {
                await buy({ roomId: ROOM, itemId: 'horcrux' });
                const alice = await player('alice');
                expect(alice.horcrux).toBe(true);
                expect(alice.horcruxEndsAt).toBeNull();
            }
        );
        await clearFirestore();
        await asAlice(
            { alice: { score: 100, horcrux: true, horcruxEndsAt: null } },
            async (buy) => {
                await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
                    'Horcrux already active'
                );
            }
        );
    });

    it('rolls a mystery box: charges 4, logs the roll, and returns it for the reveal', async () => {
        await asAlice(
            {
                alice: { score: 50, targets: ['bob'], assassins: ['bob'] },
                others: [{ name: 'bob' }],
            },
            async (buy) => {
                const { data } = await buy({ roomId: ROOM, itemId: 'mystery-box' });

                expect(typeof data.mysteryBox.label).toBe('string');
                const alice = await player('alice');
                // Every outcome nets between -4 (trash) and +16 (20 points).
                expect(alice.score).toBeGreaterThanOrEqual(46);
                expect(alice.score).toBeLessThanOrEqual(66);
                expect(alice.powerUpCooldowns['mystery-box']).toBeDefined();
                expect((await logs()).map((l) => l.log)).toContain(
                    `alice bought Mystery box (-4 pts) — rolled ${data.mysteryBox.label}`
                );
                // A needs-a-player item waits for the claim; nothing else does.
                expect(alice.pendingMysteryItem !== undefined).toBe(data.mysteryBox.needsTarget);
            }
        );
    });

    it('claims a parked mystery reward on the picked player, for free, and starts its cooldown', async () => {
        await asAlice(
            { alice: { score: 10, pendingMysteryItem: 'block-camera' }, others: [{ name: 'bob' }] },
            async (buy, claim) => {
                await claim({ roomId: ROOM, targetName: 'bob' });

                const alice = await player('alice');
                expect(alice.score).toBe(10);
                expect(alice.pendingMysteryItem).toBeUndefined();
                expect(alice.powerUpCooldowns['block-camera']).toBeDefined();
                expect((await player('bob')).cameraBlockedUntil).toBeDefined();

                await expect(claim({ roomId: ROOM, targetName: 'bob' })).rejects.toThrow(
                    'No mystery box reward to claim'
                );
            }
        );
    });

    it('refuses another mystery box while a reward is unclaimed', async () => {
        await asAlice(
            { alice: { score: 10, pendingMysteryItem: 'global-ping-picked' } },
            async (buy) => {
                await expect(buy({ roomId: ROOM, itemId: 'mystery-box' })).rejects.toThrow(
                    'Claim your last mystery box reward first'
                );
            }
        );
    });

    it('picks a random other alive player for a random global ping', async () => {
        await asAlice(
            {
                alice: { score: 25 },
                others: [{ name: 'bob' }, { name: 'carol', isAlive: false }],
            },
            async (buy) => {
                await buy({ roomId: ROOM, itemId: 'global-ping-random' });

                // bob is the only eligible player: not alice, not dead carol.
                expect((await pings())[0].pingedPlayer).toBe('bob');
                expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(22);
            }
        );
    });

    it('rejects a random global ping when nobody else is alive, without charging', async () => {
        await asAlice({ alice: { score: 25 } }, async (buy) => {
            await expect(buy({ roomId: ROOM, itemId: 'global-ping-random' })).rejects.toThrow(
                'No one to ping'
            );
            expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(25);
        });
    });

    it('rate-limits to 20 calls a minute, counting rejected calls too', async () => {
        // 0 points: every purchase below is rejected ("Not enough points"),
        // which is exactly the spam the limit has to catch — a rejected
        // call still costs an invocation and reads.
        await asAlice({ alice: { score: 0 } }, async (buy, claim) => {
            for (let i = 0; i < 20; i++) {
                await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
                    'Not enough points'
                );
            }
            await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
                'Too many purchases'
            );
            // Shared with claiming a mystery reward.
            await expect(claim({ roomId: ROOM, targetName: 'bob' })).rejects.toThrow(
                'Too many purchases'
            );
        });
    });

    it('creates no rate-limit doc for a room that does not exist', async () => {
        await asAlice({}, async (buy) => {
            await expect(buy({ roomId: 'no-such-room', itemId: 'horcrux' })).rejects.toThrow(
                'Room not found'
            );
            const snapshot = await getDocs(
                collection(bypass, 'rooms', 'no-such-room', 'powerUpRateLimits')
            );
            expect(snapshot.empty).toBe(true);
        });
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, [], STARTED);
        const buy = callableAsNonHost('purchasePowerUp');

        await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });
});
