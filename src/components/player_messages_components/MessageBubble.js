import React from 'react';
import { Box, Button, Flex, Image, List, ListItem, Text } from '@chakra-ui/react';
import { normalizePlayerName } from '../../game/playerNames';
import { formatMessageTime } from '../../utils/formatMessageTime';
import GameEndedLeaderboardBubble from './GameEndedLeaderboardBubble';

// One message's rendering, extracted from MessageFeed.js and wrapped in
// React.memo so an unchanged message (same object reference, preserved by
// applyMessageChanges) is skipped entirely on re-render — the whole point
// of this split
// (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
// "3:42 PM" for when a ping's position was captured.
const captureTime = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const MessageBubble = ({ message, playerName, onShowPings }) => {
    const mission = message.mission ?? {};
    // Only 'chat' messages have a sender to compare — every other type
    // (whisper/broadcast/leaderboard/mission) is GM-authored and has no
    // sender field at all, so this guards normalizePlayerName from being
    // called on null/undefined for those
    // (docs/superpowers/specs/2026-08-12-chat-message-bubbles-design.md).
    const isMine =
        message.sender != null &&
        normalizePlayerName(message.sender) === normalizePlayerName(playerName);
    const time = formatMessageTime(message.timestamp);

    return (
        <ListItem mb={2}>
            {message.type === 'leaderboard' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        Leaderboard
                    </Text>
                    {time && (
                        <Text fontSize="xs" color="gray.400" mb={1}>
                            {time}
                        </Text>
                    )}
                    <List styleType="none">
                        {(message.standings ?? []).map((entry) => (
                            <ListItem key={entry.name}>
                                {entry.name}: {entry.score}
                                {!entry.isAlive ? ' (eliminated)' : ''}
                            </ListItem>
                        ))}
                    </List>
                </Box>
            ) : message.type === 'mission' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        New Mission!
                    </Text>
                    <Text fontWeight="semibold">{mission.title}</Text>
                    <Text mb={1}>{mission.description}</Text>
                    <Text fontSize="sm" color="gray.400">
                        {mission.taskType} · {mission.pointValue} points ·{' '}
                        {mission.maxCompletions
                            ? `Limited to ${mission.maxCompletions} players`
                            : 'Unlimited players'}
                    </Text>
                    {time && (
                        <Text fontSize="xs" color="gray.400">
                            {time}
                        </Text>
                    )}
                </Box>
            ) : message.type === 'gameEndedLeaderboard' ? (
                <GameEndedLeaderboardBubble standings={message.standings} />
            ) : message.type === 'killPhoto' ? (
                <Box bg="gray.700" borderRadius="md" p={2}>
                    <Text fontWeight="bold" mb={1}>
                        {message.assassin}
                    </Text>
                    <Image
                        src={message.photoUrl}
                        alt="Kill photo submission"
                        borderRadius="md"
                        maxH="200px"
                    />
                    {time && (
                        <Text fontSize="xs" color="gray.400" mt={1}>
                            {time}
                        </Text>
                    )}
                </Box>
            ) : message.type === 'powerUpPing' ? (
                // A ping bought from the power-ups shop
                // (functions/callableFunctions/purchasePowerUp.js): a snapshot
                // of where each pinged player was at that moment, from the GPS
                // system's boundaryStatuses. Global pings name who was pinged,
                // never the buyer; personal pings reach only the buyer
                // (recipient-filtered in MessageFeed.js).
                <Box
                    bg="orange.900"
                    border="1px solid"
                    borderColor="orange.400"
                    borderRadius="md"
                    p={2}
                    display="inline-block"
                >
                    <Text as="span" fontWeight="bold" color="orange.300">
                        Ping
                    </Text>{' '}
                    <Text as="span">{message.text}</Text>
                    {time && (
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                    {(message.pings ?? []).map((ping) => (
                        <Text key={ping.name} fontSize="sm" color="gray.300">
                            {ping.name}:{' '}
                            {ping.lat == null
                                ? 'no location'
                                : `located at ${captureTime(ping.capturedAtMs)}${
                                      ping.isStale ? ' (old)' : ''
                                  }`}
                        </Text>
                    ))}
                    {onShowPings && (message.pings ?? []).some((ping) => ping.lat != null) && (
                        <Button
                            size="xs"
                            mt={1}
                            colorScheme="orange"
                            onClick={() => onShowPings(message.pings)}
                        >
                            View on map
                        </Button>
                    )}
                </Box>
            ) : message.type === 'whisper' || message.type === 'broadcast' ? (
                <Box
                    bg={message.type === 'whisper' ? 'whiteAlpha.100' : 'purple.900'}
                    border={message.type === 'whisper' ? '1px dashed' : '1px solid'}
                    borderColor={message.type === 'whisper' ? 'gray.400' : 'purple.400'}
                    borderRadius="md"
                    p={2}
                    display="inline-block"
                >
                    <Text as="span" fontWeight="bold" color="yellow.300">
                        GM:
                    </Text>{' '}
                    <Text as="span">{message.text}</Text>
                    {time && (
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                </Box>
            ) : message.type === 'chat' ? (
                <Flex
                    justifyContent={isMine ? 'flex-end' : 'flex-start'}
                    data-testid="chat-message"
                >
                    <Box
                        bg={isMine ? 'teal.700' : 'blue.900'}
                        borderRadius="md"
                        p={2}
                        maxWidth="75%"
                    >
                        {!isMine && (
                            <>
                                <Text as="span" fontWeight="bold">
                                    {message.sender}:
                                </Text>{' '}
                            </>
                        )}
                        <Text as="span">{message.text}</Text>
                        {time && (
                            <Text fontSize="xs" color="gray.400" mt={1}>
                                {time}
                            </Text>
                        )}
                    </Box>
                </Flex>
            ) : (
                // Reached by 'killResult', and by the power-up notices
                // 'horcruxSaved' (killPlayer.js) and 'powerUpNotice'
                // (purchasePowerUp.js) — 'whisper'/'broadcast' have their
                // own GM-labeled branch above.
                <Text bg="gray.700" borderRadius="md" p={2} display="inline-block">
                    <Text as="span">{message.text}</Text>
                    {time && (
                        // Inline, not block like the other branches' timestamp
                        // lines — this branch's outer element is a <Text>
                        // (renders <p>), and a block <Text> here would nest
                        // <p> in <p>.
                        <Text as="span" fontSize="xs" color="gray.400" ml={2}>
                            {time}
                        </Text>
                    )}
                </Text>
            )}
        </ListItem>
    );
};

export default React.memo(MessageBubble);
