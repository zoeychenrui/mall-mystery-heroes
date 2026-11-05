import React, { useEffect, useState } from 'react';
import { Box, Button, Flex, IconButton, Text } from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import PlayerMapModal from '../map_components/PlayerMapModal';
// gameBoundary.js is CommonJS; require it to keep CRA's production webpack
// build from treating it as a named ES module.
const { GAME_BOUNDARY_CONFIG } = require('../../game/gameBoundary');

const PlayerBoundaryPanel = ({
    enabled,
    isAlive,
    permissionState,
    requestPermission,
    isApproachingExposure,
    secondsUntilExposed,
    liveBoundaryStatus,
    statusText,
    unavailableText,
    lastCheckTime,
    showUnavailableRetry,
    isMapOpen,
    onMapClose,
    boundaryVertices,
    otherPositions,
    ownPosition,
    nowMs,
    mapStatusText,
}) => {
    const [isInsideStatusDismissed, setIsInsideStatusDismissed] = useState(false);

    useEffect(() => {
        if (liveBoundaryStatus.status !== 'inside') {
            setIsInsideStatusDismissed(false);
        }
    }, [liveBoundaryStatus.status]);

    if (!enabled || isAlive === false) return null;

    return (
        <Box
            position="absolute"
            top={2}
            left={{ base: 2, md: 4 }}
            right={{ base: 2, md: 4 }}
            maxH="50%"
            overflowY="auto"
            zIndex={2}
        >
            {permissionState === 'unknown' && (
                <Box bg="blue.900" color="white" borderRadius="md" p={3} mb={2}>
                    <Text mb={2}>
                        Turn on location so we can check that you are inside the game area. The
                        moderator sees your boundary status. Other players cannot see your location
                        unless you leave the game area. Keep the game open for location updates.
                    </Text>
                    <Button size="sm" onClick={requestPermission}>
                        Enable Location
                    </Button>
                </Box>
            )}
            {permissionState === 'denied' && (
                <Box bg="orange.800" color="white" borderRadius="md" p={3} mb={2}>
                    <Text mb={2}>
                        Location permission was denied. Enable it in your browser or device
                        settings, then retry.
                    </Text>
                    <Button size="sm" onClick={requestPermission}>
                        Retry
                    </Button>
                </Box>
            )}
            {permissionState === 'unavailable' && (
                <Box bg="orange.800" color="white" borderRadius="md" p={3} mb={2}>
                    <Text>Location services are unavailable on this device.</Text>
                </Box>
            )}
            {isApproachingExposure && (
                <Box
                    bg="orange.700"
                    color="white"
                    borderRadius="md"
                    p={2}
                    mb={2}
                    textAlign="center"
                >
                    <Text fontWeight="bold">
                        Return to the game area — your location will be revealed to everyone in{' '}
                        {secondsUntilExposed}s.
                    </Text>
                </Box>
            )}
            {liveBoundaryStatus.status === 'outside' && (
                <Box bg="red.900" color="white" borderRadius="md" p={2} mb={2} textAlign="center">
                    <Text fontWeight="bold">{statusText}</Text>
                </Box>
            )}
            {liveBoundaryStatus.status !== 'outside' &&
                liveBoundaryStatus.status !== 'unavailable' &&
                !isApproachingExposure &&
                (liveBoundaryStatus.status === 'inside' ? (
                    !isInsideStatusDismissed && (
                        <Flex
                            bg="green.800"
                            borderRadius="xl"
                            boxShadow="lg"
                            p={3}
                            mb={2}
                            align="center"
                        >
                            <Text flex="1">{statusText}</Text>
                            <IconButton
                                aria-label="Dismiss location status"
                                icon={<CloseIcon />}
                                size="sm"
                                variant="ghost"
                                color="white"
                                onClick={() => setIsInsideStatusDismissed(true)}
                            />
                        </Flex>
                    )
                ) : (
                    <Text bg="green.800" borderRadius="xl" boxShadow="lg" p={3} mb={2}>
                        {statusText}
                    </Text>
                ))}
            {permissionState !== 'unknown' && liveBoundaryStatus.status === 'unavailable' && (
                <Box bg="orange.800" color="white" borderRadius="md" p={3} mb={2}>
                    <Text mb={showUnavailableRetry ? 2 : 0}>
                        Location unavailable: {unavailableText}
                        {lastCheckTime && ` Last confirmed at ${lastCheckTime}.`}
                    </Text>
                    {showUnavailableRetry && (
                        <Button size="sm" onClick={requestPermission}>
                            Retry
                        </Button>
                    )}
                </Box>
            )}
            <PlayerMapModal
                isOpen={isMapOpen}
                onClose={onMapClose}
                boundaryVertices={boundaryVertices}
                otherPositions={otherPositions}
                ownPosition={
                    ownPosition &&
                    nowMs - ownPosition.acquiredAtMs <= GAME_BOUNDARY_CONFIG.freshnessMs
                        ? ownPosition
                        : null
                }
                statusText={mapStatusText}
            />
        </Box>
    );
};

export default PlayerBoundaryPanel;
