/**
 * Layer 2 — Firebase Storage security rules, against the emulator.
 *
 * Run with `npm run test:rules`, which now also starts the Storage
 * emulator (package.json's test:rules script gained `,storage` alongside
 * firestore for this file). This repo's first storage.rules test file —
 * mirrors test/firestore.rules.test.js's @firebase/rules-unit-testing
 * setup, adapted for the `storage` emulator option instead of `firestore`
 * (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

const PROJECT_ID = 'demo-mall-mystery-heroes';
const testBytes = new Uint8Array([1, 2, 3, 4]);

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        storage: {
            rules: fs.readFileSync(path.resolve(__dirname, '../storage.rules'), 'utf8'),
            host: 'localhost',
            port: 9199,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearStorage();
});

describe('rooms/{roomId}/photos/**', () => {
    it("allows a signed-in user to write into a room's photos path for the first time", async () => {
        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertSucceeds(uploadBytes(ref(storage, 'rooms/room-a/photos/photo.jpg'), testBytes));
    });

    it("allows a signed-in user to read from a room's photos path", async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await uploadBytes(ref(context.storage(), 'rooms/room-a/photos/photo.jpg'), testBytes);
        });

        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertSucceeds(getBytes(ref(storage, 'rooms/room-a/photos/photo.jpg')));
    });

    it('denies an unauthenticated write', async () => {
        const storage = testEnv.unauthenticatedContext().storage();
        await assertFails(uploadBytes(ref(storage, 'rooms/room-a/photos/photo.jpg'), testBytes));
    });

    it('denies a signed-in user overwriting an existing photo (create-only)', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await uploadBytes(ref(context.storage(), 'rooms/room-a/photos/photo.jpg'), testBytes);
        });

        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertFails(
            uploadBytes(ref(storage, 'rooms/room-a/photos/photo.jpg'), new Uint8Array([9, 9, 9]))
        );
    });
});

describe('paths outside rooms/{roomId}/photos/**', () => {
    it('denies a signed-in user writing outside the photos path', async () => {
        const storage = testEnv.authenticatedContext('some-uid').storage();
        await assertFails(uploadBytes(ref(storage, 'rooms/room-a/other.jpg'), testBytes));
    });
});
