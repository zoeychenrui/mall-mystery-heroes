/**
 * Layer 1 — the data layer against the Storage emulator.
 *
 * Run with `npm run test:emulator`, which now also starts the Storage
 * emulator (package.json's test:emulator script gained `,storage`
 * alongside firestore,auth,functions for this file).
 */
import { uploadKillPhoto } from './storageCalls';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../../utils/firebase';

const ROOM = 'test-room';

beforeAll(async () => {
    await signInAnonymously(auth);
});

describe('uploadKillPhoto', () => {
    it('uploads a blob and returns a real, fetchable download URL', async () => {
        const photoBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });

        const url = await uploadKillPhoto(ROOM, photoBlob);

        expect(url).toEqual(expect.stringContaining('http'));
        const response = await fetch(url);
        expect(response.ok).toBe(true);
        const downloaded = new Uint8Array(await response.arrayBuffer());
        expect(Array.from(downloaded)).toEqual([1, 2, 3, 4]);
    });
});
