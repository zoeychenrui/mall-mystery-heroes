import React, { useMemo, useState } from 'react';
import {
    Box,
    VStack,
    Flex,
    Image,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
    Text,
} from '@chakra-ui/react';

// Presentational — GameMasterView owns the live subscription and passes
// players down, rather than this component subscribing independently
// (docs/improvements.md item 13). Two live listeners on the same query would
// double the reads for no benefit.
const PlayersList = ({ players }) => {
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    // creates an array of mapped players
    const arrayOfPlayersListed = useMemo(
        () =>
            players.map((player, index) => (
                <Flex sx={styles.playerContainer} key={player.name}>
                    <Flex sx={styles.playerWrapper}>
                        <Box
                            as="button"
                            type="button"
                            onClick={() => setSelectedPlayer(player)}
                            aria-label={`View ${player.name}'s photo`}
                            sx={{
                                ...styles.playerNameWrapper,
                                ...styles.playerNameButton,
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
        <>
            <Flex sx={styles.flexWrapper}>
                <VStack sx={styles.vStackContainer}>{arrayOfPlayersListed}</VStack>
            </Flex>
            <Modal
                isOpen={Boolean(selectedPlayer)}
                onClose={() => setSelectedPlayer(null)}
                isCentered
            >
                <ModalOverlay />
                <ModalContent bg="gray.800" color="white">
                    <ModalHeader>{selectedPlayer?.name}</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6} textAlign="center">
                        {selectedPlayer?.avatarUrl ? (
                            <Image
                                src={selectedPlayer.avatarUrl}
                                alt={`${selectedPlayer.name}'s photo`}
                                maxH="65vh"
                                mx="auto"
                                borderRadius="lg"
                            />
                        ) : (
                            <Text>This player has not added a photo yet.</Text>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
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
        marginLeft: '8px',
        overflowX: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
    },
    playerNameButton: {
        display: 'block',
        background: 'transparent',
        border: 0,
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        overflow: 'hidden',
        textAlign: 'left',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        _hover: { textDecoration: 'underline' },
        _focusVisible: { outline: '2px solid white', outlineOffset: '2px' },
    },
    playerScoreWrapper: {
        display: 'flex',
        flex: 0,
        justifyContent: 'flex-end',
        fontSize: '22',
        fontWeight: 'bold',
    },
};
