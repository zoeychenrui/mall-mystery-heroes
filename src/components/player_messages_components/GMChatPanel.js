import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, List } from '@chakra-ui/react';
import { onSnapshot } from 'firebase/firestore';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { applyMessageChanges } from '../../utils/applyMessageChanges';
import GMChatMessage from './GMChatMessage';

// Read-only view of the players' group chat, for the GM console — a
// separate panel from the GM's own game-event Logs (different collection,
// different purpose), so the GM isn't blind to player banter
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
//
// Merges via docChanges() rather than remapping the full snapshot.docs
// every time, so a message untouched by a given snapshot keeps its exact
// object reference — what lets GMChatMessage's React.memo skip
// re-rendering messages that haven't changed
// (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
const GMChatPanel = ({ roomID }) => {
    const [allMessages, setAllMessages] = useState([]);
    const chatBoxRef = useRef(null);

    useEffect(() => {
        if (!roomID) return undefined;
        setAllMessages([]);
        const messagesQuery = fetchPlayerMessagesQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                setAllMessages((previous) => applyMessageChanges(previous, snapshot.docChanges()));
            },
            (error) => {
                console.error('Error watching player chat:', error);
            }
        );
        return () => unsubscribe();
    }, [roomID]);

    // allMessages stays unfiltered — applyMessageChanges' newIndex is a
    // position in the query's full result set, so filtering before storing
    // would corrupt future merges. messages (below) is the filtered,
    // rendered view.
    const messages = useMemo(
        () => allMessages.filter((message) => message.type === 'chat'),
        [allMessages]
    );

    // Same auto-scroll pattern as MessageFeed.js and GameMasterView.js's
    // logsBoxRef.
    useEffect(() => {
        const chatBox = chatBoxRef.current;
        if (!chatBox) return;
        chatBox.scrollTop = chatBox.scrollHeight;
    }, [messages]);

    return (
        <Box flex="1" overflow="auto" p={2} ref={chatBoxRef} data-testid="gm-chat-panel">
            <List styleType="none">
                {messages.map((message) => (
                    <GMChatMessage key={message.id} message={message} />
                ))}
            </List>
        </Box>
    );
};

export default GMChatPanel;
