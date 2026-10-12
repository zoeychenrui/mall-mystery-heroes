// Converts a Firestore Timestamp to a clock-time string ("3:45 PM") for
// display in the player message feed. A still-pending write's
// serverTimestamp() reads as null/undefined locally until the server acks
// it — that renders as no time text at all rather than a placeholder
// (docs/superpowers/specs/2026-08-12-chat-message-bubbles-design.md).
export const formatMessageTime = (timestamp) => {
    if (!timestamp) return null;
    return timestamp.toDate().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
};
