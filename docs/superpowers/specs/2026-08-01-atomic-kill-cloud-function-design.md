# Atomic kills via a Cloud Function (improvements item 4)

## Problem

A single `/kill` performs roughly 9–15 sequential, independent Firestore
writes from the browser: score transfer, unmapping the victim from every
neighbor, the victim's own reset, then per-player target/assassin
reassignment. None of it is grouped — a dropped connection or closed tab
partway through leaves the game in a state nothing detects or repairs
(points transferred but the victim still alive; a victim dead but still
referenced by former neighbors; a remap half-applied).

Interim mitigation (grouping the writes into a client-side `writeBatch`) was
explicitly rejected in favor of the proper fix: move the kill into a Cloud
Function running inside a Firestore transaction, so it succeeds or fails as
one unit no matter what the client does mid-request.

## Decisions made (confirmed with the user before this was written)

1. **Transaction scope: everything.** Score transfer, unmapping, the
   victim's reset, and the remap (reassigning targets/assassins to whoever
   the victim's death left short) all happen inside one `runTransaction` —
   not just the "kill core" with remap left client-side. Remapping right
   after a kill is exactly as failure-prone as the kill itself; fixing one
   and not the other would just relocate the bug.
2. **`firestore.rules` stays exactly as it is.** This project does not
   attempt to close item 2's remaining gap (the host can still write any
   player field directly, including score, for everything that isn't a
   kill — adding a player, `ResetTargetsButton`'s manual reset, open-season
   toggling, task-completion scoring). Auditing and re-homing every one of
   those is separate, larger scope than "make kills atomic." The
   `firestore.rules` header comment gets a note that item 4 specifically is
   resolved, without implying the broader gap is closed.
3. **Testing goes through the real interface.** Tests call the deployed
   shape of the function (`httpsCallable`) against the real Functions
   emulator running alongside Firestore and Auth, then assert on what
   actually landed in Firestore — the same black-box-through-the-emulator
   approach this codebase has used for every Firestore-touching test all
   session, not a shortcut that calls the function's internals directly.

## The Cloud Function

`functions/callableFunctions/killPlayer.js`, exported from
`functions/index.js` as `killPlayer`, following the existing (currently
unused) `targetFunction` stub's `functions.https.onCall` pattern — the only
precedent for a callable function in this repo.

**Request:** `{ target, assassin, roomId }` — the same three pieces of
information `executeKill(target, assassin, roomID)` takes today.

**Inside one `runTransaction`:**

Firestore transactions require every read to happen before any write, so
the function has two phases:

_Read phase:_

1. Read the room document. Confirm `request.auth` exists and
   `roomDoc.data().hostId === request.auth.uid` — this check currently
   lives in `firestore.rules`, but the Admin SDK a Cloud Function uses
   bypasses rules entirely, so the function must re-implement this specific
   check itself, in code. Throw `HttpsError('unauthenticated', ...)` if
   there's no caller identity at all, `HttpsError('not-found', ...)` if the
   room doesn't exist, `HttpsError('permission-denied', ...)` if the caller
   isn't that room's host.
2. Read the assassin's player document, by a query on
   `trimmedNameLowerCase` (matching every other lookup in this codebase —
   not a direct `.doc(id)` get, since player documents created before this
   session's item 34 fix may not have `trimmedNameLowerCase` as their
   document ID; the query is robust to that, a direct ID lookup would not
   be).
3. Validate: target is on the assassin's target list, or the assassin has
   open season. Same rule `executeKill.js` enforces today. Throw
   `HttpsError('failed-precondition', '${target} is not a valid target for
${assassin}')` if not — same message text the client already expects,
   so no client-side error-handling changes are needed.
4. Read the target's player document.
5. Read every player named in the target's own `assassins` and `targets`
   arrays (their former hunters and prey) — these are the neighbors that
   need unmapping. If one of these names doesn't resolve to a player
   document (a stale reference — shouldn't happen, but the pre-fix version
   of this exact lookup silently failed for months, per item 36, so it's
   not purely hypothetical), that one neighbor is skipped rather than
   aborting the whole kill: an unrelated data anomaly shouldn't block a GM
   from killing someone. Logged, not thrown.
6. Read the full alive roster for the room (for the remap step).

_Decide (pure, in memory, no I/O):_ 7. **Filter the target out of the roster before planning the remap.**
Firestore transactions require every read to finish before any write
starts, so step 6's roster read necessarily happens before step 9 sets
the target's `isAlive: false` — the query would still include the
about-to-die target if this filter is skipped. (The client's current
version doesn't need this: it fetches the roster _after_ the separate
kill write already landed, so the target is naturally already gone by
the time it queries. A single transaction can't rely on that ordering —
this is exactly the kind of detail that's easy to get wrong once, which
is why it's called out explicitly here rather than left implicit.) Call
`planRemap` (existing, already unit-tested pure function — see "Code
sharing" below) with the filtered roster and the target's former
assassins/targets as the players who now need reassignment.

_Write phase:_ 8. Update the assassin's score (their current points plus the target's). 9. Update the target's document: `score: 0`, `isAlive: false`,
`openSeason: false`, `targets: []`, `assassins: []`. 10. For each of the target's former assassins, remove the target's name
from that player's `targets` array. For each of the target's former
targets, remove the target's name from that player's `assassins`
array. (This is the exact step that was silently broken — item 36,
found and fixed earlier this session — before this project started;
the Cloud Function's version is written correctly from the start,
verified by its own tests rather than inheriting that history.) 11. Apply every write `planRemap` returned.

**Response:** everything the client needs to update the screen without a
second round trip —

```js
{
  targetWasOpenSzn: boolean,       // victim's own flag, for the "open season
                                    // has ended" log message
  preKillSnapshot: {               // victim's state just before the kill,
    score, targets, assassins      // for PhotosDisplay's undo feature (item 6)
  },
  addedTargets: Record<string, string[]>,   // planRemap's `added.targets`
  addedAssassins: Record<string, string[]>, // planRemap's `added.assassins`
  remapLogs: string[],             // planRemap's `logs` — "New target for
                                    // X: Y" style messages
}
```

Log entries themselves are **not** written by the function. Writing to the
`logs` subcollection stays client-driven, exactly as it is today (item 10
already treats a failed log write as best-effort — a "Log not saved"
toast, not a blocker) — the function's job is narrowly the atomic game
state, not the supplementary log trail.

## Code sharing

`functions/` and the main app are separate npm packages today (separate
`package.json`, separate installs — `README.md`/`CONTRIBUTING.md` currently
document running `npm install` twice). Two things make sharing
`src/game/remapPlan.js` (and its own dependencies, `targetGraph.js` and
`playerNames.js`) with the Cloud Function possible:

1. **Module format.** The client uses ES module syntax (`export`/`import`,
   transpiled by CRA's build). `functions/` uses plain CommonJS
   (`require`/`module.exports`, no build step — Cloud Functions' Node 18
   runtime runs the source directly). These three pure files switch from
   `export const x = ...` to `module.exports = { x }`. This requires no
   changes anywhere that currently imports them on the client side —
   webpack's CommonJS interop means `import { planRemap } from
'./remapPlan'` keeps working unchanged against a `module.exports`
   file, and so does every Jest test that already imports them the same
   way.
2. **The file reference itself** is a plain relative path —
   `functions/callableFunctions/killPlayer.js` does
   `const { planRemap } = require('../../src/game/remapPlan');`. Node
   resolves relative `require()` paths across any directory boundary on
   disk; this needs no package-level dependency declaration.

**npm workspaces** (`"workspaces": ["functions"]` added to the root
`package.json`) is not what makes the `require()` above work — that's
already true without it. What workspaces actually buys: a single
`npm install` at the repo root also installs `functions/`'s own
dependencies (`firebase-admin`, `firebase-functions`, etc.), replacing the
two-separate-installs step `README.md`/`CONTRIBUTING.md` currently
document. Worth doing for that ergonomic win, but the design doesn't depend
on it for the actual code-sharing to function.

## Client-side changes

`src/components/executeKill.js` shrinks to a thin wrapper:

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const killPlayerCallable = httpsCallable(functions, 'killPlayer');

export const executeKill = async (target, assassin, roomID) => {
    const { data } = await killPlayerCallable({ target, assassin, roomId: roomID });
    return data;
};
```

Same call signature as today (`executeKill(target, assassin, roomID)`), so
callers change only in what they do with the _response_, not how they call
it. `httpsCallable`'s rejected promise already carries `.message` from any
`HttpsError`, so `ChatInput.js`'s existing outer `try/catch` →
`createAlert('error', 'Error', \`${commandLine} failed: ${error.message}\`,
1500)` needs no changes at all to surface a rejected kill.

**`ChatInput.js`'s `/kill` case** and **`PhotosDisplay.js`'s `handlePass`**
both currently do a second round trip after `executeKill` resolves — fetch
the alive roster, call `RemapPlayers`' `handleTargetRegeneration`, then
call `handleAddNewAssassins`/`handleAddNewTargets`. That whole second step
goes away for the kill path: `addedTargets`/`addedAssassins` come straight
back from `executeKill` now, and `remapLogs` gets looped through the
existing `handleRemapping(log)` calls the same way `plan.logs` does today.
`PhotosDisplay.js` drops its `RemapPlayers`/`fetchAlivePlayerNamesForRoom`
imports entirely — the kill path was its only use of them.
`ChatInput.js` keeps both, since `/revive` and `/mission done`'s revival
branch still remap client-side — reviving a player isn't in this project's
scope.

**Deleted, not stranded**, once nothing calls them:

- `src/utils/UnmapPlayers.js` and its test
  (`UnmapPlayers.integration.test.js`, written earlier this session as
  item 36's fix) — the Cloud Function's unmapping step replaces it, written
  correctly from the start rather than inheriting the bug history.
- `dbCalls.killPlayerForRoom`.
- `dbCalls.checkOpenSzn`, `fetchPointsForPlayerInRoom`,
  `fetchTargetsForPlayer` — each was only ever called from the old
  client-side `executeKill.js`.

`src/components/executeKill.integration.test.js` gets rewritten, not
deleted — same file, same public interface under test
(`executeKill(target, assassin, roomID)`), but now round-tripping through
the real Cloud Function via the functions emulator instead of asserting
against direct `dbCalls` writes.

## Testing

`npm run test:emulator`'s `--only` flag gains `functions`:

```
firebase emulators:exec --project demo-mall-mystery-heroes \
  --only firestore,auth,functions \
  "jest --selectProjects integration --runInBand"
```

`functions/package.json` currently has no lint or test tooling at all —
this project adds a `.eslintrc.json` (Node environment, not
`react-app` — the existing root config is browser/React-specific and
doesn't apply) and a `lint` script. No separate unit-test runner is added
inside `functions/` itself: the only pure logic the function uses
(`planRemap`) already has its own 16 unit tests where it lives, and the
function's own behavior is covered by the black-box tests in
`executeKill.integration.test.js` per the testing decision above. The root
`npm run lint` stays scoped to `src` as it is today;
`(cd functions && npm run lint)` is a separate, documented step for
`functions/` changes.

## Docs

- `docs/improvements.md` — item 4 marked ✅ Resolved with the full writeup,
  same pattern as every other item this session.
- `docs/testing.md` — a new section for Cloud Function testing (calling
  through `httpsCallable` against the real emulator) — this repo's testing
  strategy doc doesn't have a category for this yet.
- `docs/architecture.md`'s "Cloud Functions" section currently says "all
  game logic runs on the client... Cloud Functions contains one echo
  stub" — no longer true for kills specifically once this ships; needs
  updating, not just leaving as a stale blanket claim.
- `README.md`/`CONTRIBUTING.md` — the two-separate-`npm install` setup step
  becomes one, at the repo root, once workspaces are in place.
- `firestore.rules`'s header comment gets a note that item 4 is resolved,
  without implying the broader "client can still write player fields
  directly" gap (everything that isn't a kill) is closed — it isn't, by
  explicit decision above.

## Out of scope

- Tightening `firestore.rules` to deny direct client writes to `players`
  more broadly. Explicit decision above — separate project.
- Moving anything other than kills server-side (task-completion scoring,
  `ResetTargetsButton`'s manual reset, open-season toggling,
  `addPlayerForRoom`). Each of those still writes to `players` directly
  from the client, unchanged.
- `/revive` and `/mission done`'s revival branch — still remap client-side
  via `RemapPlayers`/`planRemap`, unchanged. Reviving isn't atomicity-fragile
  the way killing is (it's a single player's state changing, not a
  multi-player graph edit cascading from one event), and wasn't part of
  what item 4 described.
