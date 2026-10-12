# Identity-Verified Player Writes Design

**Date:** 2026-08-22
**Status:** Approved

## Problem

A live-game-flow security audit this session found four related gaps,
re-verified fresh against the current codebase:

- **Kill-photo and chat identity spoofing.** `addPhotoForRoom` and
  `addChatMessageForRoom` (`src/components/firebase_calls/dbCalls.js`)
  write whatever `assassin`/`sender` string the client sends, verbatim.
  `firestore.rules`'s `photos`/`playerMessages` `allow create` rules check
  only room membership (`isPlayerOfRoom`) — never that the claimed name
  belongs to the calling `request.auth.uid`. Any signed-in room member can
  submit a kill-photo or chat message claiming to be any other named
  player in the room. `docs/data-model.md:290` already documents this
  trust level explicitly, in writing.
- **No rate limiting.** Nothing in `src/`, `functions/`, or
  `firestore.rules` throttles kill-photo or chat submissions — a scripted
  client can write as fast as the network allows.
- **No post-endgame write freeze for players.** `firestore.rules`'s
  `photos`/`playerMessages` `allow create` rules never check
  `isGameActive`. `PlayerGame.js` only _hides_ the submission UI once the
  game ends (`{isGameActive && (<>...MessageComposer...</>)}`) — a direct
  write bypassing the UI still succeeds. (This is distinct from
  `docs/improvements.md` item 51, which covers GM broadcasts after
  end-game, not player writes.)
- **Session recovery depends entirely on `localStorage`.** A returning
  player is recognized via `playerSession.js`'s `{roomID, playerName}` in
  `localStorage`. This already survives closing/reopening a tab (Firebase
  Auth's own anonymous-session persistence keeps the sign-in alive
  independently), but if `localStorage` specifically gets cleared while
  the Firebase Auth session survives, the app has no fallback and treats
  the player as new. The player doc already stores a real `uid`
  (`functions/callableFunctions/joinRoom.js:89-98`), currently unused for
  lookup — every player-scoped query in `dbCalls.js` keys off
  `trimmedNameLowerCase`, never `uid`.

## Decisions

- **Kill-photo and chat writes move into two new callable Cloud
  Functions**, `submitKillPhoto` and `submitChatMessage`
  (`functions/callableFunctions/`), mirroring the existing
  `killPlayer.js` pattern (Admin SDK, inside a transaction) — the one
  precedent this codebase already has for security-sensitive writes.
  Rejected: enforcing all of this in `firestore.rules` instead. Identity
  binding and the endgame freeze are simple single-document rule checks,
  but real rate limiting needs one write to atomically both create the
  new doc and update a rolling counter elsewhere — awkward and
  bug-prone in the rules language, straightforward as a transaction in
  plain JS.
- **Neither function accepts a client-supplied identity.** Today's
  `assassin`/`sender` string parameter is dropped entirely. Each function
  looks up the caller's own player doc by querying `players` where
  `uid == context.auth.uid` within the given room, and uses _that_
  player's real name. There is nothing left to spoof, because the client
  never claims who it is — the server derives it.
- **Both functions also enforce, in the same transaction:** the room's
  `isGameActive` must be `true` (closes the post-endgame gap), and a
  rolling rate-limit window stored on the caller's own player doc must
  not be exceeded.
- **Rate limits:** up to 10 kill-photo submissions and up to 20 chat
  messages per rolling 60-second window per player — generous burst
  allowances (chosen to comfortably cover rapid multi-kill moments and
  normal chat bursts) rather than a fixed per-submission cooldown, which
  would block legitimate rapid-fire kill-photo submission during a fast
  moment in the game. Implemented as a fixed window (not a true sliding
  window) for simplicity: if the window has expired, reset and allow;
  otherwise allow up to the cap, then reject.
- **`firestore.rules`'s player-facing `allow create` clauses on
  `photos`/`playerMessages` are removed.** Both collections also carry a
  separate `allow write: if isHostOfExistingRoom(roomId)` clause that
  authorizes GM actions (photo approve/deny/undo; broadcast/whisper/
  leaderboard/mission messages) — untouched, since it's a fully
  independent path already scoped to the host, not a player. Admin SDK
  writes from the new functions bypass rules entirely (same as every
  other Cloud-Function-only write in this app), so removing the player
  `create` clause just closes the old, spoofable direct-write path. Reads
  are unaffected — this is a write-side fix only.
- **Storage stays untouched.** `uploadKillPhoto` still uploads the photo
  blob directly from the client to Firebase Storage, governed by the
  existing `storage.rules`, unrelated to any of this. Only the second
  step — writing the Firestore doc that points at the already-uploaded
  photo — moves into `submitKillPhoto`.
- **Session recovery gets a narrow, additive fallback**, not a redesign:
  if `localStorage` has a usable room/name pair, today's fast path is
  unchanged. Only when that's missing (and the user is still signed in)
  does the client run a `collectionGroup('players')` query filtered to
  `uid == the current signed-in uid`, permitted by a new, narrowly-scoped
  `firestore.rules` rule that checks only `resource.data.uid ==
request.auth.uid` — no room lookup needed, since the query itself is
  already scoped to the caller's own uid. This does not, and cannot,
  survive switching devices/browsers or a full site-data wipe (Firebase's
  anonymous-auth identity itself is device/browser-bound) — only
  `localStorage` being cleared while the Firebase Auth session survives.

## Components

### `functions/callableFunctions/submitKillPhoto.js` (new)

```js
// Input: { roomId, target, url }. No `assassin` field — the caller's own
// identity is derived from context.auth.uid, never trusted from the
// client, closing the identity-spoofing gap in the old direct-write path.
exports.submitKillPhoto = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', '...');
    }
    const { roomId, target, url } = data;
    if (!roomId || !target || !url) {
        throw new functions.https.HttpsError('invalid-argument', '...');
    }

    return db.runTransaction(async (transaction) => {
        const assassinDoc = await findPlayerByUid(transaction, roomId, context.auth.uid);
        if (!assassinDoc) {
            throw new functions.https.HttpsError('not-found', 'Not a player of this room');
        }
        const roomDoc = await transaction.get(db.collection('rooms').doc(roomId));
        if (!roomDoc.data().isGameActive) {
            throw new functions.https.HttpsError('failed-precondition', 'Game has ended');
        }
        enforceRateLimit(transaction, assassinDoc, 'photo', { max: 10, windowMs: 60000 });

        const targetDoc = await findPlayerByName(transaction, roomId, target);
        if (!targetDoc) {
            throw new functions.https.HttpsError('not-found', 'Target not found');
        }

        transaction.create(db.collection('rooms').doc(roomId).collection('photos').doc(), {
            assassin: assassinDoc.data().name,
            target,
            url,
            status: 'pending',
            originalPlayerData: null,
        });
    });
});
```

`findPlayerByUid`, `findPlayerByName`, and `enforceRateLimit` are small
shared helpers (exact home — a new `functions/callableFunctions/shared/`
module, or inline — is a plan-writing decision, not a design one).

### `functions/callableFunctions/submitChatMessage.js` (new)

Same shape: input `{ roomId, message }`, no `sender` field; looks up the
caller's own player doc by `uid`, checks `isGameActive`, enforces a
20-per-60s rate limit, then writes the `playerMessages` doc with
`sender` set to the looked-up name, `type: 'chat'`, `recipient: null`.

### Rate-limit window (shared shape, stored per player doc)

```js
// rooms/{roomId}/players/{playerId}.rateLimits
{
  photo: { windowStart: Timestamp, count: number },
  chat:  { windowStart: Timestamp, count: number },
}
```

Checked and updated inside the same transaction as the write itself: if
`now - windowStart >= 60000`, reset (`windowStart = now, count = 1`) and
allow; else if `count < cap`, increment and allow; else throw
`resource-exhausted`. No separate collection, no cron — just a field on a
doc the transaction already has open.

### `src/components/submitKillPhoto.js` / `src/components/submitChatMessage.js` (new)

Thin `httpsCallable` wrappers, matching `src/components/executeKill.js`'s
existing pattern exactly — their own small files, not inside `dbCalls.js`
(which stays reserved for direct Firestore CRUD, per CLAUDE.md).

### `src/components/player_messages_components/MessageComposer.js` (modified)

`handlePhotoSubmit` calls the new `submitKillPhoto({roomId, target, url})`
in place of today's `addPhotoForRoom(roomID, playerName, effectiveTarget,
url)` — the `uploadKillPhoto` line above it is untouched. The chat-send
handler switches to `submitChatMessage` the same way.

### `firestore.rules` (modified)

`playerMessages` currently has three clauses on one `match` block, not
two independent ones — `allow write: if isHostOfExistingRoom(roomId)` is
what authorizes every GM-originated write (`addPlayerMessageForRoom`,
called from `GameMasterView.js`/`ChatInput.js` for `/broadcast`,
`/whisper`, `/leaderboard`, and mission announcements — `type` values
`'broadcast'`/`'whisper'`/`'leaderboard'`/`'mission'`, never `'chat'`).
That clause is untouched by this change — it's a fully separate path from
player chat, already scoped to a different `type`. Only the narrower
`allow create` clause (which today authorizes `addChatMessageForRoom`,
the player-chat-only path, `type == 'chat'`) is removed:

```
match /playerMessages/{messageId} {
  allow read: if isHostOrPlayerOfRoom(roomId);
  allow write: if isHostOfExistingRoom(roomId); // GM broadcasts/whispers/etc — unchanged
  // allow create (player chat) removed entirely — submitChatMessage
  // (Admin SDK) is now the only path for type: 'chat'.
}

match /photos/{photoId} {
  allow read: if isHostOrPlayerOfRoom(roomId);
  allow write: if isHostOfExistingRoom(roomId); // GM approve/deny/undo — unchanged
  // allow create (player kill-photo submission) removed entirely —
  // submitKillPhoto (Admin SDK) is now the only path for a new photo doc.
}

// New, top-level (collection-group) — powers session recovery.
// Deliberately independent of isPlayerOfRoom/isHostOfExistingRoom: the
// query itself is already scoped to the caller's own uid, so no room
// lookup is needed or possible (the wildcard path doesn't bind {roomId}).
match /{path=**}/players/{playerId} {
  allow list: if request.auth != null && resource.data.uid == request.auth.uid;
}
```

`submitChatMessage` must still write `type: 'chat'` and `recipient:
null`, matching what `addChatMessageForRoom` wrote today — `GMChatPanel.js`
and `MessageFeed.js` both filter client-side on `type === 'chat'`, and
nothing about their shape expectations changes.

### `src/pages/Homepage.js` (modified)

The existing `onAuthStateChanged` handler gains a fallback: if
`readPlayerSession()` returns nothing but the user is signed in, run the
`collectionGroup('players')` query; on a match, redirect into that room
the same way the `localStorage` path already does; on no match (or a
query error), fall through to today's normal "not currently in a room"
state.

### `src/components/firebase_calls/dbCalls.js` (modified)

`addPhotoForRoom` and `addChatMessageForRoom` are deleted — no longer
called from anywhere once `MessageComposer.js` switches to the new
callables.

## Data flow

**Kill-photo:** player takes/picks a photo → `uploadKillPhoto` uploads
the blob to Storage (unchanged) → client calls `submitKillPhoto({roomId,
target, url})` → function looks up the caller's real name by `uid`,
checks the room is active, checks/updates the rate-limit window,
validates `target` exists, writes the `photos` doc → GM's
`PhotosDisplay.js` picks it up via its existing live subscription,
unchanged.

**Chat:** player types a message → client calls
`submitChatMessage({roomId, message})` → function looks up the caller's
real name, checks active/rate-limit, writes the `playerMessages` doc →
existing chat feed subscriptions pick it up unchanged.

**Session recovery:** app loads → `onAuthStateChanged` fires → if
`localStorage` has a usable room/name pair, today's existing redirect
happens exactly as now (fast path, no query needed) → if not, and the
user is signed in, run the `collectionGroup` query → on a match, redirect
into that room; on no match, fall through to the normal join screen.

## Error handling

Both new functions throw `functions.https.HttpsError`, matching
`killPlayer.js`'s convention. Both client callers wrap the call in the
same `try`/`catch` + `CreateAlert` toast pattern `executeKill.js`'s
callers already use:

- `resource-exhausted` (rate limit hit) → "Slow down — too many
  submissions, try again in a moment."
- `failed-precondition` (game ended) → "This game has ended."
- `not-found` (caller isn't a recognized player of this room, or
  `target` doesn't exist) → generic error toast, matching `killPlayer.js`'s
  existing handling for its own `not-found` cases.

The `collectionGroup` recovery query failing or finding no match falls
through to the normal join screen — a best-effort convenience path, never
an error shown to a first-time visitor.

## Testing

- New Cloud Functions, against the emulator, mirroring `killPlayer.js`'s
  existing test approach (exact conventions confirmed at plan-writing
  time from its test file): identity is derived from `uid`, never
  trusted from a client-sent field; rejects a caller who isn't a player
  of the room; rejects once `isGameActive` is false; rate limit allows up
  to the cap, rejects the next one within the same window, and allows
  again once the window elapses; `submitKillPhoto` rejects an unknown
  `target`.
- `firestore.rules` additions, using this repo's existing rules-test
  setup: a direct client `create` on `photos`/`playerMessages` is denied
  even with a well-formed payload; the new `players` collection-group
  `list` rule allows a query scoped to the caller's own `uid` and denies
  one that isn't.
- Client-side: `MessageComposer.js`'s submit handlers tested the way
  `ChatInput.test.jsx`/`PhotosDisplay.test.jsx` already mock
  `executeKill` — mock the new callable wrapper modules, assert correct
  arguments and that errors surface via the toast. `Homepage.js`'s new
  recovery fallback gets a test mocking the `collectionGroup` query for
  both the match and no-match cases.

## Out of scope

- Cross-device or cross-browser session recovery, and recovery through
  incognito/private browsing — both are fundamentally blocked by
  Firebase anonymous-auth identity being device/browser-bound; no
  version of this fix can address them. A real fix would need a portable
  credential (recovery code, magic link, real login) — a materially
  bigger feature, not part of this project.
- Storage-upload-level abuse (spamming `uploadKillPhoto` directly without
  ever calling `submitKillPhoto`) — the rate limit here only covers the
  Firestore doc write, not the Storage upload step itself. Storage writes
  already require sign-in (`storage.rules`); genuine abuse-cost concerns
  there are a separate, lower-priority item.
- `#2` (Begin-Game roster-size lock), `#7` (restart/second round), `#12`
  (multi-GM support) — separate Batch C findings, each its own future
  project.
- Any change to how the GM console authenticates or to `killPlayer.js`
  itself.
