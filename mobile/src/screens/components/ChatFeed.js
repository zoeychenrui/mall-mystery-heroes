import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { onSnapshot } from 'firebase/firestore';
import * as dbCalls from '../../firebase/dbCalls';
import { normalizePlayerName } from '../../../../src/game/playerNames';
import { applyMessageChanges } from '../../../../src/utils/applyMessageChanges';
import MessageBubble from './MessageBubble';

// RN port of src/components/player_messages_components/MessageFeed.js.
// Live-subscribes to the room's playerMessages and filters to what this
// player should see: broadcasts/leaderboard sends (recipient: null) and
// any whisper addressed to them. Not gated on gameStarted — the feed is
// visible from the moment a player joins.
//
// Merges via docChanges() rather than remapping the full snapshot.docs
// every time, so a message untouched by a given snapshot keeps its exact
// object reference, same reasoning as the web version.
//
// pendingMessages/onPendingMessageConfirmed are the sender's own
// not-yet-confirmed sends (owned by GameScreen.js, added by
// ChatComposer.js) — appended to the rendered list immediately, since
// this player's own writes go through a Cloud Function
// (callables.submitChatMessage) rather than a direct client write, so
// there's no local Firestore echo of their own send. Confirmed (removed
// from the pending list) the moment the real, server-written message for
// this player shows up here.
const ChatFeed = ({
    roomID,
    playerName,
    pendingMessages = [],
    onPendingMessageConfirmed,
    // Opens the map on a ping card's positions; absent until Task 12.
    onShowPings,
}) => {
    const [allMessages, setAllMessages] = useState([]);
    const listRef = useRef(null);

    useEffect(() => {
        if (!roomID || !playerName) return undefined;
        setAllMessages([]);
        const messagesQuery = dbCalls.fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                setAllMessages((previous) => applyMessageChanges(previous, snapshot.docChanges()));
                // A pending message this player just sent (GameScreen.js
                // owns the list, ChatComposer.js adds to it) is
                // "confirmed" the moment its real, server-written
                // counterpart shows up here — consumed oldest-first, one
                // real arrival per pending entry.
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
                // Losing the chat feed doesn't mean this player's session
                // is invalid, unlike GameScreen's room/player-doc
                // subscriptions — log only, don't clear the session or
                // navigate away.
                console.error('Error watching messages:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID, playerName, onPendingMessageConfirmed]);

    const normalizedPlayerName = normalizePlayerName(playerName);
    // allMessages stays unfiltered — applyMessageChanges' newIndex is a
    // position in the query's full result set, so filtering before
    // storing would corrupt future merges. messages (below) is the
    // filtered, rendered view.
    const messages = useMemo(
        () => [
            ...allMessages.filter(
                (message) =>
                    message.type !== 'gameEnded' &&
                    (!message.recipient ||
                        normalizePlayerName(message.recipient) === normalizedPlayerName)
            ),
            // Always mine, always visible only to me (they never leave
            // this device's React state), appended last.
            ...pendingMessages,
        ],
        [allMessages, normalizedPlayerName, pendingMessages]
    );

    // The room-wide "please head back" announcement, posted once when the
    // GM ends the game — pulled out of the normal scrolling list and kept
    // visible above it.
    const pinnedMessage = useMemo(
        () => allMessages.find((message) => message.type === 'gameEnded'),
        [allMessages]
    );

    // Keeps the feed pinned to the newest message as it grows, RN's
    // FlatList equivalent of the web's feedBoxRef.scrollTop assignment.
    useEffect(() => {
        listRef.current?.scrollToEnd?.({ animated: true });
    }, [messages]);

    return (
        <View style={styles.container}>
            {pinnedMessage && (
                <View testID="pinned-message">
                    <MessageBubble message={pinnedMessage} playerName={playerName} />
                </View>
            )}
            <FlatList
                ref={listRef}
                testID="message-feed"
                style={styles.feed}
                data={messages}
                keyExtractor={(message) => message.id}
                renderItem={({ item }) => (
                    <MessageBubble message={item} playerName={playerName} onShowPings={onShowPings} />
                )}
                onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: true })}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        minHeight: 0,
    },
    feed: {
        flex: 1,
        padding: 8,
    },
});

export default ChatFeed;
