import { doc, setDoc, terminate, getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { signInAnonymously, getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { initializeApp } from 'firebase/app';
import { auth, db } from '../src/utils/firebase';
import { readFirebaseConfig } from '../src/utils/firebaseEnv';

const PROJECT_ID = process.env.REACT_APP_PROJECTID;
const HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081';

/**
 * dbCalls runs as a signed-in host in the real app, and now that
 * firestore.rules requires auth (docs/improvements.md item 2), it has to
 * here too. Signs in once (against the Auth emulator — see
 * test:emulator's `--only firestore,auth`) and reuses the resulting uid as
 * every seeded room's hostId, so dbCalls' writes are always the host.
 */
let hostUidPromise;

const hostUid = () => {
    if (!hostUidPromise) {
        hostUidPromise = signInAnonymously(auth).then((credential) => credential.user.uid);
    }
    return hostUidPromise;
};

/**
 * Wipes every document in the emulator. Call in beforeEach so tests cannot
 * depend on each other's leftovers.
 */
export const clearFirestore = async () => {
    const url = `http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
        throw new Error(
            `Could not clear the Firestore emulator (${response.status}). ` +
                'Is it running? These tests are meant to be run via `npm run test:emulator`.'
        );
    }
};

/** Closes the client so Jest's worker can exit. */
export const shutdown = () => terminate(db);

/**
 * A second, independent signed-in identity — a distinct anonymous user on
 * its own Firebase app instance, connected to the same emulators. The
 * default `db`/`auth`/`functions` in `src/utils/firebase.js` are one
 * process-wide singleton signed in once as `hostUid()`; testing "a
 * non-host calls a callable function" needs a genuinely different caller,
 * not just a different `hostId` string, since a Cloud Function checks
 * `context.auth.uid` — the identity a real request actually carried, not
 * anything the test can just assert into existence.
 */
export const callableAsNonHost = (functionName) => {
    const app = initializeApp(readFirebaseConfig(process.env), `non-host-${Date.now()}`);
    const nonHostAuth = getAuth(app);
    const nonHostFunctions = getFunctions(app);
    connectAuthEmulator(nonHostAuth, 'http://localhost:9099');
    connectFunctionsEmulator(nonHostFunctions, 'localhost', 5001);

    const callable = httpsCallable(nonHostFunctions, functionName);
    return async (data) => {
        await signInAnonymously(nonHostAuth);
        return callable(data);
    };
};

/**
 * Seeds a room with players. Writes the same fields `joinRoom` and
 * `DashBoard` write, so tests exercise realistic documents.
 *
 * `dbInstance` defaults to the shared singleton `db` (every existing caller's
 * behavior, unchanged) but can be overridden with an independent identity's
 * own Firestore instance from `createIndependentIdentity` below — needed
 * when a test wants to seed a room authored by someone other than whoever
 * is currently signed in on the shared singleton (see that function's
 * comment).
 */
export const seedRoom = async (roomID, players = [], roomOverrides = {}, dbInstance = db) => {
    await setDoc(doc(dbInstance, 'rooms', roomID), {
        taskIndex: 1,
        hostId: await hostUid(),
        isGameActive: true,
        gameStarted: false,
        storageReference: [],
        ...roomOverrides,
    });

    for (const player of players) {
        const name = typeof player === 'string' ? player : player.name;
        const extra = typeof player === 'string' ? {} : player;
        const fields = {
            name,
            trimmedNameLowerCase: name.replace(/\s/g, '').toLowerCase(),
            score: 0,
            isAlive: true,
            openSeason: false,
            targets: [],
            assassins: [],
            ...extra,
        };

        // Setting a field to `undefined` means "write a document without this
        // field" — Firestore rejects undefined values outright, and omitting
        // the field is what a legacy document actually looks like.
        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined) delete fields[key];
        }

        // Keyed on trimmedNameLowerCase to match the scheme every player-doc
        // creator uses (see fetchPlayerReferenceForRoom's comment in dbCalls.js)
        // rather than the raw name.
        await setDoc(
            doc(dbInstance, 'rooms', roomID, 'players', fields.trimmedNameLowerCase),
            fields
        );
    }
};

/**
 * A Firestore instance that bypasses firestore.rules, for reading and seeding
 * collections the rules deliberately do not open to clients (for example
 * rooms/{roomId}/boundaryStatuses and boundaryEvents, which only Cloud
 * Functions write). The emulator treats the 'owner' mock token as admin.
 * The caller owns the lifecycle: call `terminate(...)` when done.
 */
export const createRulesBypassDb = () => {
    const app = initializeApp(
        readFirebaseConfig(process.env),
        `rules-bypass-${Date.now()}-${Math.random()}`
    );
    const bypassDb = getFirestore(app);
    connectFirestoreEmulator(bypassDb, 'localhost', 8081, { mockUserToken: 'owner' });
    return bypassDb;
};

/**
 * A second, independent signed-in identity with its own Firestore instance
 * — the Firestore-flavored sibling of `callableAsNonHost` above. Needed by
 * dbCalls.integration.test.js's player-authorized `addChatMessageForRoom`
 * test (final review, chat-send-and-efficiency): that test has to sign the
 * shared `auth`/`db` singleton — the exact instance `addChatMessageForRoom`
 * itself writes through — in as a non-host player, so it can call the real
 * function as that player. Anonymous auth has no credential to sign back
 * in as a previous identity afterward, so there's no way to "restore" the
 * shared singleton to the file-wide host once that happens. Giving the
 * test's room its own independent host (via this function, writing through
 * its own separate app/db, never touching the shared singleton) sidesteps
 * needing to: the shared singleton is free to become the player instead,
 * and nothing else needs it to still be host.
 *
 * The caller owns the returned `db`'s lifecycle: `shutdown` above only
 * terminates the shared singleton, so call `terminate(identity.db)` (from
 * `firebase/firestore`) when done with it — an un-terminated instance holds
 * the Node process's event loop open indefinitely, hanging the whole
 * `firebase emulators:exec` wrapper.
 */
export const createIndependentIdentity = async () => {
    const app = initializeApp(
        readFirebaseConfig(process.env),
        `identity-${Date.now()}-${Math.random()}`
    );
    const identityAuth = getAuth(app);
    const identityDb = getFirestore(app);
    const identityFunctions = getFunctions(app);
    connectAuthEmulator(identityAuth, 'http://localhost:9099');
    connectFirestoreEmulator(identityDb, 'localhost', 8081);
    connectFunctionsEmulator(identityFunctions, 'localhost', 5001);

    const credential = await signInAnonymously(identityAuth);
    return { uid: credential.user.uid, db: identityDb, functions: identityFunctions };
};
