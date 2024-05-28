import React, { useState, useEffect } from 'react';
import {
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    TableCaption,
    TableContainer,
    Flex,
} from '@chakra-ui/react';
import { db } from '../utils/firebase';
import {
    orderBy,
    query,
    collection,
    where,
    onSnapshot,
} from "firebase/firestore";

const DeadPlayersList = (props) => {
    const roomID = props.roomID; // Get the ID of the room that this component is displaying

    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); // This takes us to the players folder

    // Construct a query that gets all players in the room that are still alive
    const playerAlivePlayersQuery = query(
        playerCollectionRef,
        where("isAlive", "==", false),
    );

    const [players, setPlayers] = useState([]); // array of player objects

    useEffect(() => {

        const unsubscribe = onSnapshot(playerAlivePlayersQuery, (snapshot) => {

            // Get the updated list of players from the snapshot
            const updatedPlayers = snapshot.docs.map((doc) => ({
                name: doc.data().name,
            }));

            console.log("updatedPlayers: ", updatedPlayers);

            setPlayers(updatedPlayers);
        });

        return () => unsubscribe();
    }, []); 


    if (players.length === 0) {
        return null;
    }
    
    return (
        <div>
            <Flex >
            <TableContainer >
                <Table variant='simple' colorScheme='red' size='md' >
                    <TableCaption placement='top' maxW='800px' flexGrow={2}>Dead Players List</TableCaption>
                    <Thead >
                        <Tr key='header'>
                            <Th>Name</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {players.map((player, index) => (
                            <Tr key={index}>
                                <Td>{player.name}</Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            </TableContainer>
            </Flex>
        </div>
    );
};

export default DeadPlayersList;
