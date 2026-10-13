import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const purchasePowerUpCallable = httpsCallable(functions, 'purchasePowerUp');
const claimMysteryRewardCallable = httpsCallable(functions, 'claimMysteryReward');

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
