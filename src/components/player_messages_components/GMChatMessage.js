import React from 'react';
import { ListItem, Text } from '@chakra-ui/react';
import { formatMessageTime } from '../../utils/formatMessageTime';

// One player chat message's rendering, extracted from GMChatPanel.js and
// wrapped in React.memo so an unchanged message (same object reference,
// preserved by applyMessageChanges) is skipped entirely on re-render — the
// whole point of this split
// (docs/superpowers/specs/2026-08-14-gm-chat-panel-parity-design.md).
const GMChatMessage = ({ message }) => {
    const time = formatMessageTime(message.timestamp);

    return (
        <ListItem mb={1}>
            <Text as="span" fontWeight="bold">
                {message.sender}:
            </Text>{' '}
            <Text as="span">{message.text}</Text>
            {time && (
                <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                    {time}
                </Text>
            )}
        </ListItem>
    );
};

export default React.memo(GMChatMessage);
