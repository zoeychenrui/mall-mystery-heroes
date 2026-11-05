import React from 'react';
import { Box, Heading, Text } from '@chakra-ui/react';

const PlayerGameStatusNotices = ({ isGameActive, gameStarted, playerData }) => (
    <>
        {isGameActive && (
            <Box boxShadow="0 2px 4px rgba(146, 142, 142, 0.22)">
                {!gameStarted && (
                    <Box mx={4} my={4} p={4} bg="whiteAlpha.100" borderRadius="xl">
                        <Text color="white">Waiting for the host to start...</Text>
                    </Box>
                )}
                {gameStarted && playerData && !playerData.isAlive && (
                    <Box textAlign="center">
                        <Heading size="md" my={2} color="red.500">
                            YOU&apos;VE BEEN ELIMINATED
                        </Heading>
                        <Text mb={4}>Be on the lookout for revival missions to get back in.</Text>
                    </Box>
                )}
            </Box>
        )}
        {!isGameActive && (
            <Box bg="red.700" color="white" borderRadius="md" p={2} mb={2} textAlign="center">
                <Text fontWeight="bold">GAME ENDED. PLEASE HEAD BACK TO THE STARTING AREA.</Text>
            </Box>
        )}
    </>
);

export default PlayerGameStatusNotices;
