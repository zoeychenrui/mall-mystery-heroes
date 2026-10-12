/**
 * Layer 1b — the scheduled room-cleanup function, against the real
 * Firestore emulator. Run with `npm run test:emulator`.
 *
 * Unlike killPlayer/joinRoom, there is no client-facing httpsCallable to
 * go through — a scheduled function's only real caller is Cloud
 * Scheduler. firebase-functions-test's wrap() invokes the .onRun()
 * handler directly instead, which is as close to "the real interface" as
 * a cron job has
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 */
const admin = require('firebase-admin');
// cleanupEndedRooms must be required before firebase-functions-test() runs:
// calling firebase-functions-test() with no config overwrites
// process.env.GCLOUD_PROJECT with a mock "not-a-project" value (see
// node_modules/firebase-functions-test/lib/lifecycle.js). cleanupEndedRooms.js
// calls admin.initializeApp() at module load with no explicit config, so it
// picks up GCLOUD_PROJECT at require-time — if firebase-functions-test() ran
// first, the Admin SDK would initialize against "not-a-project" instead of
// this suite's actual demo project, and every read/write would silently miss
// the data seedRoom (client SDK, correctly targeted) just wrote.
const { cleanupEndedRooms, setRetentionDaysForTesting } = require('./cleanupEndedRooms');
const functionsTest = require('firebase-functions-test')();
const { Bucket } = require('@google-cloud/storage');
const { clearFirestore, seedRoom, shutdown } = require('../../test/emulatorHelpers');

beforeEach(clearFirestore);
afterAll(async () => {
    functionsTest.cleanup();
    await shutdown();
});

const db = admin.firestore();

describe('cleanupEndedRooms', () => {
    it('does nothing when the retention window is unset (feature off)', async () => {
        setRetentionDaysForTesting(null);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(true);
    });

    it('deletes a room and its player subcollection once past the retention window', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(false);
        const players = await db.collection('rooms').doc('old-room').collection('players').get();
        expect(players.empty).toBe(true);
    });

    it('leaves a recently-ended room alone', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('recent-room', ['Alice'], {
            endedAt: new Date(),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('recent-room').get();
        expect(room.exists).toBe(true);
    });

    it('leaves a room that never ended alone', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('lobby-room', ['Alice']); // no endedAt override — never ended

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('lobby-room').get();
        expect(room.exists).toBe(true);
    });

    it('deletes a rooms Storage photos along with its Firestore data', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('old-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });
        await admin
            .storage()
            .bucket()
            .file('rooms/old-room/photos/test.jpg')
            .save(Buffer.from('fake-image-data'));

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('old-room').get();
        expect(room.exists).toBe(false);
        const [photoExists] = await admin
            .storage()
            .bucket()
            .file('rooms/old-room/photos/test.jpg')
            .exists();
        expect(photoExists).toBe(false);
    });

    it('skips only the failing room when its Storage delete fails, leaving other expired rooms unaffected', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('failing-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });
        await seedRoom('other-room', ['Bob'], {
            endedAt: new Date('2020-01-01'),
        });
        // Spying on a single bucket instance's own `deleteFiles` doesn't work here:
        // @google-cloud/storage's Storage.prototype.bucket() constructs a brand-new
        // Bucket object on every call (no caching), so cleanupEndedRooms.js's own
        // `admin.storage().bucket()` call gets a different object than this test's,
        // and an instance-level jest.spyOn never sees it. Spying on the shared
        // Bucket.prototype.deleteFiles instead intercepts calls through any Bucket
        // instance, including the one the implementation creates.
        const realDeleteFiles = Bucket.prototype.deleteFiles;
        const deleteFilesSpy = jest
            .spyOn(Bucket.prototype, 'deleteFiles')
            .mockImplementation(function (options) {
                if (options.prefix === 'rooms/failing-room/photos/') {
                    return Promise.reject(new Error('Simulated Storage failure'));
                }
                return realDeleteFiles.call(this, options);
            });

        try {
            await functionsTest.wrap(cleanupEndedRooms)();

            const failingRoom = await db.collection('rooms').doc('failing-room').get();
            expect(failingRoom.exists).toBe(true);
            const otherRoom = await db.collection('rooms').doc('other-room').get();
            expect(otherRoom.exists).toBe(false);
            expect(deleteFilesSpy).toHaveBeenCalledWith({ prefix: 'rooms/failing-room/photos/' });
            expect(deleteFilesSpy).toHaveBeenCalledWith({ prefix: 'rooms/other-room/photos/' });
        } finally {
            deleteFilesSpy.mockRestore();
        }
    });

    it('does nothing to Storage when a room has no photos (existing tests keep passing)', async () => {
        setRetentionDaysForTesting(3);
        await seedRoom('photoless-room', ['Alice'], {
            endedAt: new Date('2020-01-01'),
        });

        await functionsTest.wrap(cleanupEndedRooms)();

        const room = await db.collection('rooms').doc('photoless-room').get();
        expect(room.exists).toBe(false);
    });
});
