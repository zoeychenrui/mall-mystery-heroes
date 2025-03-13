import React, { useState, useEffect, useContext, useMemo } from 'react';
import {
    Box,
    VStack,
    Flex,
} from '@chakra-ui/react';
import { onSnapshot } from "firebase/firestore";
import { fetchPlayersQueryByDescendPointsThenIsAliveForRoom } from '../firebase_calls/dbCalls';
import { gameContext } from '../Contexts';

const PlayersList = () => {
    const { roomID } = useContext(gameContext);   
    const playersQuery = fetchPlayersQueryByDescendPointsThenIsAliveForRoom(roomID);
    const [players, setPlayers] = useState([]);

    // When the component mounts, subscribe to the query and update the state whenever it changes
    useEffect(() => {

        // subscribe to changes in the query results
        const unsubscribe = onSnapshot(playersQuery, (snapshot) => {

            // Get the updated list of players from the snapshot
            const updatedPlayers = snapshot.docs.map((doc) => ({
                name: doc.data().name,
                score: doc.data().score,
                targets: doc.data().targets,
                openSeason: doc.data().openSeason,
                isAlive: doc.data().isAlive
            }));
            // Update the state with the new values
            setPlayers(updatedPlayers);
        });

        // Clean up the subscription when the component unmounts
        return () => unsubscribe();
        // disabled next line because playerAlivePlayersQuery should not be in dependency array
        // eslint-disable-next-line
    }, []);

    // creates an array of mapped players 
    const arrayOfPlayersListed = useMemo(() => (
        players.map((player, index) => (
            <Flex sx = {styles.playerContainer}>
                <Flex sx = {styles.playerWrapper}>
                    <Box 
                        sx = {{ 
                            ...styles.playerNameWrapper,
                            color : player.isAlive ? (player.openSeason ? '#ffcc00' : 'white')
                            : '#b3b3b3'
                        }}
                    >
                        {index + 1}. {player.name}
                    </Box>
                    <Box 
                        sx = {{
                            ...styles.playerScoreWrapper,
                            color : player.isAlive ? (player.openSeason ? '#ffcc00' : 'white')
                            : '#b3b3b3'
                        }}
                    >
                        {player.score}
                    </Box>
                </Flex>
                <Box sx = {styles.targetsWrapper}>
                    {player.targets.map((target, index) => {
                        return (
                            <Box sx = {styles.targetText} key = {index}>
                                {target}
                            </Box>
                        )
                    })}
                </Box>
            </Flex>        
        ))
    ), [players]);

    return (
        <Flex sx = {styles.flexWrapper}>
            <VStack sx = {styles.vStackContainer}>
                {arrayOfPlayersListed}
            </VStack>
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
        flexDirection: 'column'
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
        color: '#ff5050'
    },
    flexWrapper: {
        background: 'transparent',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        overflow: 'auto',
        height: '91%'
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
        textOverflow: 'ellipsis'
    },
    playerScoreWrapper: {
        display: 'flex',
        flex: 0,
        justifyContent: 'flex-end',
        fontSize: '22',
        fontWeight: 'bold'
    },
}