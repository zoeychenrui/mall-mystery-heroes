import { httpsCallable } from 'firebase/functions';
import { functions } from './firebaseConfig';

const joinRoomCallable = httpsCallable(functions, 'joinRoom');
const requestReconnectCallable = httpsCallable(functions, 'requestReconnect');
const leaveGameCallable = httpsCallable(functions, 'leaveGame');
const submitChatMessageCallable = httpsCallable(functions, 'submitChatMessage');
const submitKillPhotoCallable = httpsCallable(functions, 'submitKillPhoto');
const reportPlayerLocationCallable = httpsCallable(functions, 'reportPlayerLocation');
const purchasePowerUpCallable = httpsCallable(functions, 'purchasePowerUp');
const claimMysteryRewardCallable = httpsCallable(functions, 'claimMysteryReward');

/**
 * Lets the current signed-in user (Google or guest/anonymous) join a room
 * as a new player, from their own device
 * (docs/superpowers/specs/2026-08-06-player-access-and-room-lifecycle-design.md).
 * Only succeeds while the room is still in its Lobby phase.
 *
 * @throws if the room doesn't exist, has already started, or the name is
 *   already taken — surfaces as a rejected promise carrying `.message`.
 */
export const joinRoom = async (roomId, playerName) => {
    await joinRoomCallable({ roomId, playerName });
};

/**
 * Requests to reclaim an existing player's identity in a room whose game
 * has already started — the caller's own uid becomes pending approval,
 * not immediately linked
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 *
 * @throws if playerName doesn't match an existing player, or the room
 *   hasn't started/is no longer active — surfaces as a rejected promise
 *   carrying `.message`.
 */
export const requestReconnect = async (roomID, playerName) => {
    const { data } = await requestReconnectCallable({ roomId: roomID, playerName });
    return data;
};

/**
 * Removes the calling player from the room for good — unmaps them from
 * the target graph, reassigns whoever that leaves short, deletes their
 * player document, and announces the departure
 * (docs/superpowers/specs/2026-08-29-player-leave-and-kick-design.md).
 * The server resolves which player to remove from the caller's own uid —
 * no argument for it.
 *
 * @throws if the caller hasn't joined this room — surfaces as a rejected
 *   promise carrying `.message`.
 */
export const leaveGame = async (roomID) => {
    const { data } = await leaveGameCallable({ roomId: roomID });
    return data;
};

/**
 * Sends a player group-chat message on the caller's own behalf — the
 * Cloud Function derives who "the caller" is from their own signed-in
 * identity, so there is no sender name to pass here, only the text
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 *
 * @throws if the caller isn't a player of the room, the game has ended,
 *   or the rate limit is exceeded — surfaces as a rejected promise
 *   carrying `.message`, same as executeKill.js.
 */
export const submitChatMessage = async ({ roomId, text }) => {
    await submitChatMessageCallable({ roomId, text });
};

/**
 * Submits a kill-photo claim on the caller's own behalf — the Cloud
 * Function derives who "the caller" is from their own signed-in identity,
 * so there is no assassin name to pass here, only which target and which
 * already-uploaded photo url
 * (docs/superpowers/specs/2026-08-22-identity-verified-player-writes-design.md).
 * uploadKillPhoto (storageCalls.js) still handles the Storage upload
 * itself, unchanged — this only writes the Firestore doc pointing at it.
 *
 * @throws if the caller isn't a player of the room, the game has ended,
 *   the url isn't a legitimate photo for this room, the rate limit is
 *   exceeded, or target/mission aren't exactly-one-set (neither or both
 *   present, blank target, or non-integer mission) — surfaces as a
 *   rejected promise carrying `.message`, same as executeKill.js
 *   (docs/improvements.md item 10's error-propagation pattern needs no
 *   changes to handle this).
 */
export const submitKillPhoto = async ({ roomId, target, mission, url, isFunPhoto = false }) => {
    await submitKillPhotoCallable({ roomId, target, mission, url, isFunPhoto });
};

/**
 * Reports one location fix or one location error for the calling
 * player, evaluated server-side against the room's current game
 * boundary. Identity comes from the caller's own Firebase Auth session,
 * same as submitChatMessage.js — there is no player name to pass here.
 *
 * A fix report: { roomId, boundaryRevision, sampleMs, lat, lng, accuracyM }.
 * An error report: { roomId, boundaryRevision, sampleMs, error }, where
 * error is 'permission_denied' | 'unavailable' | 'timeout', with no
 * coordinates.
 *
 * @returns {Promise<{status: 'inside'|'outside'|'near'|'unavailable', reason: string|null}>}
 * @throws if the caller isn't a player of the room, the game has ended,
 *   the boundary is disabled or revision-mismatched, the sample is
 *   out-of-order/too old/too far in the future, or the rate limit is
 *   exceeded — surfaces as a rejected promise carrying `.message`.
 */
export const reportPlayerLocation = async (payload) => {
    const { data } = await reportPlayerLocationCallable(payload);
    return data;
};

/**
 * Buys a power-up on the caller's own behalf and uses it immediately —
 * the Cloud Function (functions/callableFunctions/purchasePowerUp.js)
 * derives the buyer from their signed-in identity, re-checks
 * price/cooldown/target, deducts the points, stores the cooldown, and
 * applies the effect. Score and cooldown reach the shop through its live
 * player-doc subscription.
 *
 * @returns {Promise<{mysteryBox?: {resolution: object, label: string, needsTarget: boolean}}>}
 *   `mysteryBox` only for the mystery box: what it rolled, for the reveal.
 * @throws if the purchase is blocked (not enough points, on cooldown,
 *   missing or invalid target, game not running) — surfaces as a rejected
 *   promise carrying `.message`, same as submitChatMessage.js.
 */
export const purchasePowerUp = async ({ roomId, itemId, targetName }) => {
    const { data } = await purchasePowerUpCallable({
        roomId,
        itemId,
        targetName: targetName || null,
    });
    return data ?? {};
};

/**
 * Uses a mystery box's rolled item that needed a player picked (the picked
 * ping or the camera block) on `targetName`. Free — the box was paid for.
 *
 * @throws if there's nothing to claim or the target is invalid.
 */
export const claimMysteryReward = async ({ roomId, targetName }) => {
    await claimMysteryRewardCallable({ roomId, targetName });
};
