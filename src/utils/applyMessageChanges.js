// Merges a Firestore onSnapshot's docChanges() into the previous messages
// array, preserving object references for anything not present in this
// snapshot's changes — the property MessageBubble's React.memo relies on
// to skip re-rendering messages that haven't actually changed
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
// docChanges() reports every doc as 'added' on the very first snapshot,
// so calling this with an empty previousMessages array correctly
// bootstraps the initial load too.
export const applyMessageChanges = (previousMessages, docChanges) => {
    const next = [...previousMessages];
    docChanges.forEach((change) => {
        const existingIndex = next.findIndex((message) => message.id === change.doc.id);
        if (change.type === 'removed') {
            if (existingIndex !== -1) next.splice(existingIndex, 1);
            return;
        }
        const message = { id: change.doc.id, ...change.doc.data() };
        if (existingIndex !== -1) next.splice(existingIndex, 1);
        next.splice(change.newIndex, 0, message);
    });
    return next;
};
