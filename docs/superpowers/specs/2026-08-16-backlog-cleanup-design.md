# Backlog Cleanup Design

**Date:** 2026-08-16
**Status:** Approved

## Problem

Four small, independent items sat open in `docs/improvements.md` (47, 48,
49, 50) — none urgent, all low-priority, but all cheap to close out now
that nothing else is blocking them.

## Decisions

Bundle all four into one plan since each is a small, independent,
low-risk change with no interdependency, and none is large enough to
justify its own spec/plan cycle on its own.

**#47 / #49 — delete outright**, matching this repo's established
dead-code convention (`docs/improvements.md` item 14): both functions
have zero production callers, confirmed by grep this session.
`addPlayerForRoom` also has a dedicated 7-test integration describe
block that goes with it. `firestore.rules`' `players/{playerId}` write
grant needs no change for either deletion — it's the same generic
host-write rule every other player-mutating function still depends on,
not something scoped to either of these two.

**#48 — fix the leak, following the backlog item's own suggested fix**
exactly: a `useEffect` cleanup that revokes `previewUrl` on unmount, plus
an explicit revoke in `handleFileChange`'s `catch` branch for the case
where compression fails after a previous successful capture already
produced a `previewUrl`.

**#50 — fail loudly instead of silently skipping.** Confirmed with the
user: if `undoKillPlayer` can't resolve one of the snapshotted players, the
whole undo should fail with a clear error rather than silently completing
a partial restore. Since the restore already runs inside one Firestore
transaction, throwing from within it aborts every write in that
transaction automatically — no partial-state risk is introduced by this
change, it only changes what happens on the already-rare "player not
found" path from "silently continue" to "cleanly fail." Item 50's other,
larger concern (undo's blast radius being unbounded in time) stays
out of scope — it would need a genuinely different design (some kind of
staleness/version check), not a small fix.

## Components

### `src/components/firebase_calls/dbCalls.js` (modified)

Delete the `addPlayerForRoom` function (lines 273-294 as of this writing)
and the `remapPlayerAsTarget` function (lines 473-491 as of this writing)
in full, including their doc comments.

### `src/components/firebase_calls/dbCalls.integration.test.js` (modified)

Delete the entire `describe('addPlayerForRoom', () => { ... })` block (7
tests) in full. No changes needed for `remapPlayerAsTarget` — it has no
dedicated test.

### `src/components/player_messages_components/MessageComposer.js` (modified)

Add, alongside the existing state:

```jsx
useEffect(() => {
    return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
}, [previewUrl]);
```

And in `handleFileChange`'s `catch` block, revoke the stale `previewUrl`
before the error path completes:

```jsx
} catch (compressError) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    console.error('Error compressing photo:', compressError);
    setPhotoError('Could not read that photo. Try taking it again.');
}
```

(`useEffect` needs importing alongside the existing `useRef`/`useState`
import from `react`.)

### `functions/callableFunctions/undoKillPlayer.js` (modified)

In the restore loop's not-found branch, replace:

```js
if (playerSnapshot.empty) {
    console.warn(`undoKillPlayer: player not found, skipping restore: ${key}`);
    continue;
}
```

with:

```js
if (playerSnapshot.empty) {
    throw new functions.https.HttpsError(
        'failed-precondition',
        `Cannot undo: player ${key} no longer exists.`
    );
}
```

## Testing

- `dbCalls.integration.test.js`: no new tests — deletion only. Run the
  full suite to confirm nothing else depended on either deleted function.
- `MessageComposer.test.jsx`: two new tests — revokes `previewUrl` on
  unmount when a preview exists; revokes the previous `previewUrl` when a
  second file selection's compression fails after a first one succeeded.
- `undoKill.integration.test.js`: one new emulator test — undo of an
  approved kill whose snapshot references a player who no longer exists
  (e.g. seed the room, kill, approve, then delete that player's doc
  directly before calling `undoKill`) rejects with the new error message,
  and no player document in the room was mutated by the attempt.

## Error handling

`undoKillPlayer`'s new throw uses the same `HttpsError` pattern already
used elsewhere in the same file — no new error-handling infrastructure.
`MessageComposer.js`'s new revoke calls are synchronous, side-effect-only,
and cannot themselves throw in a way that needs handling beyond what's
already there.

## Out of scope

- `docs/improvements.md` items 47/48/49/50 get marked ✅ Resolved once
  this lands, in past tense, following this session's established
  convention for closing out tracked items.
- Item 50's blast-radius concern (no staleness/version guard) — explicitly
  not addressed here, per the Decisions section above.
- No change to `firestore.rules`.
