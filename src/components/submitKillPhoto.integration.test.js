/**
 * Layer 1b — the identity-verified kill-photo submission Cloud Function,
 * against the real Functions, Firestore, and Auth emulators together.
 * The client wrapper (./submitKillPhoto.js) is a two-line pass-through of
 * httpsCallable(functions, 'submitKillPhoto') bound to the process-wide
 * singleton `functions` instance, so it can't be called as a specific,
 * independently-seeded identity the way these tests need — each test calls
 * httpsCallable directly against its own identity's own `functions`
 * instance instead (`alice.functions`, or `callableAsNonHost`'s), then
 * asserts on what actually landed in Firestore, matching
 * executeKill.integration.test.js's approach
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * Most of these calls pass a `target` or `mission` claim as part of the
 * submission (matching the real flow from PhotosDisplay.js's target/mission
 * picker). A few tests checking early-validation paths (argument shape,
 * URL validity) that fire before the claim check omit both, which is valid
 * for those test scenarios.
 */
import { httpsCallable } from 'firebase/functions';
import { terminate, getDocs, Timestamp } from 'firebase/firestore';
import {
    fetchPhotosQueryByAscendingTimestampForRoom,
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
const REALISTIC_URL =
    'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Ftest-room%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('submitKillPhoto', () => {
    it("writes the photo with the caller's own real name as assassin, never a client-supplied one, carrying their claimed target", async () => {
        const alice = await createIndependentIdentity();
        try {
            // Seeded via the default (host) db, not alice.db: alice is a
            // player here, not the room's host, and firestore.rules' room
            // `allow create` requires hostId == the writer's own
            // request.auth.uid (test/emulatorHelpers.js's
            // createIndependentIdentity comment documents this same
            // constraint for a from-scratch room). Only alice's `uid` field
            // on her own player doc — not who writes the room — is what
            // submitKillPhoto's identity derivation actually depends on.
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' });

            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                assassin: 'alice',
                target: 'bob',
                mission: null,
                url: REALISTIC_URL,
                status: 'pending',
                originalPlayerData: null,
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it("also posts the photo into the room's chat, so submitting is visible without a separate confirmation", async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' });

            const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                type: 'killPhoto',
                recipient: null,
                text: null,
                standings: null,
                mission: null,
                sender: null,
                photoUrl: REALISTIC_URL,
                assassin: 'alice',
                target: null,
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a url that does not point at this room’s own Storage path', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, url: 'https://evil.example.com/x.jpg' })
            ).rejects.toThrow("url does not point at this room's own Storage path.");
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, [{ name: 'bob' }]);
        const call = callableAsNonHost('submitKillPhoto');

        await expect(call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })).rejects.toThrow(
            'You are not a player of this room.'
        );
    });

    it('rejects a caller whose uid is linked to more than one player doc in the room', async () => {
        const alice = await createIndependentIdentity();
        try {
            // Reachable today: joinRoom only enforces *name* uniqueness, so
            // the same uid revisiting /join under a second name owns two
            // player docs in one room (docs/improvements.md item 66). Both
            // functions used to take docs[0] silently, attributing every
            // claim to whichever name sorted first.
            await seedRoom(ROOM, [
                { name: 'alice', uid: alice.uid },
                { name: 'alice2', uid: alice.uid },
                { name: 'bob' },
            ]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })).rejects.toThrow(
                'Multiple player identities are linked to your account in this room'
            );

            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(0);
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects once the game has ended', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }], {
                isGameActive: false,
            });
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })).rejects.toThrow(
                'This game has ended.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a submission missing roomId or url', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ url: REALISTIC_URL })).rejects.toThrow(
                'roomId and url are both required.'
            );
            await expect(call({ roomId: ROOM })).rejects.toThrow(
                'roomId and url are both required.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('allows up to 10 submissions in a window and rejects the 11th', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            for (let i = 0; i < 10; i += 1) {
                await expect(
                    call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })
                ).resolves.toBeDefined();
            }

            await expect(call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })).rejects.toThrow(
                'Too many submissions'
            );
        } finally {
            await terminate(alice.db);
        }
    }, 30000);

    it('allows a submission again once the window has elapsed, even if the cap was reached', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [
                {
                    name: 'alice',
                    uid: alice.uid,
                    rateLimits: {
                        photo: {
                            windowStart: Timestamp.fromMillis(Date.now() - 61000),
                            count: 10,
                        },
                    },
                },
                { name: 'bob' },
            ]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob' })
            ).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });

    it('persists a valid mission claim onto the photo doc instead of a target', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await call({ roomId: ROOM, url: REALISTIC_URL, mission: 3 });

            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs[0].data()).toMatchObject({ target: null, mission: 3 });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a submission with neither a target nor a mission, writing nothing', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, url: REALISTIC_URL })).rejects.toThrow(
                'Exactly one of target or mission must be provided.'
            );
            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(0);
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a submission with both a target and a mission, writing nothing', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(
                call({ roomId: ROOM, url: REALISTIC_URL, target: 'bob', mission: 3 })
            ).rejects.toThrow('Exactly one of target or mission must be provided.');
            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(0);
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a blank-string target, writing nothing', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, url: REALISTIC_URL, target: '   ' })).rejects.toThrow(
                'Exactly one of target or mission must be provided.'
            );
            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(0);
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a non-integer mission, writing nothing', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }, { name: 'bob' }]);
            const call = httpsCallable(alice.functions, 'submitKillPhoto');

            await expect(call({ roomId: ROOM, url: REALISTIC_URL, mission: 1.5 })).rejects.toThrow(
                'Exactly one of target or mission must be provided.'
            );
            const snapshot = await getDocs(fetchPhotosQueryByAscendingTimestampForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(0);
        } finally {
            await terminate(alice.db);
        }
    });
});
