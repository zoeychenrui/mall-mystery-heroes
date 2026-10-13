/**
 * Layer 1b — the power-up purchase Cloud Function, against the real
 * Functions, Firestore, and Auth emulators together. Same approach as
 * submitChatMessage.integration.test.js: the buyer is derived from the
 * caller's own signed-in identity, never a client-supplied name.
 *
 * Covers the authoritative half of POWER_UPS_SPEC.md's purchase rules —
 * points are deducted and the cooldown is stored on the player doc in one
 * transaction, and every block reason the shop UI shows is re-checked
 * here. Item effects are not implemented yet, so nothing else changes.
 */
import { httpsCallable } from 'firebase/functions';
import { getDocs, terminate } from 'firebase/firestore';
import {
    fetchLogsQueryByAscendingTimestampForRoom,
    fetchPlayerForRoom,
    fetchPlayerMessagesQueryForRoom,
} from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';
const STARTED = { gameStarted: true, isGameActive: true };

beforeEach(clearFirestore);
afterAll(shutdown);

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
        await body(httpsCallable(identity.functions, 'purchasePowerUp'));
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
        await asAlice({ alice: { score: '10' } }, async (buy) => {
            await buy({ roomId: ROOM, itemId: 'ping-targets' });
            expect((await fetchPlayerForRoom('alice', ROOM)).data().score).toBe(5);
        });
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

    it('announces a picked global ping in player chat, naming who was pinged', async () => {
        await asAlice({ alice: { score: 25 }, others: [{ name: 'bob' }] }, async (buy) => {
            await buy({ roomId: ROOM, itemId: 'global-ping-picked', targetName: 'bob' });

            expect(await pings()).toEqual([
                expect.objectContaining({
                    recipient: null,
                    text: '📍 bob has been pinged!',
                    pingedPlayer: 'bob',
                    location: null,
                }),
            ]);
            expect((await logs())[0].log).toMatch(/pinged bob$/);
        });
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

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, [], STARTED);
        const buy = callableAsNonHost('purchasePowerUp');

        await expect(buy({ roomId: ROOM, itemId: 'horcrux' })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });
});
