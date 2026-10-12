# Kill Photo URL Validation Design

**Date:** 2026-08-18
**Status:** Approved

## Problem

A security audit this session found (`docs/improvements.md`, tracked
under the live-game-flow audit) that `firestore.rules`'s `photos/{photoId}`
`allow create` rule validates `status`/`originalPlayerData` but nothing
about the submitted `url` field. `GamePhotos.js` renders `photo.url`
directly into an `<Image src>`. A modified client (bypassing the normal
camera-capture flow and calling `addPhotoForRoom` directly) can submit an
arbitrary external URL — not script-executing, but it beacons the GM's
browser to an attacker-controlled host on render, and it can substitute
arbitrary imagery for a kill's "evidence" photo. Re-verified this session:
the gap is still exactly as originally found — `GamePhotos.js:9` (`<Image
src={photo.url} ... />`), `firestore.rules:106-118` (the `photos` match
block, `allow create` at lines 115-117, checking only `status` and
`originalPlayerData`).

## Decisions

- **Validation lives in `firestore.rules`**, not client-side only. A
  client-side check (e.g. a `startsWith` guard before upload) is trivially
  bypassed by a modified client calling `addPhotoForRoom` directly — the
  same weak-mitigation category as the client-only length caps shipped
  earlier this session (`docs/improvements.md` item 57), which explicitly
  deferred this class of enforcement to a rules-level fix. This collection
  already has precedent for tight `allow create` field-shape checks
  (`status`, `originalPlayerData`) to build on.
- **The check is host-agnostic, matched against the Storage path
  structure, not the URL's origin.** Firebase Storage download URLs differ
  by host between production (`firebasestorage.googleapis.com`) and the
  Storage emulator (`localhost:9199`, per
  `connectStorageEmulator(storage, 'localhost', 9199)` in
  `src/utils/firebase.js`) — only the host/port differs; the
  `/v0/b/<bucket>/o/<url-encoded-path>` path shape is identical in both.
  A rule that only accepted the production host would break every
  existing `npm run test:emulator` photo-upload test. Matching on the
  path segment instead works unchanged in both environments, and as a
  side benefit also rejects a URL that references a different room's
  photos, not just a non-Firebase host.

## Components

### `firestore.rules` (modified)

The `photos/{photoId}` match block's existing `allow create`:

```
allow create: if isPlayerOfRoom(roomId) &&
  request.resource.data.status == 'pending' &&
  request.resource.data.originalPlayerData == null;
```

gains one more clause, requiring `url` to contain this room's exact
Storage path segment:

```
allow create: if isPlayerOfRoom(roomId) &&
  request.resource.data.status == 'pending' &&
  request.resource.data.originalPlayerData == null &&
  request.resource.data.url.matches('.*/o/rooms%2F' + roomId + '%2Fphotos%2F.*');
```

`roomId` is already in scope as the enclosing `match /rooms/{roomId}/...`
path variable — no new rule-level helper needed. `%2F` is Firebase
Storage's own URL-encoding of `/` in the object path
(`rooms/{roomId}/photos/{photoID}.jpg` → `rooms%2F{roomId}%2Fphotos%2F...`),
confirmed against `storageCalls.js`'s `uploadKillPhoto`, which constructs
the object path exactly this way before calling `getDownloadURL`.

Room IDs are always generated server-side via `uniqueNamesGenerator`
(`DashBoard.js`, adjective + digits, e.g. `"Fluffy42317"`) — never
user-typed — so `roomId` cannot contain characters that would break the
regex when concatenated in.

### No client-side change

`MessageComposer.js`'s real upload flow (`uploadKillPhoto` →
`getDownloadURL` → `addPhotoForRoom`) already produces a URL matching this
shape; legitimate submissions are unaffected. No other file changes.

## Testing

One new case in `test/firestore.rules.test.js`, inside (or adjacent to)
the existing `rooms/{roomId}/photos/{photoId}` describe block: a signed-in
player attempting to create a `photos` doc with a fabricated `url` (e.g.
`https://evil.example.com/x.jpg`) is denied, with `status`/
`originalPlayerData` otherwise valid — isolating the new check as the
reason for the denial. Existing legitimate-submission tests in this same
block (and the emulator-backed `storageCalls.integration.test.js`/
`dbCalls.integration.test.js` photo tests, which exercise real
`getDownloadURL` output against the emulator) must continue passing
unmodified, proving the new check doesn't reject real uploads.

## Error handling

No new error-handling code — a rejected `create` surfaces the same way
every other `firestore.rules` denial already does in this app (a rejected
promise from the client SDK write call), no new path to build.

## Out of scope

- Binding a photo to the identity of whoever actually submitted it
  (verifying the claimed `assassin` matches the caller) — a separate,
  larger finding already parked in this session's planned security-cluster
  batch, not addressed here.
- Any change to `storage.rules` or the upload path itself.
