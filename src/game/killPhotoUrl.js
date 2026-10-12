/**
 * Whether `url` is a legitimate download URL for a kill-photo this room's
 * own Storage upload actually produced — the whole string must START
 * with an allowed Storage origin (production
 * `https://firebasestorage.googleapis.com`, or the
 * `http://localhost:9199` emulator origin `getDownloadURL` actually
 * returns under `npm run test:emulator`) AND carry this room's own
 * `/v0/b/{bucket}/o/rooms%2F{roomId}%2Fphotos%2F` object path, with no
 * `/` left in the trailing filename+query.
 *
 * Ported from firestore.rules's now-deleted player-facing `photos`
 * `allow create` clause (docs/improvements.md item 60 fixed the same
 * origin-pinning bug there; that history is preserved in this file's own
 * test cases, migrated verbatim). Pinning the origin is what matters: a
 * `.*` prefix would let any host qualify just by carrying the path
 * segment somewhere in its own path or query string.
 *
 * The {bucket} segment is deliberately a wildcard, not this project's own
 * bucket name: production and the emulator use different buckets
 * (`mall-mystery-heroes.firebasestorage.app` vs
 * `demo-mall-mystery-heroes.appspot.com`), and pinning the wrong one
 * would reject every real upload.
 *
 * `roomId` is regex-escaped here (unlike the rules version it replaces,
 * which spliced it in raw on the documented assumption that
 * uniqueNamesGenerator-produced room IDs never contain a regex
 * metacharacter) — cheap to do correctly, so this function makes no
 * assumption about its caller.
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * playerNames.js's convention in this directory — also required by a
 * Cloud Function via functions/vendor/game/ (functions/scripts/
 * sync-shared-game-logic.js).
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidKillPhotoUrl = (url, roomId) => {
    const pattern = new RegExp(
        '^(https://firebasestorage\\.googleapis\\.com|http://localhost:9199)' +
            '/v0/b/[^/]+/o/rooms%2F' +
            escapeRegExp(roomId) +
            '%2Fphotos%2F[^/]*$'
    );
    return pattern.test(url);
};

module.exports = { isValidKillPhotoUrl };
