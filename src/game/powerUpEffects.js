/**
 * Power-up ability rules (POWER_UPS_SPEC.md): the mystery box, Horcrux,
 * camera blocking, and ping snapshots. Pure — no Firebase, no clock, no
 * Math.random (callers pass `nowMs` and `rng`). CommonJS so Cloud
 * Functions can load it through functions/vendor/game/, same as
 * powerUps.js.
 *
 * No object spread (`{ ...x }`) in this file — see gameBoundary.js's
 * comment above its module.exports: it breaks CommonJS files at runtime
 * in the client bundle.
 */
const { POWER_UPS } = require('./powerUps');
const { isPositionFresh } = require('./gameBoundary');

const AD_REWARD_POINTS = 3;
const CAMERA_BLOCK_MS = 30 * 1000;
// How long a Horcrux keeps protecting after it saves its holder from an
// assassination, so a second photo taken in the same moment fails too.
const HORCRUX_GRACE_MS = 5 * 1000;

// In the spec's table order. `weight` is the percent chance; they total 100.
const MYSTERY_BOX_OUTCOMES = [
    { kind: 'trash', weight: 36 },
    { kind: 'points', points: 1, weight: 5 },
    { kind: 'points', points: 2, weight: 5 },
    { kind: 'points', points: 3, weight: 5 },
    { kind: 'item', itemId: 'global-ping-random', weight: 5 },
    { kind: 'points', points: 4, weight: 5 },
    { kind: 'item', itemId: 'ping-assassins', weight: 5 },
    { kind: 'points', points: 5, weight: 5 },
    { kind: 'item', itemId: 'ping-targets', weight: 5 },
    { kind: 'points', points: 6, weight: 3 },
    { kind: 'item', itemId: 'global-ping-picked', weight: 3 },
    { kind: 'points', points: 7, weight: 3 },
    { kind: 'item', itemId: 'block-camera', weight: 3 },
    { kind: 'points', points: 8, weight: 3 },
    { kind: 'points', points: 9, weight: 3 },
    { kind: 'points', points: 10, weight: 3 },
    { kind: 'points', points: 15, weight: 1 },
    { kind: 'points', points: 20, weight: 1 },
    { kind: 'item', itemId: 'horcrux', weight: 1 },
];

const itemById = (itemId) => POWER_UPS.find((item) => item.id === itemId);

// Walks the table until the running total passes the roll. `rng` returns
// [0, 1) like Math.random.
const rollMysteryBox = (rng) => {
    const roll = rng() * 100;
    let runningTotal = 0;
    for (const outcome of MYSTERY_BOX_OUTCOMES) {
        runningTotal += outcome.weight;
        if (roll < runningTotal) return outcome;
    }
    // Only reachable through floating-point rounding right at 100.
    return MYSTERY_BOX_OUTCOMES[MYSTERY_BOX_OUTCOMES.length - 1];
};

// What a rolled outcome actually does for this player right now. An item
// that can't be used (on cooldown, or a second Horcrux) is refunded at its
// shop price instead.
const resolveMysteryOutcome = ({ outcome, cooldownEndsAtMs, nowMs, horcruxActive }) => {
    if (outcome.kind === 'trash') return { kind: 'trash' };
    if (outcome.kind === 'points') return { kind: 'points', points: outcome.points };

    const onCooldown = cooldownEndsAtMs != null && nowMs < cooldownEndsAtMs;
    const duplicateHorcrux = outcome.itemId === 'horcrux' && horcruxActive;
    if (onCooldown || duplicateHorcrux) {
        return { kind: 'refund', itemId: outcome.itemId, points: itemById(outcome.itemId).cost };
    }
    return { kind: 'item', itemId: outcome.itemId };
};

// The headline on the mystery box's full-screen reveal.
const mysteryOutcomeLabel = (resolution) => {
    if (resolution.kind === 'trash') return 'Trash — better luck next time';
    if (resolution.kind === 'points') {
        return `+${resolution.points} ${resolution.points === 1 ? 'point' : 'points'}`;
    }
    const name = itemById(resolution.itemId).name;
    if (resolution.kind === 'refund') {
        return `${name} — already active, refunded +${resolution.points} points`;
    }
    return name;
};

// `horcruxEndsAtMs` is null while the Horcrux is held but hasn't saved
// anyone yet; once it does, it's set to the end of the grace period.
const isHorcruxActive = ({ horcrux, horcruxEndsAtMs }, nowMs) =>
    horcrux === true && (horcruxEndsAtMs == null || nowMs < horcruxEndsAtMs);

const isCameraBlocked = (cameraBlockedUntilMs, nowMs) =>
    cameraBlockedUntilMs != null && nowMs < cameraBlockedUntilMs;

// A snapshot of one player's position for a ping, from their
// boundaryStatuses doc (`lastUsableMs` = its lastUsableReceivedAt in ms).
// Stale or missing positions are still included — the GM is alerted
// instead (staleLocationAlerts).
const pingEntry = ({ name, status, nowMs }) => {
    if (!status || status.lat == null || status.lng == null) {
        return {
            name,
            lat: null,
            lng: null,
            accuracyMeters: null,
            capturedAtMs: null,
            isStale: true,
        };
    }
    const capturedAtMs = status.lastUsableMs ?? null;
    return {
        name,
        lat: status.lat,
        lng: status.lng,
        accuracyMeters: status.accuracyMeters ?? null,
        capturedAtMs,
        isStale: !isPositionFresh(capturedAtMs, nowMs),
    };
};

// The chat text for a ping. Global pings name who was pinged and never
// the buyer; personal pings go only to the buyer.
const pingMessageText = ({ itemId, pings }) => {
    const names = pings.map((ping) => ping.name).join(', ');
    if (itemId === 'ping-targets') return `📍 Your targets: ${names}`;
    if (itemId === 'ping-assassins') return `📍 Your assassins: ${names}`;
    return `📍 ${names} has been pinged!`;
};

const ageText = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)} min`;
};

// One GM log line per pinged player whose position is stale or missing.
const staleLocationAlerts = (pings, nowMs) =>
    pings
        .filter((ping) => ping.isStale)
        .map((ping) =>
            ping.capturedAtMs == null
                ? `⚠️ ${ping.name} has no location on record — check their GPS`
                : `⚠️ ${ping.name}'s location is stale (last fix ${ageText(
                      nowMs - ping.capturedAtMs
                  )} ago) — check their GPS`
        );

module.exports = {
    AD_REWARD_POINTS,
    CAMERA_BLOCK_MS,
    HORCRUX_GRACE_MS,
    MYSTERY_BOX_OUTCOMES,
    rollMysteryBox,
    resolveMysteryOutcome,
    mysteryOutcomeLabel,
    isHorcruxActive,
    isCameraBlocked,
    pingEntry,
    pingMessageText,
    staleLocationAlerts,
};
