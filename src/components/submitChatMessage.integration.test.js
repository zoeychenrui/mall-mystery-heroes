/**
 * Layer 1b — the identity-verified chat-message submission Cloud
 * Function, against the real Functions, Firestore, and Auth emulators
 * together. Same approach as submitKillPhoto.integration.test.js and
 * executeKill.integration.test.js.
 */
import { httpsCallable } from 'firebase/functions';
import { terminate, getDocs, Timestamp } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from './firebase_calls/dbCalls';
import {
    callableAsNonHost,
    clearFirestore,
    createIndependentIdentity,
    seedRoom,
    shutdown,
} from '../../test/emulatorHelpers';

const ROOM = 'test-room';

beforeEach(clearFirestore);
afterAll(shutdown);

describe('submitChatMessage', () => {
    it("writes the message with the caller's own real name as sender, never a client-supplied one", async () => {
        const alice = await createIndependentIdentity();
        try {
            // Seeded via the default (host) db, not alice.db: alice is a
            // player here, not the room's host, and firestore.rules' room
            // `allow create` requires hostId == the writer's own
            // request.auth.uid (test/emulatorHelpers.js's
            // createIndependentIdentity comment documents this same
            // constraint for a from-scratch room). Only alice's `uid` field
            // on her own player doc — not who writes the room — is what
            // submitChatMessage's identity derivation actually depends on.
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await call({ roomId: ROOM, text: 'hey where are you' });

            const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(1);
            expect(snapshot.docs[0].data()).toMatchObject({
                type: 'chat',
                recipient: null,
                text: 'hey where are you',
                standings: null,
                mission: null,
                sender: 'alice',
            });
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a caller who is not a player of the room', async () => {
        await seedRoom(ROOM, []);
        const call = callableAsNonHost('submitChatMessage');

        await expect(call({ roomId: ROOM, text: 'hi' })).rejects.toThrow(
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
            // message to whichever name sorted first.
            await seedRoom(ROOM, [
                { name: 'alice', uid: alice.uid },
                { name: 'alice2', uid: alice.uid },
            ]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'who am i' })).rejects.toThrow(
                'Multiple player identities are linked to your account in this room'
            );

            const snapshot = await getDocs(fetchPlayerMessagesQueryForRoom(ROOM));
            expect(snapshot.docs).toHaveLength(0);
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a text longer than 500 characters', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'x'.repeat(501) })).rejects.toThrow(
                'text must be a string of 500 characters or fewer.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('accepts a text of exactly 500 characters', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'x'.repeat(500) })).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });

    it('rejects a non-string text', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: ['not', 'a', 'string'] })).rejects.toThrow(
                'text must be a string of 500 characters or fewer.'
            );
            await expect(call({ roomId: ROOM, text: { body: 'nope' } })).rejects.toThrow(
                'text must be a string of 500 characters or fewer.'
            );
        } finally {
            await terminate(alice.db);
        }
    });

    it('still allows chat once the game has ended, so players can banter on the way back', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }], { isGameActive: false });
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'hi' })).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });

    it('allows up to 20 messages in a window and rejects the 21st', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [{ name: 'alice', uid: alice.uid }]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            for (let i = 0; i < 20; i += 1) {
                await expect(call({ roomId: ROOM, text: `msg-${i}` })).resolves.toBeDefined();
            }

            await expect(call({ roomId: ROOM, text: 'msg-20' })).rejects.toThrow(
                'Too many submissions'
            );
        } finally {
            await terminate(alice.db);
        }
    }, 30000);

    it('allows a message again once the window has elapsed, even if the cap was reached', async () => {
        const alice = await createIndependentIdentity();
        try {
            await seedRoom(ROOM, [
                {
                    name: 'alice',
                    uid: alice.uid,
                    rateLimits: {
                        chat: {
                            windowStart: Timestamp.fromMillis(Date.now() - 61000),
                            count: 20,
                        },
                    },
                },
            ]);
            const call = httpsCallable(alice.functions, 'submitChatMessage');

            await expect(call({ roomId: ROOM, text: 'hi again' })).resolves.toBeDefined();
        } finally {
            await terminate(alice.db);
        }
    });
});
