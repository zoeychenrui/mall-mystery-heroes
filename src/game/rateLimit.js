/**
 * Decides the next state of a rolling rate-limit window, given the
 * current one (or none) and the current time. Pure — no Firestore, no
 * Date.now() call inside; the caller supplies `nowMs` so this stays fully
 * deterministic and testable. Returns the window to persist when the
 * submission is allowed, or `null` when the cap has been hit and the
 * caller should reject.
 *
 * A fixed window, not a true sliding one: once `windowMs` has elapsed
 * since `windowStartMs`, the count resets entirely rather than decaying
 * gradually. Used by both submitKillPhoto.js and submitChatMessage.js to
 * enforce a burst allowance — not a fixed per-submission cooldown, which
 * would block legitimate rapid-fire kill-photo submission during a fast
 * moment in the game
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * playerNames.js's convention in this directory — also required by a
 * Cloud Function via functions/vendor/game/ (functions/scripts/
 * sync-shared-game-logic.js).
 */
const nextRateLimitWindow = (currentWindow, nowMs, { max, windowMs }) => {
    if (!currentWindow || nowMs - currentWindow.windowStartMs >= windowMs) {
        return { windowStartMs: nowMs, count: 1 };
    }
    if (currentWindow.count < max) {
        return { windowStartMs: currentWindow.windowStartMs, count: currentWindow.count + 1 };
    }
    return null;
};

module.exports = { nextRateLimitWindow };
