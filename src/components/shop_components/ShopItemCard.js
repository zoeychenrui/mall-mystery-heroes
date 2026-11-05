import React from 'react';
import { Box, Button, Text, VStack } from '@chakra-ui/react';
// require(), not a named `import` — powerUps.js is CommonJS (module.exports)
// so a future Cloud Function can reuse it, and CRA's production build can't
// statically analyze a named ES `import` of a CommonJS file. Same reason as
// PlayerGame.js's require of gameBoundary.js.
const { RARITY_COLORS, formatSeconds } = require('../../game/powerUps');

const ShopItemCard = ({ item, secondsLeft, fractionLeft, disabledReason, onBuy, children }) => {
    const isCoolingDown = secondsLeft > 0;
    const coverDegrees = fractionLeft * 360;

    return (
        <Box
            position="relative" // lets the cover sit on top of this box
            bg={RARITY_COLORS[item.rarity]}
            color="gray.800" // the app theme is dark; these boxes are light
            borderRadius="md"
            p={3}
            overflow="hidden" // clips the cover to the rounded corners
            h="100%"
            display="flex"
            flexDirection="column"
        >
            <VStack align="stretch" spacing={1} flex="1">
                <Text fontWeight="bold">{item.name}</Text>
                <Box display="flex" justifyContent="space-between" fontSize="md">
                    <Text>{item.cost} pts</Text>
                    <Text>{formatSeconds(item.cooldownSeconds)} CD</Text>
                </Box>
                {item.description && (
                    <Text fontSize="sm" color="gray.600">
                        {item.description}
                    </Text>
                )}
                <Box h={10}>{children /* Step 3 puts the player picker here */}</Box>
            </VStack>
            <Box display="flex" flexDirection="column" justifyContent="center" mt="auto" pt={2}>
                <Button
                    aria-label={`Buy ${item.name}`}
                    isDisabled={Boolean(disabledReason)}
                    onClick={onBuy}
                    colorScheme="green"
                >
                    Buy
                </Button>
                <Box h={3} mt={1}>
                    {disabledReason && <Text fontSize="sm">{disabledReason}</Text>}
                </Box>
            </Box>

            {isCoolingDown && (
                <Box
                    position="absolute"
                    inset={0}
                    sx={{
                        background: `conic-gradient(rgba(64, 64, 64, 0.5) 0deg ${coverDegrees}deg, transparent ${coverDegrees}deg)`,
                    }}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                >
                    <Text color="white" fontSize={'2xl'} fontWeight="bold">
                        {formatSeconds(secondsLeft)}
                    </Text>
                </Box>
            )}
        </Box>
    );
};

export default ShopItemCard;
