const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.Timestamp /
// admin.firestore.FieldValue: the Functions emulator wraps the top-level
// admin.firestore property in a Function.prototype.bind() (see
// firebase-tools' functionsEmulatorRuntime.js Proxied.getOriginal), and a
// bound function carries none of the original's static properties —
// admin.firestore.Timestamp/FieldValue are undefined under `npm run
// test:emulator` even though they resolve fine outside the emulator (see
// joinRoom.js's identical comment on FieldValue, and submitKillPhoto.js's
// identical fix). This subpath import isn't proxied the same way.
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
// Vendored copy, not '../../src/game/rateLimit' — Cloud Functions deploy
// uploads only the functions/ directory in isolation, so a require()
// reaching outside it cannot resolve in the deployed bundle even though it
// works locally and under the emulator. Kept in sync by
// functions/scripts/sync-shared-game-logic.js (predeploy hook + local test
// setup) — src/game/ remains the single source of truth.
const { nextRateLimitWindow } = require('../vendor/game/rateLimit');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

const CHAT_RATE_LIMIT = { max: 20, windowMs: 60000 };

/**
 * Writes a player chat message on the caller's behalf, deriving who the
 * caller actually is from context.auth.uid rather than trusting a
 * client-supplied `sender` field — closing the identity-spoofing gap
 * addChatMessageForRoom (src/components/firebase_calls/dbCalls.js,
 * deleted in Task 5 of this plan) had. Also enforces a per-player rate
 * limit (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 * Intentionally not gated on the room's isGameActive — chat stays open
 * after the game ends, so players can banter on the way back to the
 * starting area.
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely.
 * firestore.rules's `playerMessages` `allow write: if
 * isHostOfExistingRoom` clause for GM broadcasts/whispers/leaderboard/
 * mission messages is untouched and unaffected by this function — those
 * write a different set of `type` values (never `'chat'`) through a
 * separate, still-existing dbCalls.addPlayerMessageForRoom path.
 */
exports.submitChatMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { roomId, text } = data;
    if (!roomId || !text) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'roomId and text are both required.'
        );
    }
    // MessageComposer.js's maxLength={500} is a UI affordance, not
    // enforcement — a scripted client can post any `text` it likes
    // (docs/improvements.md item 57). A non-string would also break every
    // reader: MessageBubble.js renders `{message.text}` directly, so an
    // array or object here throws while rendering and takes down the whole
    // message feed and the GM panel, not just the offending message. Same
    // 500 the composer caps at, now enforced where it cannot be bypassed.
    if (typeof text !== 'string' || text.length > 500) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'text must be a string of 500 characters or fewer.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }

        const senderSnapshot = await transaction.get(
            playersRef.where('uid', '==', context.auth.uid)
        );
        if (senderSnapshot.empty) {
            throw new functions.https.HttpsError(
                'not-found',
                'You are not a player of this room.'
            );
        }
        // Nothing enforces one player doc per uid per room: joinRoom.js
        // checks only that the *name* is not taken, so the same uid
        // revisiting /join under a second name owns two player docs here
        // (docs/improvements.md item 66). Taking docs[0] would silently
        // send every message under whichever name sorts first, and would
        // permanently lock the other identity out of chatting as itself.
        // Fail loudly instead — the GM can delete the stray player doc.
        if (senderSnapshot.size > 1) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Multiple player identities are linked to your account in this room — ask your GM for help.'
            );
        }
        const senderDoc = senderSnapshot.docs[0];
        const senderData = senderDoc.data();

        // Deliberately not gated on isGameActive — once a game ends, players
        // are still walking back to the starting area and should be able to
        // banter the whole way, not just up to the moment the GM clicks
        // "End Game". submitKillPhoto.js keeps its own isGameActive check
        // (nothing left to submit a kill for once the game's over).
        const rateLimits = senderData.rateLimits || {};
        const currentWindow = rateLimits.chat
            ? {
                  windowStartMs: rateLimits.chat.windowStart.toMillis(),
                  count: rateLimits.chat.count,
              }
            : null;
        const nextWindow = nextRateLimitWindow(currentWindow, Date.now(), CHAT_RATE_LIMIT);
        if (!nextWindow) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Too many submissions — slow down and try again in a moment.'
            );
        }

        transaction.update(senderDoc.ref, {
            rateLimits: {
                ...rateLimits,
                chat: {
                    windowStart: Timestamp.fromMillis(nextWindow.windowStartMs),
                    count: nextWindow.count,
                },
            },
        });

        transaction.create(roomRef.collection('playerMessages').doc(), {
            type: 'chat',
            recipient: null,
            text,
            standings: null,
            mission: null,
            sender: senderData.name,
            timestamp: FieldValue.serverTimestamp(),
        });
    });
});
