import { httpsCallable } from 'firebase/functions';
import { functions } from '../utils/firebase';

const submitChatMessageCallable = httpsCallable(functions, 'submitChatMessage');

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
