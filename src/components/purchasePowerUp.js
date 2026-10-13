import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const purchasePowerUpCallable = httpsCallable(functions, 'purchasePowerUp');

/**
 * Buys a power-up on the caller's own behalf — the Cloud Function
 * (functions/callableFunctions/purchasePowerUp.js) derives the buyer from
 * their signed-in identity, re-checks price/cooldown/target, deducts the
 * points, and stores the cooldown on the player doc. The shop picks both
 * changes up from its live player-doc subscription; nothing is returned.
 *
 * @throws if the purchase is blocked (not enough points, on cooldown,
 *   missing or invalid target, game not running) — surfaces as a rejected
 *   promise carrying `.message`, same as submitChatMessage.js.
 */
export const purchasePowerUp = async ({ roomId, itemId, targetName }) => {
    await purchasePowerUpCallable({ roomId, itemId, targetName: targetName || null });
};
