import React, { useState } from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import LeaderboardModal from '../game_end_components/LeaderboardModal';

// The 'gameEndedLeaderboard' playerMessages type's rendering, extracted
// out of MessageBubble.js — the one message type that needs its own
// local state (the full-leaderboard modal's open/closed), unlike every
// other type MessageBubble.js renders inline.
const GameEndedLeaderboardBubble = ({ standings }) => {
    const [isOpen, setIsOpen] = useState(false);
    const topThree = (standings ?? []).slice(0, 3);

    return (
        <Box bg="gray.700" borderRadius="md" p={2}>
            <Text fontWeight="bold" mb={1}>
                Final Standings
            </Text>
            {topThree.map((player, index) => (
                <Text key={player.name} color={player.isAlive ? 'white' : 'gray.400'}>
                    {index + 1}. {player.name} — {player.score}
                    {!player.isAlive && ' (eliminated)'}
                </Text>
            ))}
            <Button size="sm" mt={2} onClick={() => setIsOpen(true)}>
                View Full Leaderboard
            </Button>
            <LeaderboardModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                standings={standings ?? []}
            />
        </Box>
    );
};

export default GameEndedLeaderboardBubble;
