# Player Selects Target/Mission Design

**Date:** 2026-09-02
**Status:** Approved

## Problem

Today, a player submitting a kill or mission photo names no target or
mission at all — `submitKillPhoto.js` writes `target: null, mission: null`
unconditionally. The moderator resolves the ambiguity later, in
`PhotosDisplay.js`, picking from a combined dropdown of the submitter's
live kill targets and open missions before approving.

This puts the cognitive load on the moderator, who may be reviewing many
photos in a row from players they don't have full context on. The player
submitting the photo already knows exactly what they were going for. This
feature moves the pick to submission time — the player chooses their
target or mission right after taking the photo — so the moderator's job
becomes purely "see who submitted, see what they claimed, approve or
deny."

## Decisions

- **Pure approve/deny, no moderator override.** Once a player has
  submitted a claim, the moderator cannot change it. If a player picked
  wrong, the moderator denies the photo and the player resubmits. This is
  what actually simplifies the moderator's screen — no dropdown, no
  editable state, just a claim and two buttons.
- **The real safety check doesn't move.** The moderator's Approve button
  still calls the exact same server-side functions as today
  (`executeKill`/`killPlayer.js` for a kill, `completeMission` for a
  mission), which independently re-validate the claim against live game
  state the instant Approve is clicked. If a player's pick has gone stale
  by review time (someone else killed that target first, the mission got
  capped), Approve still fails with a clear error — exactly the same
  failure mode that exists today when a moderator's own dropdown pick
  goes stale.
- **`submitKillPhoto` validates shape only, not game rules.** The Cloud
  Function requires exactly one of `target` (a non-blank string) or
  `mission` (an integer) to be present, and rejects a submission with
  neither or both. It does **not** re-derive "is this actually a valid
  kill target / open mission for this player" — that would duplicate
  logic that already exists at approval time for no real benefit, given
  this game's small, in-person, GM-supervised setting. A player free-typing
  a bogus claim past the picker's UI would simply fail at approval, not
  submission — same outcome, one less place the rule has to be kept in
  sync.
- **The player's picker reuses the exact logic the moderator's dropdown
  used to use** (`killTargetsForAssassin` for kill targets — a player's
  own assigned targets plus anyone currently in open season —
  `openMissionsForPlayer` for missions still completable by them),
  computed for the _submitting_ player instead of a resolved photo's
  assassin. Single option → shown, already picked. Multiple → a dropdown,
  grouped the same way ("Kill Target" / "Mission"). None → the submit
  button stays disabled with a plain "nothing available right now"
  message, mirroring the moderator screen's existing empty-state text.
- **A real bug gets fixed along the way.** `openMissionsForPlayer` today
  doesn't filter out Revival Missions for a living player — attempting to
  complete one always fails validation (`planMissionCompletion` requires
  the player to be dead), but nothing ever stopped it from being _offered_.
  This was a latent gap the moderator never really hit (a moderator
  reviewing a photo already knows whether the submitter is alive). Now
  that a living player would see this option directly in their own
  picker, it gets a real, guaranteed-to-fail choice in front of them — so
  `openMissionsForPlayer` gains an `isPlayerDead` parameter and excludes
  Revival Missions when the player is alive.
- **The player's own browser now reads the live player roster**, not just
  its own player document — needed to compute open-season targets the
  same way the moderator's screen already does. This is a real, modest
  increase in what a player's browser subscribes to during a game (every
  player's name/score/targets/openSeason/isAlive, live), matching what the
  moderator's screen already reads today. For a small, in-person,
  GM-supervised game this isn't a meaningful new exposure — everyone in
  the game already knows the full roster by name.
- **The public kill-photo chat message stays claim-free.** `submitKillPhoto`
  already posts a `killPhoto` playerMessages doc into every player's chat
  feed the moment a photo is submitted, with `target: null`. That stays
  `null` — broadcasting a player's claimed target into the public feed
  the instant they submit would leak who's hunting whom before a kill is
  even confirmed, which the game doesn't do today and this feature
  doesn't need to start doing. Only the moderator's private review screen
  sees the claim.
- **No special handling for photos submitted under the old code.** The
  game is still in testing, so there's no real risk of an in-flight photo
  with no claim attached surviving this deploy. The moderator's Approve
  button simply stays disabled when a photo has neither `target` nor
  `mission` set — correct behavior, no dedicated messaging needed.
- **The moderator's display wording:** `"{assassin}'s kill attempt on
{target}"` for a kill claim, `"{assassin}'s mission attempt: {mission
title}"` for a mission claim — parallel phrasing, "who, doing what," at
  a glance.

## Components

**Player-facing submission side:**

- `src/pages/PlayerGame.js` — gains a second live subscription, to the
  full player roster (mirrors `GameMasterView.js`'s own
  `fetchPlayersQueryByDescendPointsThenIsAliveForRoom` subscription and
  field mapping: `name`, `score`, `targets`, `openSeason`, `isAlive`) and
  reuses its existing missions access pattern (`fetchTasksQueryForRoom`,
  already used by `PhotosDisplay.js`/`TaskList.js`) via a new subscription
  local to this page. Both get passed down as `players`/`missions` props
  to `MessageComposer`.
- `src/game/photoClaimOptions.js` (new) — `buildPhotoClaimOptions(players,
missions, playerName)`, a pure function: finds the player's own roster
  row to determine `isPlayerDead`, then combines
  `killTargetsForAssassin(players, playerName)` and
  `openMissionsForPlayer(missions, normalizedName, isPlayerDead)` into one
  array of `{ value: 'target:<name>' | 'mission:<index>', label, group:
'Kill Target' | 'Mission' }` entries — the exact shape
  `PhotosDisplay.js`'s dropdown used to build inline, now reusable and
  independently unit-testable.
- `src/game/missionCompletion.js` — `openMissionsForPlayer` gains a third
  parameter, `isPlayerDead`, and excludes any mission with `taskType ===
'Revival Mission'` when it's `false`.
- `src/components/player_messages_components/KillPhotoModal.js` — gains
  `players`, `missions`, `playerName` props. Computes
  `buildPhotoClaimOptions` internally, tracks the in-progress pick in
  local state (reset whenever the modal transitions from closed to open,
  so a stale pick never carries over into the next photo), auto-resolves
  when there's exactly one option, and disables Submit until a claim is
  resolved — mirroring `PhotosDisplay.js`'s current `effectiveSelection`
  logic exactly, just relocated. `onSubmit` now passes the resolved claim
  value up (`onSubmit(effectiveSelection)`) instead of taking no
  argument.
- `src/components/player_messages_components/MessageComposer.js` —
  receives and forwards `players`/`missions` to `KillPhotoModal`.
  `handlePhotoSubmit` now takes the claim value, splits it into `{target,
mission}` (mirroring `PhotosDisplay.js`'s existing
  `effectiveSelection.startsWith('target:'/'mission:')` parsing), and
  passes both through to `submitKillPhoto`.
- `src/components/submitKillPhoto.js` — thin wrapper, gains `target`/
  `mission` in its passthrough payload.
- `functions/callableFunctions/submitKillPhoto.js` — accepts `target`
  (string) and `mission` (number) in `data`. Validates exactly one is
  present in the shape described above, throwing `invalid-argument`
  otherwise. Writes the validated value onto the photo doc instead of the
  hardcoded `null`s. The `killPhoto` playerMessages doc keeps writing
  `target: null` (see Decisions).

**Moderator-facing side:**

- `src/components/photos_display_component/PhotosDisplay.js` — removes
  `selectedOption` state, the `combinedOptions`/`effectiveSelection`
  derivations, the reset-on-photo-change `useEffect` for them, the
  `<Select>` dropdown JSX, and the `killTargetsForAssassin`/
  `openMissionsForPlayer` imports (no longer needed here at all — the
  claim is already resolved by the time a moderator sees it). Keeps its
  existing `missions` subscription, now used only to look up a claimed
  mission's title by `taskIndex` for display. `handlePass` branches on
  `approvingPhoto.mission != null` vs `approvingPhoto.target` directly,
  in place of `effectiveSelection`, and returns early (a no-op) if
  neither is set. The Approve button's disabled state uses the same
  check. Display text follows the wording in Decisions above; a photo
  with neither claim shows plain "No target selected" text with Approve
  disabled, no dedicated banner or fallback flow.
- `src/components/firebase_calls/dbCalls.js` —
  `approvePhotoForRoom`/`approvePhotoAsMissionForRoom` are unchanged in
  signature. `PhotosDisplay.js` now sources the `target`/`missionIndex`
  arguments it already passes them from `approvingPhoto.target`/
  `approvingPhoto.mission` instead of `effectiveSelection` — the
  moderator's approval still explicitly (re-)writes the resolved value
  onto the photo doc, same as today, just sourced differently.

## Data flow

Player takes a photo → taps to open the submit modal → the modal shows
their live combined options (own targets + open-season players + open
missions, minus the Revival Mission fix) → they pick one (or it's
auto-picked if there's only one) → Submit calls `submitKillPhoto` with the
photo URL and the resolved `target`/`mission` → the Cloud Function
validates the shape and writes the photo doc with the claim already
attached, `status: 'pending'` → moderator's `PhotosDisplay.js` shows the
claim as plain text → Approve calls `executeKill`/`completeMission`
exactly as today, using the already-known `target`/`mission` → Deny needs
no claim at all, unchanged.

## Error handling

- **Submission with a malformed claim** (neither or both of
  `target`/`mission` present, or a blank target/non-integer mission) —
  `submitKillPhoto` throws `invalid-argument`, surfaced through
  `MessageComposer`'s existing `createAlert` catch block, same as any
  other submission failure today.
- **A claim goes stale between submission and approval** — Approve's
  underlying `executeKill`/`completeMission` call throws exactly as it
  does today for a moderator's own stale pick; `PhotosDisplay.js`'s
  existing try/catch rolls back the optimistic queue-advance and shows
  the error via `createAlert`.
- **Zero options at submission time** (a dead player with no open Revival
  Mission and nobody in open season) — Submit stays disabled with a
  plain message in the modal, mirroring `PhotosDisplay.js`'s existing
  empty-state text. The camera itself isn't blocked — a mission could
  open up between snapping the photo and reviewing the picker, matching
  today's behavior where the "Send photo" button isn't gated on target
  count either.
- **A photo with no claim reaches the moderator's screen** (only
  realistically possible from before this ships) — Approve stays
  disabled, Deny still works. No dedicated messaging (see Decisions).

## Testing

- `src/game/photoClaimOptions.test.js` (new, unit): `buildPhotoClaimOptions`
  — combines kill targets and open missions into the right shape; empty
  array when the player has neither; excludes a Revival Mission for a
  living player but includes it for a dead one; a player not found in the
  roster still gets whatever `killTargetsForAssassin` already does for an
  unknown assassin (an empty kill-target list).
- `src/game/missionCompletion.test.js` (extended): `openMissionsForPlayer`
  — new cases for the `isPlayerDead` parameter (excludes a Revival Mission
  when `false`, includes it when `true`; a `Task`-type mission is
  unaffected either way).
- `src/components/player_messages_components/KillPhotoModal.test.jsx`
  (extended): renders the picker from `players`/`missions`/`playerName`;
  auto-resolves a single option; requires an explicit pick among multiple;
  Submit disabled with zero options and enabled once resolved; `onSubmit`
  is called with the resolved claim value.
- `src/components/player_messages_components/MessageComposer.test.jsx`
  (extended): `handlePhotoSubmit` parses a `target:`/`mission:` claim
  correctly and forwards both fields to `submitKillPhoto`.
- `functions/callableFunctions/submitKillPhoto.integration.test.js`
  (extended, emulator): a valid `target` claim and a valid `mission`
  claim both persist onto the photo doc; a submission with neither or
  both is rejected and writes nothing; the `killPhoto` playerMessages doc
  still writes `target: null` regardless of the claim.
- `src/components/photos_display_component/PhotosDisplay.test.jsx`
  (extended, several existing dropdown-focused tests rewritten rather
  than deleted where they now test display-only behavior): shows the new
  kill/mission wording from `currentPhoto.target`/`currentPhoto.mission`
  directly, with no dropdown rendered at all; Approve disabled when
  neither is set; Approve calls through with the photo's own claimed
  values.

## Documentation

- `docs/data-model.md`'s `photos` table: `target`/`mission` field rows
  updated — written by `submitKillPhoto` at submission time from the
  player's own claim, not by the moderator's approval anymore (the
  moderator's approval still re-writes the same already-set value, per
  the Components section above).
- `docs/game-flows.md`: the existing kill-approval flow diagram updated
  to show the player's pick happening at submission, not at approval; the
  2026-08-27 mission-completion-via-photo flow's "GM picks one" step
  similarly updated.

## Future improvements

- Surfacing the player's claim in the public `killPhoto` chat message
  once the photo is approved (not at submission) — the moderator's
  approval already produces a public `killResult` announcement with the
  outcome, so this may already be redundant. Not investigated as part of
  this feature.

## Out of scope

- Any moderator-side override/edit capability (explicitly decided
  against — see Decisions).
- Any change to the "View Missions" player-facing popup (bounded, tracked
  and approved separately, implemented directly without a spec).
- Rate limiting or additional anti-abuse measures on the claim itself —
  `submitKillPhoto`'s existing per-player rate limit is unchanged and
  unaffected by this feature.
- Firestore rules changes — players already have read access to the
  `players` and `tasks` collections needed to compute their own picker
  options; nothing new needs to be exposed.
