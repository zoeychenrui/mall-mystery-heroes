import React, { useMemo } from 'react';
import { Box, VStack, Flex } from '@chakra-ui/react';

// Presentational — GameMasterView owns the live subscription and passes
// players down, rather than this component subscribing independently
// (docs/improvements.md item 13). Two live listeners on the same query would
// double the reads for no benefit.
const PlayersList = ({ players }) => {
    // creates an array of mapped players
    const arrayOfPlayersListed = useMemo(
        () =>
            players.map((player, index) => (
                <Flex sx={styles.playerContainer} key={player.name}>
                    <Flex sx={styles.playerWrapper}>
                        <Box
                            sx={{
                                ...styles.playerNameWrapper,
                                color: player.isAlive
                                    ? player.openSeason
                                        ? '#ffcc00'
                                        : 'white'
                                    : '#b3b3b3',
                            }}
                        >
                            {index + 1}. {player.name}
                        </Box>
                        <Box
                            sx={{
                                ...styles.playerScoreWrapper,
                                color: player.isAlive
                                    ? player.openSeason
                                        ? '#ffcc00'
                                        : 'white'
                                    : '#b3b3b3',
                            }}
                        >
                            {player.score}
                        </Box>
                    </Flex>
                    <Box sx={styles.targetsWrapper}>
                        {player.targets.map((target, index) => {
                            return (
                                <Box sx={styles.targetText} key={index}>
                                    {target}
                                </Box>
                            );
                        })}
                    </Box>
                </Flex>
            )),
        [players]
    );

    return (
        <Flex sx={styles.flexWrapper}>
            <VStack sx={styles.vStackContainer}>{arrayOfPlayersListed}</VStack>
        </Flex>
    );
};

export default PlayersList;

const styles = {
    vStackContainer: {
        justifyContent: 'flex-start',
        alignItems: 'center',
        width: '100%',
    },
    playerContainer: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
    },
    targetsWrapper: {
        alignItems: 'center',
        width: '70%',
        justifyContent: 'center',
        overflowX: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
    },
    targetText: {
        fontSize: '18px',
        margin: '1px',
        color: '#ff5050',
    },
    flexWrapper: {
        background: 'transparent',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        overflow: 'auto',
        height: '91%',
    },
    playerWrapper: {
        display: 'flex',
        flexDirection: 'row',
        width: '86%',
        margin: '4px',
        alignItems: 'center',
    },
    playerNameWrapper: {
        flex: 1,
        fontSize: '20px',
        overflowX: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
    },
    playerScoreWrapper: {
        display: 'flex',
        flex: 0,
        justifyContent: 'flex-end',
        fontSize: '22',
        fontWeight: 'bold',
    },
};
