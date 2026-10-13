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
    pingMessageText,
} = require('../vendor/game/powerUps');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Pings announced to the whole room's player chat. The personal pings
// (ping-assassins/ping-targets) will be whispers once GPS exists.
const GLOBAL_PINGS = ['global-ping-picked', 'global-ping-random'];

const reject = (message) => {
    throw new functions.https.HttpsError('failed-precondition', message);
};

/**
 * Buys a power-up from the shop on the caller's own behalf
 * (POWER_UPS_SPEC.md). The buyer is derived from context.auth.uid, never
 * a client-supplied name — same identity rule as submitChatMessage.js.
 *
 * One transaction re-checks every rule the shop UI shows
 * (src/game/powerUps.js's purchaseBlockReason — the same function, so the
 * two can't drift), then deducts the price from `score` and stores the
 * item's cooldown end in `powerUpCooldowns`. Two quick taps can't
 * double-spend: the second transaction sees the first one's cooldown.
 *
 * Every purchase is logged to the GM console (`logs`). A global ping
 * also posts to player chat (`playerMessages`, type 'powerUpPing') naming
 * who was pinged — the random ping picks among other alive players here,
 * server-side. The ping's location snapshot is still TODO: GPS is another
 * teammate's work, so `location` is written as null for now.
 *
 * Other item effects are not implemented yet. Each slots in here, inside
 * the same transaction, once its dependency exists (killPlayer.js for
 * Horcrux, and so on).
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely —
 * players cannot write their own score directly, which is why this is a
 * Cloud Function at all.
 */
exports.purchasePowerUp = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, itemId, targetName } = data;
    if (typeof roomId !== 'string' || typeof itemId !== 'string') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and itemId must both be strings.'
        );
    }
    if (targetName !== undefined && targetName !== null && typeof targetName !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'targetName must be a string.');
    }

    const item = POWER_UPS.find((powerUp) => powerUp.id === itemId);
    if (!item) reject('Unknown item');

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        const room = roomSnapshot.data();
        if (!room.gameStarted || !room.isGameActive) {
            reject('The shop is only open during a game.');
        }

        const buyerSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (buyerSnapshot.empty) {
            throw new functions.https.HttpsError(
                'not-found',
                'You are not a player of this room.'
            );
        }
        // Same guard as submitChatMessage.js (docs/improvements.md item 66):
        // one uid owning two player docs would make "who is buying"
        // ambiguous, so fail loudly instead of charging docs[0].
        if (buyerSnapshot.size > 1) {
            reject(
                'Multiple player identities are linked to your account in this room — ask your GM for help.'
            );
        }
        const buyerDoc = buyerSnapshot.docs[0];
        const buyer = buyerDoc.data();

        // All reads before any write — Firestore transactions require it.
        let targetSnapshot = null;
        if (item.needsTarget && targetName) {
            targetSnapshot = await transaction.get(
                playersRef.doc(normalizePlayerName(targetName))
            );
        }
        let alivePlayers = [];
        if (item.id === 'global-ping-random') {
            const aliveSnapshot = await transaction.get(playersRef.where('isAlive', '==', true));
            alivePlayers = aliveSnapshot.docs.map((doc) => doc.data());
        }

        const cooldowns = buyer.powerUpCooldowns || {};
        const nowMs = Date.now();
        const blockReason = purchaseBlockReason({
            item,
            score: buyer.score,
            cooldownEndsAtMs: cooldowns[item.id] ? cooldowns[item.id].toMillis() : null,
            nowMs,
            targetName,
            isAlive: buyer.isAlive,
        });
        if (blockReason) reject(blockReason);

        if (
            targetSnapshot &&
            (!targetSnapshot.exists ||
                targetSnapshot.id === buyerDoc.id ||
                !targetSnapshot.data().isAlive)
        ) {
            reject('Pick another alive player');
        }

        let pingedName = null;
        if (item.id === 'global-ping-picked') {
            pingedName = targetSnapshot.data().name;
        } else if (item.id === 'global-ping-random') {
            pingedName = pickRandomPingTarget(alivePlayers, buyer.name, Math.random);
            if (!pingedName) reject('No one to ping');
        }

        // Number(): score is sometimes stored as a string (docs/data-model.md);
        // always write a number back.
        transaction.update(buyerDoc.ref, {
            score: Number(buyer.score) - item.cost,
            [`powerUpCooldowns.${item.id}`]: Timestamp.fromMillis(
                nowMs + item.cooldownSeconds * 1000
            ),
        });

        transaction.set(roomRef.collection('logs').doc(), {
            time: new Date().toLocaleTimeString(),
            log: purchaseLogText({ buyerName: buyer.name, item, pingedName }),
            color: 'orange.300',
            timestamp: FieldValue.serverTimestamp(),
        });

        if (GLOBAL_PINGS.includes(item.id)) {
            transaction.create(roomRef.collection('playerMessages').doc(), {
                type: 'powerUpPing',
                recipient: null,
                text: pingMessageText(pingedName),
                pingedPlayer: pingedName,
                // TODO(power-ups): the pinged player's location snapshot,
                // once the GPS work lands. Null until then.
                location: null,
                standings: null,
                mission: null,
                sender: null,
                timestamp: FieldValue.serverTimestamp(),
            });
        }
    });
});
