const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.Timestamp — see
// submitChatMessage.js's identical comment for why (the Functions emulator
// strips static properties off the top-level admin.firestore binding).
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
// Vendored copies, not '../../src/game/...' — Cloud Functions deploy
// uploads only the functions/ directory in isolation. Kept in sync by
// functions/scripts/sync-shared-game-logic.js — src/game/ remains the
// single source of truth.
const {
    POWER_UPS,
    purchaseBlockReason,
    pickRandomPingTarget,
    purchaseLogText,
} = require('../vendor/game/powerUps');
const {
    AD_REWARD_POINTS,
    CAMERA_BLOCK_MS,
    rollMysteryBox,
    resolveMysteryOutcome,
    mysteryOutcomeLabel,
    isHorcruxActive,
    pingEntry,
    pingMessageText,
    staleLocationAlerts,
} = require('../vendor/game/powerUpEffects');
const { normalizePlayerName } = require('../vendor/game/playerNames');
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Shared by purchasePowerUp and claimMysteryReward. Real play never comes
// close — every item has a 90s+ cooldown — so this only stops a script
// hammering the endpoint, where each call costs an invocation and reads.
const POWER_UP_RATE_LIMIT = { max: 20, windowMs: 60000 };

const PURCHASE_LOG_COLOR = 'orange.300';
const LOCATION_ALERT_COLOR = 'orange.500';

const reject = (message) => {
    throw new functions.https.HttpsError('failed-precondition', message);
};

const itemById = (itemId) => POWER_UPS.find((powerUp) => powerUp.id === itemId);
const toMs = (timestamp) => (timestamp ? timestamp.toMillis() : null);
const cooldownEndsAtMs = (buyer, itemId) => toMs((buyer.powerUpCooldowns || {})[itemId]);
const horcruxActiveFor = (player, nowMs) =>
    isHorcruxActive(
        { horcrux: player.horcrux, horcruxEndsAtMs: toMs(player.horcruxEndsAt) },
        nowMs
    );

/**
 * Counts this call against the caller's rate limit, in its own small
 * transaction BEFORE the purchase. It can't share the purchase's
 * transaction: most rejections ("On cooldown", "Not enough points") throw,
 * and a throw discards every write in its transaction — the counter too —
 * so spammed rejected calls would never be counted.
 *
 * Stored in rooms/{roomId}/powerUpRateLimits/{uid}, not on the player doc
 * the way submitChatMessage.js does it: every player and the GM listen to
 * the roster, so a counter on the player doc would push an extra read to
 * each of them on every purchase. Nothing listens to this doc, and
 * firestore.rules has no match for it, so clients can't read or write it.
 * Deleted with the room by cleanupEndedRooms' recursiveDelete.
 */
const consumeRateLimit = (roomId, uid) =>
    db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        // Checked first so a call with a made-up roomId can't create
        // counter docs under rooms that don't exist.
        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        const limitRef = roomRef.collection('powerUpRateLimits').doc(uid);
        const limitSnapshot = await transaction.get(limitRef);
        const current = limitSnapshot.exists
            ? {
                  windowStartMs: limitSnapshot.data().windowStart.toMillis(),
                  count: limitSnapshot.data().count,
              }
            : null;
        const next = nextRateLimitWindow(current, Date.now(), POWER_UP_RATE_LIMIT);
        if (!next) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many purchases — slow down and try again in a moment.'
            );
        }
        transaction.set(limitRef, {
            windowStart: Timestamp.fromMillis(next.windowStartMs),
            count: next.count,
        });
    });

/**
 * Shared opening for both callables below: auth, the room is mid-game,
 * and the caller owns exactly one player doc in it. Reads only.
 */
const loadBuyer = async (transaction, roomId, uid) => {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) {
        throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
    }
    const room = roomSnapshot.data();
    if (!room.gameStarted || !room.isGameActive) {
        reject('The shop is only open during a game.');
    }

    const buyerSnapshot = await transaction.get(
        roomRef.collection('players').where('uid', '==', uid)
    );
    if (buyerSnapshot.empty) {
        throw new functions.https.HttpsError('not-found', 'You are not a player of this room.');
    }
    // Same guard as submitChatMessage.js (docs/improvements.md item 66):
    // one uid owning two player docs would make "who is buying" ambiguous,
    // so fail loudly instead of charging docs[0].
    if (buyerSnapshot.size > 1) {
        reject(
            'Multiple player identities are linked to your account in this room — ask your GM for help.'
        );
    }
    const buyerDoc = buyerSnapshot.docs[0];
    return { roomRef, buyerDoc, buyer: buyerDoc.data() };
};

// Reads another alive player picked by name. Rejects yourself, the dead,
// and names that don't exist.
const readPickedPlayer = async (transaction, roomRef, buyerDoc, targetName) => {
    if (!targetName) reject('Pick a player');
    const snapshot = await transaction.get(
        roomRef.collection('players').doc(normalizePlayerName(targetName))
    );
    if (!snapshot.exists || snapshot.id === buyerDoc.id || !snapshot.data().isAlive) {
        reject('Pick another alive player');
    }
    return snapshot;
};

// One ping entry per name, from each player's boundaryStatuses doc — the
// GPS system's latest stored position. A snapshot: copied once, now.
const readPings = async (transaction, roomRef, names, nowMs) => {
    const pings = [];
    for (const name of names) {
        const statusSnapshot = await transaction.get(
            roomRef.collection('boundaryStatuses').doc(normalizePlayerName(name))
        );
        const status = statusSnapshot.exists ? statusSnapshot.data() : null;
        pings.push(
            pingEntry({
                name,
                status: status && {
                    lat: status.lat,
                    lng: status.lng,
                    accuracyMeters: status.accuracyMeters,
                    lastUsableMs: toMs(status.lastUsableReceivedAt),
                },
                nowMs,
            })
        );
    }
    return pings;
};

/**
 * Decides what one item does, without writing anything — every read
 * happens here, every write is returned for the caller to perform, so
 * the caller can finish its own reads first (Firestore transactions
 * require all reads before any write) and the mystery box can reuse the
 * same effects for the item it rolls.
 *
 * Returns { refuse } when the item can't be used right now (nobody to
 * ping), or { buyerUpdates, writes, logs, detail, result }:
 *   buyerUpdates  fields to merge into the buyer's own update
 *   writes        [{ ref, fields, op: 'update' | 'create' }] for other docs
 *   logs          extra GM log lines [{ log, color }]
 *   detail        what it did, for the purchase's own log line
 *   result        what the client gets back (e.g. the mystery box roll)
 */
const planEffect = async ({ transaction, roomRef, itemId, buyer, buyerDoc, targetName, nowMs }) => {
    const effect = { buyerUpdates: {}, writes: [], logs: [], detail: null, result: {} };
    const playerMessage = (fields) =>
        effect.writes.push({
            op: 'create',
            ref: roomRef.collection('playerMessages').doc(),
            fields: Object.assign(
                {
                    recipient: null,
                    standings: null,
                    mission: null,
                    sender: null,
                    timestamp: FieldValue.serverTimestamp(),
                },
                fields
            ),
        });
    const announcePings = (pings, recipient) => {
        playerMessage({
            type: 'powerUpPing',
            recipient,
            text: pingMessageText({ itemId, pings }),
            pingedPlayer: recipient ? null : pings[0].name,
            pings,
        });
        for (const alert of staleLocationAlerts(pings, nowMs)) {
            effect.logs.push({ log: alert, color: LOCATION_ALERT_COLOR });
        }
        effect.detail = `pinged ${pings.map((ping) => ping.name).join(', ')}`;
    };

    switch (itemId) {
        case 'watch-ad':
            // TODO(power-ups): there is no ad provider in this project yet,
            // so ad completion can't be verified — the reward is granted on
            // request. Gate this on a real completion callback once one exists.
            effect.buyerUpdates.scoreDelta = AD_REWARD_POINTS;
            effect.detail = `+${AD_REWARD_POINTS} points`;
            break;

        case 'ping-targets':
        case 'ping-assassins': {
            const names = itemId === 'ping-targets' ? buyer.targets : buyer.assassins;
            if (!names || names.length === 0) return { refuse: 'Nobody to ping' };
            announcePings(await readPings(transaction, roomRef, names, nowMs), buyer.name);
            break;
        }

        case 'global-ping-picked': {
            const picked = await readPickedPlayer(transaction, roomRef, buyerDoc, targetName);
            announcePings(await readPings(transaction, roomRef, [picked.data().name], nowMs), null);
            break;
        }

        case 'global-ping-random': {
            const aliveSnapshot = await transaction.get(
                roomRef.collection('players').where('isAlive', '==', true)
            );
            const pickedName = pickRandomPingTarget(
                aliveSnapshot.docs.map((doc) => doc.data()),
                buyer.name,
                Math.random
            );
            if (!pickedName) return { refuse: 'No one to ping' };
            announcePings(await readPings(transaction, roomRef, [pickedName], nowMs), null);
            break;
        }

        case 'block-camera': {
            const picked = await readPickedPlayer(transaction, roomRef, buyerDoc, targetName);
            const pickedName = picked.data().name;
            effect.writes.push({
                op: 'update',
                ref: picked.ref,
                fields: { cameraBlockedUntil: Timestamp.fromMillis(nowMs + CAMERA_BLOCK_MS) },
            });
            // Only the blocked player is told — they'll also see the X over
            // their camera button. The buyer isn't named.
            playerMessage({
                type: 'powerUpNotice',
                recipient: pickedName,
                text: `📷 Your camera has been blocked for ${CAMERA_BLOCK_MS / 1000} seconds!`,
            });
            effect.detail = `blocked ${pickedName}'s camera`;
            break;
        }

        case 'horcrux':
            // Kept secret until it saves them — killPlayer.js announces it then.
            effect.buyerUpdates.horcrux = true;
            effect.buyerUpdates.horcruxEndsAt = null;
            break;

        default:
            reject('Unknown item');
    }
    return effect;
};

// Applies everything planEffect (or several) decided, plus the purchase's
// own log line. Writes only — call after every read.
const commit = ({
    transaction,
    roomRef,
    buyerDoc,
    buyer,
    scoreChange,
    buyerUpdates,
    effects,
    logLine,
}) => {
    const update = {};
    let scoreDelta = scoreChange;
    for (const effect of effects) {
        for (const [key, value] of Object.entries(effect.buyerUpdates)) {
            if (key === 'scoreDelta') scoreDelta += value;
            else update[key] = value;
        }
    }
    Object.assign(update, buyerUpdates);
    // Number(): score is sometimes stored as a string (docs/data-model.md);
    // always write a number back.
    update.score = Number(buyer.score) + scoreDelta;
    transaction.update(buyerDoc.ref, update);

    const addLog = (log, color) =>
        transaction.set(roomRef.collection('logs').doc(), {
            time: new Date().toLocaleTimeString(),
            log,
            color,
            timestamp: FieldValue.serverTimestamp(),
        });
    addLog(logLine, PURCHASE_LOG_COLOR);
    for (const effect of effects) {
        for (const write of effect.writes) {
            if (write.op === 'create') transaction.create(write.ref, write.fields);
            else transaction.update(write.ref, write.fields);
        }
        for (const { log, color } of effect.logs) addLog(log, color);
    }
};

const validateArgs = (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }
    const { roomId, targetName } = data;
    if (typeof roomId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'roomId must be a string.');
    }
    if (targetName !== undefined && targetName !== null && typeof targetName !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'targetName must be a string.');
    }
};

/**
 * Buys a power-up from the shop on the caller's own behalf and uses it
 * immediately (POWER_UPS_SPEC.md). The buyer is derived from
 * context.auth.uid, never a client-supplied name — same identity rule as
 * submitChatMessage.js.
 *
 * One transaction re-checks every rule the shop UI shows
 * (src/game/powerUps.js's purchaseBlockReason — the same function, so the
 * two can't drift), deducts the price, starts the cooldown, applies the
 * item's effect (planEffect above), and logs it to the GM console. Two
 * quick taps can't double-spend: the second sees the first's cooldown.
 *
 * The mystery box rolls here too (src/game/powerUpEffects.js). A rolled
 * item that needs a player picked (picked ping, camera block) can't be
 * used yet — it's parked in `pendingMysteryItem` for claimMysteryReward
 * below, after the player has seen the reveal and picked someone.
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely —
 * players cannot write their own score directly, which is why this is a
 * Cloud Function at all.
 */
exports.purchasePowerUp = functions.https.onCall(async (data, context) => {
    validateArgs(data, context);
    const { roomId, itemId, targetName } = data;
    if (typeof itemId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'itemId must be a string.');
    }
    const item = itemById(itemId);
    if (!item) reject('Unknown item');

    // Rolled once, outside the transaction: Firestore may re-run a
    // transaction on contention, and a retry must not re-roll.
    const outcome = item.id === 'mystery-box' ? rollMysteryBox(Math.random) : null;

    await consumeRateLimit(roomId, context.auth.uid);

    return db.runTransaction(async (transaction) => {
        const { roomRef, buyerDoc, buyer } = await loadBuyer(transaction, roomId, context.auth.uid);
        const nowMs = Date.now();
        const horcruxActive = horcruxActiveFor(buyer, nowMs);

        const blockReason = purchaseBlockReason({
            item,
            score: buyer.score,
            cooldownEndsAtMs: cooldownEndsAtMs(buyer, item.id),
            nowMs,
            targetName,
            isAlive: buyer.isAlive,
            horcruxActive,
        });
        if (blockReason) reject(blockReason);
        if (item.id === 'mystery-box' && buyer.pendingMysteryItem) {
            reject('Claim your last mystery box reward first');
        }

        const cooldownField = (id) => ({
            [`powerUpCooldowns.${id}`]: Timestamp.fromMillis(
                nowMs + itemById(id).cooldownSeconds * 1000
            ),
        });
        let scoreChange = -item.cost;
        const buyerUpdates = cooldownField(item.id);
        const effects = [];
        let detail = null;
        let result = {};

        if (item.id === 'mystery-box') {
            let resolution = resolveMysteryOutcome({
                outcome,
                cooldownEndsAtMs: outcome.itemId ? cooldownEndsAtMs(buyer, outcome.itemId) : null,
                nowMs,
                horcruxActive,
            });

            if (resolution.kind === 'item' && itemById(resolution.itemId).needsTarget) {
                // Picked after the reveal — see claimMysteryReward.
                buyerUpdates.pendingMysteryItem = resolution.itemId;
            } else if (resolution.kind === 'item') {
                const effect = await planEffect({
                    transaction,
                    roomRef,
                    itemId: resolution.itemId,
                    buyer,
                    buyerDoc,
                    nowMs,
                });
                if (effect.refuse) {
                    // Rolled an item nobody can be targeted with — refund
                    // its value like any other unusable item.
                    resolution = {
                        kind: 'refund',
                        itemId: resolution.itemId,
                        points: itemById(resolution.itemId).cost,
                    };
                } else {
                    effects.push(effect);
                    Object.assign(buyerUpdates, cooldownField(resolution.itemId));
                }
            }
            if (resolution.kind === 'points' || resolution.kind === 'refund') {
                scoreChange += resolution.points;
            }

            const label = mysteryOutcomeLabel(resolution);
            detail = `rolled ${label}`;
            result = {
                mysteryBox: {
                    resolution,
                    label,
                    needsTarget: buyerUpdates.pendingMysteryItem !== undefined,
                },
            };
        } else {
            const effect = await planEffect({
                transaction,
                roomRef,
                itemId: item.id,
                buyer,
                buyerDoc,
                targetName,
                nowMs,
            });
            if (effect.refuse) reject(effect.refuse);
            effects.push(effect);
            detail = effect.detail;
        }

        commit({
            transaction,
            roomRef,
            buyerDoc,
            buyer,
            scoreChange,
            buyerUpdates,
            effects,
            logLine: purchaseLogText({ buyerName: buyer.name, item, detail }),
        });
        return result;
    });
});

/**
 * Uses a mystery box's parked item (`pendingMysteryItem` — the picked ping
 * or camera block) on the player the buyer just picked on the reveal
 * screen. Free: the box was already paid for. Starts that item's normal
 * cooldown, same as buying it would.
 */
exports.claimMysteryReward = functions.https.onCall(async (data, context) => {
    validateArgs(data, context);
    const { roomId, targetName } = data;

    await consumeRateLimit(roomId, context.auth.uid);

    return db.runTransaction(async (transaction) => {
        const { roomRef, buyerDoc, buyer } = await loadBuyer(transaction, roomId, context.auth.uid);
        if (buyer.isAlive === false) reject("Eliminated players can't shop");
        const itemId = buyer.pendingMysteryItem;
        if (!itemId) reject('No mystery box reward to claim');
        const nowMs = Date.now();

        const effect = await planEffect({
            transaction,
            roomRef,
            itemId,
            buyer,
            buyerDoc,
            targetName,
            nowMs,
        });
        if (effect.refuse) reject(effect.refuse);

        commit({
            transaction,
            roomRef,
            buyerDoc,
            buyer,
            scoreChange: 0,
            buyerUpdates: {
                pendingMysteryItem: FieldValue.delete(),
                [`powerUpCooldowns.${itemId}`]: Timestamp.fromMillis(
                    nowMs + itemById(itemId).cooldownSeconds * 1000
                ),
            },
            effects: [effect],
            logLine: `${buyer.name} used a mystery box ${itemById(itemId).name} — ${effect.detail}`,
        });
    });
});
