/**
 * Layer 2 — Firestore security rules, against the emulator.
 *
 * Run with `npm run test:rules`, which starts the Firestore emulator around
 * them. @firebase/rules-unit-testing mints synthetic authenticated /
 * unauthenticated contexts directly, so unlike the integration project this
 * does not touch the Auth emulator or the real client SDK in
 * src/utils/firebase.js.
 *
 * See docs/improvements.md item 2 for the design and docs/testing.md's
 * "Layer 2" section for the four baseline assertions these are built from.
 * Reads are additionally scoped to "host or player of this room" as of
 * docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md
 * — PLAYER_UID below is a player who has joined room-a (present in its
 * joinedUids array); OTHER_UID is a signed-in stranger who has not.
 *
 * A separate `allow list` grant (docs/superpowers/specs/2026-08-08-
 * dashboard-removal-design.md) lets a host query `rooms` filtered to their
 * own hostId, so DashBoard.js can find a room they're already running
 * instead of always creating a new one. Firestore only allows a `list`
 * query when the rule is provably true for every possible result of that
 * exact query shape — a `get()`-based check like isHostOfExistingRoom
 * can't be proven that way, so this grant checks `resource.data` directly.
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    where,
    collectionGroup,
    deleteDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-mall-mystery-heroes';
const HOST_UID = 'host-uid';
const OTHER_UID = 'other-uid';
const PLAYER_UID = 'player-uid';

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
            host: 'localhost',
            port: 8081,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seeding bypasses rules entirely, same reason emulatorHelpers.seedRoom
    // does not go through dbCalls: the rules under test should not gate setup.
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'rooms', 'room-a'), {
            hostId: HOST_UID,
            isGameActive: true,
            taskIndex: 1,
            joinedUids: [PLAYER_UID],
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), {
            name: 'alice',
            score: 10,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'players', 'bob'), {
            name: 'bob',
            score: 10,
            uid: PLAYER_UID,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), {
            title: 'Find the fountain',
            isComplete: false,
        });
        await setDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1'), {
            playerName: 'alice',
            trimmedNameLowerCase: 'alice',
            requestingUid: OTHER_UID,
            status: 'pending',
        });
    });
});

describe('rooms/{roomId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows a player who has joined this room to read it', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows the host to read their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a')));
    });

    it('allows a signed-in user to read a room ID that does not exist yet (checkForRoomIDDupes)', async () => {
        // handleHostRoom / checkForRoomIDDupes reads a candidate room ID
        // specifically expecting it not to exist yet. Nobody can be the
        // host or a joined player of a room that was never created, so
        // this must succeed (with an exists()===false snapshot) for any
        // signed-in user, not error out or come back permission-denied.
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'totally-nonexistent-room-id')));
    });

    it('allows the host to list rooms filtered to their own hostId (DashBoard resume-room lookup)', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        const roomsQuery = query(collection(db, 'rooms'), where('hostId', '==', HOST_UID));
        const snapshot = await assertSucceeds(getDocs(roomsQuery));
        expect(snapshot.docs.map((d) => d.id)).toEqual(['room-a']);
    });

    it('denies listing rooms filtered to someone elses hostId', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        const roomsQuery = query(collection(db, 'rooms'), where('hostId', '==', HOST_UID));
        await assertFails(getDocs(roomsQuery));
    });

    // isGameActive used to be the example payload for these three generic
    // tests, but it's now one of the fields the endGame Cloud Function
    // exclusively owns (see the `game boundary` describe block below) — an
    // ordinary field (taskIndex) keeps these three testing what they're
    // meant to test (who may update at all), not the field exclusion.
    it('allows the host to update their own room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(updateDoc(doc(db, 'rooms', 'room-a'), { taskIndex: 2 }));
    });

    it('denies a non-host update to another room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(updateDoc(doc(db, 'rooms', 'room-a'), { taskIndex: 2 }));
    });

    it('denies a joined player from updating a room they did not host', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(updateDoc(doc(db, 'rooms', 'room-a'), { taskIndex: 2 }));
    });

    it('allows a signed-in user to create a room they claim as their own', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(
            setDoc(doc(db, 'rooms', 'room-b'), {
                hostId: OTHER_UID,
                isGameActive: true,
                taskIndex: 1,
            })
        );
    });

    it('denies creating a room claimed as hosted by someone else', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'room-c'), {
                hostId: HOST_UID,
                isGameActive: true,
                taskIndex: 1,
            })
        );
    });
});

describe('subcollections of a room ID that does not exist yet (regression: previous fix round made isHostOfExistingRoom/isPlayerOfRoom return true for a nonexistent room, which — since those two functions are shared by the subcollection rules below — opened a public read/write hole under any made-up room ID)', () => {
    it('denies a signed-in stranger writing into players/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'players', 'evil'), {
                name: 'evil',
                score: 0,
            })
        );
    });

    it('denies a signed-in stranger reading players/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            getDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'players', 'anything'))
        );
    });

    it('denies a signed-in stranger writing into tasks/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            setDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'tasks', 'evil'), {
                title: 'evil',
                isComplete: false,
            })
        );
    });

    it('denies a signed-in stranger reading tasks/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            getDoc(doc(db, 'rooms', 'totally-nonexistent-room-id', 'tasks', 'anything'))
        );
    });

    it('denies a signed-in stranger writing into logs/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'totally-nonexistent-room-id', 'logs'), {
                log: 'evil',
                color: 'gray',
            })
        );
    });

    it('denies a signed-in stranger reading logs/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'totally-nonexistent-room-id', 'logs')));
    });

    it('denies a signed-in stranger writing into photos/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'totally-nonexistent-room-id', 'photos'), {
                url: 'evil',
                status: 'pending',
            })
        );
    });

    it('denies a signed-in stranger writing into playerMessages/ under a nonexistent room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'totally-nonexistent-room-id', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'evil',
                standings: null,
            })
        );
    });
});

describe('rooms/{roomId}/players/{playerId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('allows a player who has joined this room to read the roster', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'players', 'alice')));
    });

    it('allows a player who has joined this room to list the full players collection', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        const snapshot = await assertSucceeds(
            getDocs(collection(db, 'rooms', 'room-a', 'players'))
        );
        expect(snapshot.docs.map((d) => d.id).sort()).toEqual(['alice', 'bob']);
    });

    it('denies a signed-in stranger from listing the full players collection', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'players')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), { score: 999 })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            updateDoc(doc(db, 'rooms', 'room-a', 'players', 'alice'), { score: 15 })
        );
    });
});

describe('rooms/{roomId}/reconnectRequests/{requestId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it('allows the host to read', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it('allows the requester named on the request to read their own request', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it("denies a signed-in stranger who isn't the host or the requester", async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1')));
    });

    it('denies any client write, even from the host', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'reconnectRequests', 'request-1'), {
                status: 'approved',
            })
        );
    });

    it('allows the host to list pending requests', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        const requestsQuery = query(
            collection(db, 'rooms', 'room-a', 'reconnectRequests'),
            where('status', '==', 'pending')
        );
        await assertSucceeds(getDocs(requestsQuery));
    });
});

describe('rooms/{roomId}/tasks/{taskId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('allows a player who has joined this room to read tasks', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            updateDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), { isComplete: true })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            updateDoc(doc(db, 'rooms', 'room-a', 'tasks', 'task-1'), { isComplete: true })
        );
    });
});

describe('rooms/{roomId}/logs/{logId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('allows a player who has joined this room to read logs', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'logs')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'logs'), { log: 'x', color: 'gray' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'logs'), { log: 'x', color: 'gray' })
        );
    });
});

describe('rooms/{roomId}/photos/{photoId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('allows a player who has joined this room to read photos', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'photos')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), { url: 'x', status: 'pending' })
        );
    });

    it('denies a player creating a photo directly (removed — submitKillPhoto is now the only path)', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'photos'), {
                url: 'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Froom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token',
                assassin: 'bob',
                target: 'alice',
                status: 'pending',
                originalPlayerData: null,
            })
        );
    });
});

describe('rooms/{roomId}/playerMessages/{messageId}', () => {
    it('denies an unauthenticated read', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('denies a signed-in stranger who is neither the host nor a player of this room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('allows a player who has joined this room to read player messages', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDocs(collection(db, 'rooms', 'room-a', 'playerMessages')));
    });

    it('denies a non-host write', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'x',
                standings: null,
            })
        );
    });

    it('allows the host to write', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'broadcast',
                recipient: null,
                text: 'x',
                standings: null,
            })
        );
    });

    it('denies a player creating a chat message directly (removed — submitChatMessage is now the only path)', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertFails(
            addDoc(collection(db, 'rooms', 'room-a', 'playerMessages'), {
                type: 'chat',
                recipient: null,
                text: 'hey where are you',
                standings: null,
                mission: null,
                sender: 'bob',
            })
        );
    });
});

describe('players collection group (session recovery)', () => {
    it('allows a query scoped to the callers own uid', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        const playersQuery = query(collectionGroup(db, 'players'), where('uid', '==', PLAYER_UID));
        const snapshot = await assertSucceeds(getDocs(playersQuery));
        expect(snapshot.docs.map((d) => d.id)).toEqual(['bob']);
    });

    it('denies a query scoped to a different uid than the caller', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        const playersQuery = query(collectionGroup(db, 'players'), where('uid', '==', HOST_UID));
        await assertFails(getDocs(playersQuery));
    });

    it('denies an unauthenticated query entirely', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        const playersQuery = query(collectionGroup(db, 'players'), where('uid', '==', PLAYER_UID));
        await assertFails(getDocs(playersQuery));
    });
});

describe('game boundary: rooms/{roomId}/boundaryStatuses and boundaryEvents, and the gameBoundary field', () => {
    // Denials are asserted as permission-denied specifically, not just "failed",
    // so a typo or a wrong-path error cannot pass as a rules denial.
    async function expectPermissionDenied(promise) {
        const error = await assertFails(promise);
        expect(error.code).toBe('permission-denied');
    }

    beforeEach(async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice'), {
                status: 'inside',
            });
            await setDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'bob'), {
                status: 'outside',
            });
            await setDoc(doc(db, 'rooms', 'room-a', 'boundaryEvents', 'event-1'), {
                playerId: 'bob',
                kind: 'exit',
            });
        });
    });

    it('allows the host to read all boundaryStatuses in their room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        const snapshot = await assertSucceeds(
            getDocs(collection(db, 'rooms', 'room-a', 'boundaryStatuses'))
        );
        expect(snapshot.docs.map((d) => d.id).sort()).toEqual(['alice', 'bob']);
    });

    it('allows the host to read all boundaryEvents in their room', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        const snapshot = await assertSucceeds(
            getDocs(collection(db, 'rooms', 'room-a', 'boundaryEvents'))
        );
        expect(snapshot.docs.map((d) => d.id)).toEqual(['event-1']);
    });

    it('allows a player to read their own boundaryStatuses doc', async () => {
        // bob's players/bob doc carries uid: PLAYER_UID, which is what the
        // ownership check resolves against.
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'bob')));
    });

    it('allows a player to read their own boundaryStatuses doc while it is NOT outside (isOwnBoundaryStatus in isolation)', async () => {
        // The existing "allows a player to read their own boundaryStatuses
        // doc" test above reads bob's doc while it is seeded 'outside' in
        // this block's beforeEach — since the outside-status clause also
        // grants that read to ANY player, that test no longer isolates the
        // isOwnBoundaryStatus clause; it would still pass even if that
        // clause were deleted entirely. This test flips bob's own doc to a
        // non-outside status first, so only the own-doc clause can be the
        // one making it succeed.
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'rooms', 'room-a', 'boundaryStatuses', 'bob'), {
                status: 'inside',
            });
        });
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'bob')));
    });

    it("denies a player reading another player's boundaryStatuses doc while it is inside", async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice'))
        );
    });

    it("denies a player reading another player's boundaryStatuses doc while it is near", async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'rooms', 'room-a', 'boundaryStatuses', 'alice'), {
                status: 'near',
            });
        });
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice'))
        );
    });

    it("denies a player reading another player's boundaryStatuses doc while it is unavailable", async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'rooms', 'room-a', 'boundaryStatuses', 'alice'), {
                status: 'unavailable',
            });
        });
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice'))
        );
    });

    it('denies a player listing boundaryStatuses', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            getDocs(collection(db, 'rooms', 'room-a', 'boundaryStatuses'))
        );
    });

    it("allows a player to read ANOTHER player's boundaryStatuses doc once it reads outside", async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        // PLAYER_UID owns bob's player doc (see this block's beforeEach/seed),
        // so reading bob's own status is the "own doc" case already covered
        // elsewhere — this test is specifically about a DIFFERENT player
        // (alice) whose status is NOT outside, confirming the new clause does
        // not open her door, then flips it to outside and confirms it does.
        await expectPermissionDenied(
            getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice'))
        );

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'rooms', 'room-a', 'boundaryStatuses', 'alice'), {
                status: 'outside',
            });
        });

        await assertSucceeds(getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'alice')));
    });

    it('returns only the currently-outside players from a status-filtered list query, for a non-host player', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        const outsideQuery = query(
            collection(db, 'rooms', 'room-a', 'boundaryStatuses'),
            where('status', '==', 'outside')
        );
        const snapshot = await assertSucceeds(getDocs(outsideQuery));
        // bob is seeded as 'outside' in this block's beforeEach; alice is
        // 'inside' and must not appear even though the query ran successfully.
        expect(snapshot.docs.map((d) => d.id)).toEqual(['bob']);
    });

    it('still denies an unfiltered list of boundaryStatuses for a non-host player, even though some documents in the room are outside', async () => {
        // The new rule clause makes SOME documents in this room readable to
        // this player (bob's, since it's outside) but not ALL of them
        // (alice's, which is inside) — Firestore cannot prove an unfiltered
        // list query safe under a rule that only some candidate documents
        // satisfy, so the whole query must still be denied, exactly as the
        // pre-existing 'denies a player listing boundaryStatuses' test already
        // asserts for the pre-change rule. This test exists specifically to
        // confirm that invariant survives this rule change.
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            getDocs(collection(db, 'rooms', 'room-a', 'boundaryStatuses'))
        );
    });

    it('denies a signed-in non-member reading any boundaryStatuses or boundaryEvents in another room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await expectPermissionDenied(getDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'bob')));
        await expectPermissionDenied(
            getDocs(collection(db, 'rooms', 'room-a', 'boundaryStatuses'))
        );
        await expectPermissionDenied(getDocs(collection(db, 'rooms', 'room-a', 'boundaryEvents')));
    });

    it('denies a host writing boundaryStatuses (update, create)', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'bob'), { status: 'inside' })
        );
        await expectPermissionDenied(
            setDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'carol'), { status: 'inside' })
        );
    });

    it('denies a player writing their own boundaryStatuses doc', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a', 'boundaryStatuses', 'bob'), { status: 'inside' })
        );
    });

    it('denies a host writing boundaryEvents (create, update)', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            addDoc(collection(db, 'rooms', 'room-a', 'boundaryEvents'), {
                playerId: 'alice',
                kind: 'exit',
            })
        );
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a', 'boundaryEvents', 'event-1'), { kind: 'enter' })
        );
    });

    it('denies a player writing boundaryEvents', async () => {
        const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
        await expectPermissionDenied(
            addDoc(collection(db, 'rooms', 'room-a', 'boundaryEvents'), {
                playerId: 'bob',
                kind: 'exit',
            })
        );
    });

    it('denies a host updating the gameBoundary field directly', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a'), { gameBoundary: { enabled: true } })
        );
    });

    it('denies a host mixing a gameBoundary change into an ordinary room update', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a'), {
                taskIndex: 2,
                gameBoundary: { enabled: true },
            })
        );
    });

    it('allows a host updating an ordinary room field (taskIndex)', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(updateDoc(doc(db, 'rooms', 'room-a'), { taskIndex: 2 }));
    });

    // isGameActive/endedAt are now written only by the endGame Cloud
    // Function (functions/callableFunctions/endGame.js), which also clears
    // exposure in the same transaction — a direct client write to either
    // field would skip that entirely, so both are excluded the same way
    // gameBoundary is above.
    it('denies a host updating isGameActive directly', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a'), { isGameActive: false })
        );
    });

    it('denies a host updating endedAt directly', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a'), { endedAt: new Date() })
        );
    });

    it('denies a host mixing an isGameActive change into an ordinary room update', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await expectPermissionDenied(
            updateDoc(doc(db, 'rooms', 'room-a'), {
                taskIndex: 2,
                isGameActive: false,
            })
        );
    });

    it('allows the host to delete their own room (delete is not restricted by the gameBoundary rule)', async () => {
        const db = testEnv.authenticatedContext(HOST_UID).firestore();
        await assertSucceeds(deleteDoc(doc(db, 'rooms', 'room-a')));
    });

    it('denies a non-host deleting the room', async () => {
        const db = testEnv.authenticatedContext(OTHER_UID).firestore();
        await expectPermissionDenied(deleteDoc(doc(db, 'rooms', 'room-a')));
    });
});
