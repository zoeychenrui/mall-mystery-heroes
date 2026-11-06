import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as callables from '../../firebase/callables';

// RN port of src/components/player_messages_components/MessageComposer.js
// — text-sending logic only. The camera button (kill-photo capture) is
// Task 10's — rendered here as a disabled placeholder so the layout
// already matches its eventual shape.
const ChatComposer = ({ roomID, playerName, onOptimisticSend, onOptimisticSendFailed }) => {
    const [text, setText] = useState('');

    // playerName can be empty when the stored session's room doesn't
    // match (GameScreen.js) — ChatFeed.js already guards its subscription
    // on the same condition; this keeps the composer from attempting a
    // chat write with sender: ''.
    const disabled = !playerName;

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        // callables.submitChatMessage writes server-side (Admin SDK), so
        // this device's own onSnapshot listener (ChatFeed.js) has no
        // local echo of its own write — it has to wait for the same real
        // round trip any other player's message would take.
        // onOptimisticSend shows the message immediately instead,
        // standing in until the real, server-confirmed copy arrives and
        // ChatFeed.js swaps it out (see GameScreen.js for where the
        // pending list lives).
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        onOptimisticSend?.({
            id: pendingId,
            type: 'chat',
            recipient: null,
            text: trimmed,
            standings: null,
            mission: null,
            sender: playerName,
            timestamp: null,
        });
        try {
            await callables.submitChatMessage({ roomId: roomID, text: trimmed });
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching ChatFeed.js's own subscription-error handling —
            // log only. The typed text is restored (not left cleared) so
            // a failed send doesn't lose the player's words with no way
            // to retry.
            console.error('Error sending chat message:', error);
            setText(trimmed);
            onOptimisticSendFailed?.(pendingId);
        }
    };

    return (
        <View style={styles.row}>
            <TextInput
                style={styles.input}
                placeholder="Type a message..."
                placeholderTextColor="#A0AEC0"
                value={text}
                onChangeText={setText}
                editable={!disabled}
                maxLength={500}
                multiline
                returnKeyType="send"
                blurOnSubmit={false}
                onSubmitEditing={handleSend}
            />
            {/* Task 10: camera button for kill-photo capture, replacing
                this disabled placeholder. */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send photo"
                accessibilityState={{ disabled: true }}
                disabled
                style={styles.cameraButtonDisabled}
            >
                <Text style={styles.cameraButtonText}>📷</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled }}
                disabled={disabled}
                style={[styles.sendButton, disabled && styles.sendButtonDisabled]}
                onPress={handleSend}
            >
                <Text style={styles.sendButtonText}>Send</Text>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        padding: 8,
        borderTopWidth: 1,
        borderTopColor: '#4A5568', // gray.600
        gap: 8,
    },
    input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 120,
        color: '#FFFFFF',
        backgroundColor: 'rgba(255, 255, 255, 0.06)', // whiteAlpha.100
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    cameraButtonDisabled: {
        width: 44,
        height: 44,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.5,
    },
    cameraButtonText: {
        fontSize: 20,
    },
    sendButton: {
        width: 48,
        height: 44,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#285E61', // teal.700
    },
    sendButtonDisabled: {
        opacity: 0.5,
    },
    sendButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
});

export default ChatComposer;
