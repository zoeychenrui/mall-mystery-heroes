import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, List } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { normalizePlayerName } from '../../game/playerNames';
import { applyMessageChanges } from '../../utils/applyMessageChanges';
import MessageBubble from './MessageBubble';

// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins
// (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
//
// Merges via docChanges() rather than remapping the full snapshot.docs
// every time, so a message untouched by a given snapshot keeps its exact
// object reference — what lets MessageBubble's React.memo skip
// re-rendering messages that haven't changed
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
//
// pendingMessages/onPendingMessageConfirmed are the sender's own
// not-yet-confirmed sends (owned by PlayerGame.js, added by
// MessageComposer.js) — appended to the rendered list immediately, since
// this player's own writes now go through a Cloud Function
// (submitChatMessage) instead of a direct client write, so there's no
// local Firestore echo of their own send anymore. Confirmed (removed from
// the pending list) the moment the real, server-written message for this
// player shows up here.
const MessageFeed = ({ roomID, playerName, pendingMessages = [], onPendingMessageConfirmed }) => {
    const [allMessages, setAllMessages] = useState([]);
    const feedBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        setAllMessages([]);
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                setAllMessages((previous) => applyMessageChanges(previous, snapshot.docChanges()));
                // A pending message this player just sent (PlayerGame.js
                // owns the list, MessageComposer.js adds to it) is
                // "confirmed" the moment its real, server-written
                // counterpart shows up here — consumed oldest-first, one
                // real arrival per pending entry, so the optimistic bubble
                // hands off to the real one with no gap or duplicate.
                snapshot.docChanges().forEach((change) => {
                    if (change.type !== 'added') return;
                    const data = change.doc.data();
                    if (
                        data.type === 'chat' &&
                        normalizePlayerName(data.sender) === normalizePlayerName(playerName)
                    ) {
                        onPendingMessageConfirmed?.();
                    }
                });
            },
            (error) => {
                // Losing the chat feed doesn't mean this player's session is
                // invalid, unlike the room/player-doc subscriptions in
                // PlayerGame.js — log only, don't clear the session or
                // navigate away.
                console.error('Error watching messages:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID, playerName, onPendingMessageConfirmed]);

    const normalizedPlayerName = normalizePlayerName(playerName);
    // allMessages stays unfiltered — applyMessageChanges' newIndex is a
    // position in the query's full result set, so filtering before storing
    // would corrupt future merges. messages (below) is the filtered,
    // rendered view.
    const messages = useMemo(
        () => [
            ...allMessages.filter(
                (message) =>
                    message.type !== 'gameEnded' &&
                    (!message.recipient ||
                        normalizePlayerName(message.recipient) === normalizedPlayerName)
            ),
            // Always mine, always visible only to me (they never leave this
            // browser's React state), so no recipient-style filtering
            // applies — always appended last, since they're always the
            // newest thing this player has done.
            ...pendingMessages,
        ],
        [allMessages, normalizedPlayerName, pendingMessages]
    );

    // The room-wide "please head back" announcement, posted once when the
    // GM ends the game — pulled out of the normal scrolling list and kept
    // visible above it, regardless of how much chat happens afterward.
    const pinnedMessage = useMemo(
        () => allMessages.find((message) => message.type === 'gameEnded'),
        [allMessages]
    );

    // Keeps the feed pinned to the newest message as it grows, matching the
    // same pattern already built for the GM's log panel
    // (GameMasterView.js's logsBoxRef).
    useEffect(() => {
        const feedBox = feedBoxRef.current;
        if (!feedBox) return;
        feedBox.scrollTop = feedBox.scrollHeight;
    }, [messages]);

    return (
        <Flex direction="column" flex="1" overflow="hidden">
            {pinnedMessage && (
                <List styleType="none" data-testid="pinned-message">
                    <MessageBubble message={pinnedMessage} playerName={playerName} />
                </List>
            )}
            <Box flex="1" overflow="auto" p={2} ref={feedBoxRef} data-testid="message-feed">
                <List styleType="none">
                    {messages.map((message) => (
                        <MessageBubble key={message.id} message={message} playerName={playerName} />
                    ))}
                </List>
            </Box>
        </Flex>
    );
};

export default MessageFeed;
