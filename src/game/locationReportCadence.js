/**
 * Decides when to send a freshly acquired location fix, and when to
 * force a backstop re-check if the browser's own watch has gone quiet
 * (some platforms stop firing watchPosition callbacks when the position
 * hasn't changed). Pure — no Date.now() call inside; the caller
 * supplies nowMs. Two plain elapsed-time checks, not a capped rate
 * limiter like rateLimit.js's nextRateLimitWindow — there is no window
 * to reset, only "has enough time passed since the last one."
 *
 * ES `export`, not CommonJS: useBoundaryLocation.js (a webpack-bundled
 * React hook) imports these by name, and a named ES import of a
 * `module.exports` object isn't statically analyzable by CRA's
 * production build — see src/game/boundaryDraft.js's header comment for
 * the exact failure this avoids. Jest's unit project still runs this
 * file's own test via require(), which Babel transpiles fine either way.
 */
export const MIN_SEND_INTERVAL_MS = 5000;
export const MAX_FRESH_INTERVAL_MS = 15000;

/**
 * @param {number|null} lastSentMs when the last report was actually sent, or null if none yet
 * @param {number} nowMs
 */
export const shouldSendFix = (lastSentMs, nowMs) => {
    if (lastSentMs === null || lastSentMs === undefined) return true;
    return nowMs - lastSentMs >= MIN_SEND_INTERVAL_MS;
};

/**
 * True once it has been long enough since the last sent report that a
 * forced getCurrentPosition call is due.
 *
 * @param {number|null} lastSentMs
 * @param {number} nowMs
 */
export const isPollDue = (lastSentMs, nowMs) => {
    if (lastSentMs === null || lastSentMs === undefined) return true;
    return nowMs - lastSentMs >= MAX_FRESH_INTERVAL_MS;
};
