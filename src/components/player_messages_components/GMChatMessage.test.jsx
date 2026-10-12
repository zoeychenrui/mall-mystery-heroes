/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * GMChatMessage renders one player chat message for the GM console's
 * read-only chat panel — extracted from GMChatPanel.js and wrapped in
 * React.memo so unchanged messages skip re-rendering when new ones arrive
 * (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
 * No onSnapshot mocking needed — this component doesn't subscribe to
 * anything, it just renders whatever message prop it's given.
 */
import React from 'react';
import { ChakraProvider, List } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import GMChatMessage from './GMChatMessage';
import { formatMessageTime } from '../../utils/formatMessageTime';

const mountMessage = (message) =>
    render(
        <ChakraProvider>
            <List>
                <GMChatMessage message={message} />
            </List>
        </ChakraProvider>
    );

describe('GMChatMessage', () => {
    it('shows a chat message with its sender', () => {
        mountMessage({
            type: 'chat',
            recipient: null,
            text: 'lol where are you',
            sender: 'Bob',
            timestamp: null,
        });

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it('shows a formatted time on a message with a resolved timestamp', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };
        mountMessage({
            type: 'chat',
            recipient: null,
            text: 'hi',
            sender: 'Bob',
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows no time text for a message with a pending (null) timestamp', () => {
        mountMessage({
            type: 'chat',
            recipient: null,
            text: 'sending this now',
            sender: 'Bob',
            timestamp: null,
        });

        expect(screen.getByText('sending this now')).toBeInTheDocument();
        expect(screen.queryByText(/^\d{1,2}:\d{2}/)).not.toBeInTheDocument();
    });
});
