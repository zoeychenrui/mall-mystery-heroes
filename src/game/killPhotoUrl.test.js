const { isValidKillPhotoUrl } = require('./killPhotoUrl');

const REALISTIC_ROOM_A_PHOTO_URL =
    'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Froom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';

const REALISTIC_EMULATOR_ROOM_A_PHOTO_URL =
    'http://localhost:9199/v0/b/demo-mall-mystery-heroes.appspot.com/o/rooms%2Froom-a%2Fphotos%2F0b68bae5-b8ab-4dfc-b675-585fb9847a9f.jpg?alt=media&token=70af1544-8755-496b-a111-b020b62d7392';

describe('isValidKillPhotoUrl', () => {
    it("accepts a realistic production download URL for this room's own Storage path", () => {
        expect(isValidKillPhotoUrl(REALISTIC_ROOM_A_PHOTO_URL, 'room-a')).toBe(true);
    });

    it("accepts a realistic Storage-emulator download URL for this room's own path", () => {
        expect(isValidKillPhotoUrl(REALISTIC_EMULATOR_ROOM_A_PHOTO_URL, 'room-a')).toBe(true);
    });

    it('rejects a url that does not point at Firebase Storage at all', () => {
        expect(isValidKillPhotoUrl('https://evil.example.com/x.jpg', 'room-a')).toBe(false);
    });

    it("rejects a url pointing at a different room's Storage path", () => {
        const url =
            'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2Fsome-other-room%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';
        expect(isValidKillPhotoUrl(url, 'room-a')).toBe(false);
    });

    // Regression cases for the origin-pinning bug (docs/improvements.md
    // item 60). The first version of this check was
    // `.*/o/rooms%2F{roomId}%2Fphotos%2F.*`, so every one of these was
    // ACCEPTED: the required path segment only had to appear somewhere in
    // the string, which an attacker controls entirely.
    const BYPASS_URLS = {
        'an external host carrying the room path segment in its own path':
            'https://evil.example.com/o/rooms%2Froom-a%2Fphotos%2Fx.jpg',
        'a lookalike host that merely starts with the real Storage host':
            'https://firebasestorage.googleapis.com.evil.example.com/v0/b/b/o/rooms%2Froom-a%2Fphotos%2Fy.jpg',
        'an external host carrying the path segment in its query string':
            'https://evil.example.com/track.gif?z=/o/rooms%2Froom-a%2Fphotos%2F',
        'a plain-http host on the local network':
            'http://10.0.0.5:8080/o/rooms%2Froom-a%2Fphotos%2Fz.jpg',
        'a host differing from the real Storage host only in a dot position':
            'https://firebasestorageXgoogleapis.com/v0/b/b/o/rooms%2Froom-a%2Fphotos%2Fw.jpg',
    };

    for (const [description, url] of Object.entries(BYPASS_URLS)) {
        it(`rejects a url that is ${description}`, () => {
            expect(isValidKillPhotoUrl(url, 'room-a')).toBe(false);
        });
    }

    it('escapes roomId so it cannot be used to smuggle regex syntax', () => {
        // Not reachable via real room IDs today (uniqueNamesGenerator
        // output has no regex metacharacters), but this function has no
        // way to know that about its caller, so it must not assume it.
        const url =
            'https://firebasestorage.googleapis.com/v0/b/mall-mystery-heroes.firebasestorage.app/o/rooms%2FXroom-a%2Fphotos%2Fabc123.jpg?alt=media&token=fake-token';
        expect(isValidKillPhotoUrl(url, '.room-a')).toBe(false);
    });
});
