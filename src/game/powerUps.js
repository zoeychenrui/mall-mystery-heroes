// Also vendored for Cloud Functions (functions/scripts/sync-shared-game-logic.js
// copies both files), so this relative require resolves there too.
const { normalizePlayerName } = require('./playerNames');

const RARITY_COLORS = {
    common: 'gray.100',
    rare: 'blue.100',
    mythic: 'yellow.300',
    na: 'whiteAlpha.200',
};

const POWER_UPS = [
    {
        id: 'watch-ad',
        name: 'Watch an ad',
        cost: 0,
        rarity: 'na',
        cooldownSeconds: 300,
        needsTarget: false,
    },
    {
        id: 'ping-assassins',
        name: 'Ping your assassins',
        cost: 4,
        rarity: 'common',
        cooldownSeconds: 90,
        needsTarget: false,
    },
    {
        id: 'ping-targets',
        name: 'Ping your targets',
        cost: 5,
        rarity: 'common',
        cooldownSeconds: 90,
        needsTarget: false,
    },
    {
        id: 'global-ping-picked',
        name: 'Global ping: picked player',
        cost: 6,
        rarity: 'rare',
        cooldownSeconds: 150,
        needsTarget: true,
    },
    {
        id: 'global-ping-random',
        name: 'Global ping: random player',
        cost: 3,
        rarity: 'common',
        cooldownSeconds: 180,
        needsTarget: false,
    },
    {
        id: 'block-camera',
        name: "Block a player's camera",
        cost: 7,
        rarity: 'rare',
        cooldownSeconds: 120,
        needsTarget: true,
    },
    {
        id: 'horcrux',
        name: 'Horcrux',
        cost: 20,
        rarity: 'mythic',
        cooldownSeconds: 360,
        needsTarget: false,
    },
    {
        id: 'mystery-box',
        name: 'Mystery box',
        cost: 4,
        rarity: 'na',
        cooldownSeconds: 120,
        needsTarget: false,
    },
];

const purchaseBlockReason = ({
    item,
    score,
    cooldownEndsAtMs,
    nowMs,
    targetName,
    isAlive,
    horcruxActive,
}) => {
    // `=== false`, not `!isAlive`: callers that don't know yet (undefined)
    // aren't treated as dead.
    if (isAlive === false) return "Eliminated players can't shop";
    if (cooldownEndsAtMs != null && nowMs < cooldownEndsAtMs) return 'On cooldown';
    // Non-stackable (POWER_UPS_SPEC.md): one active Horcrux at a time.
    if (item.id === 'horcrux' && horcruxActive === true) return 'Horcrux already active';
    if (Number(score) < item.cost) return 'Not enough points';
    if (item.needsTarget === true && !targetName) return 'Pick a player';
    return null;
};

const cooldownRemaining = ({ cooldownEndsAtMs, nowMs, cooldownSeconds }) => {
    const msLeft = Math.max(0, (cooldownEndsAtMs ?? 0) - nowMs);
    const secondsLeft = Math.ceil(msLeft / 1000);
    const fractionLeft = msLeft / (cooldownSeconds * 1000);

    return { secondsLeft, fractionLeft };
};

const formatSeconds = (seconds) => {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// A random alive player other than the buyer, or null if there is none.
// `rng` returns [0, 1) like Math.random — injected so tests can pick.
const pickRandomPingTarget = (players, buyerName, rng) => {
    const buyer = normalizePlayerName(buyerName);
    const eligible = players.filter(
        (player) => player.isAlive && normalizePlayerName(player.name) !== buyer
    );
    if (eligible.length === 0) return null;
    return eligible[Math.floor(rng() * eligible.length)].name;
};

// The GM console's log line for a purchase. `detail` says what it did,
// e.g. "pinged bob" or "rolled +5 points".
const purchaseLogText = ({ buyerName, item, detail }) => {
    const price = item.cost > 0 ? ` (-${item.cost} pts)` : '';
    const base = `${buyerName} bought ${item.name}${price}`;
    return detail ? `${base} — ${detail}` : base;
};

module.exports = {
    POWER_UPS,
    RARITY_COLORS,
    purchaseBlockReason,
    cooldownRemaining,
    formatSeconds,
    pickRandomPingTarget,
    purchaseLogText,
};
