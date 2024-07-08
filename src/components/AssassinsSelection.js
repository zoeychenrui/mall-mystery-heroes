import React, { useState } from 'react';
import { Box, Select } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { query, getDocs, collection, where } from "firebase/firestore";

const AssassinSelection = (props) => {
    const { roomID, getAssassinPlayerName, arrayOfAlivePlayers, getPossibleTargets } = props;
    const [selectedAssassin, setSelectedAssassin] = useState('');

    const handleChange = async (event) => {
        const newAssassin = event.target.value;
        setSelectedAssassin(newAssassin);

        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', newAssassin));

        try {
            const querySnapshot = await getDocs(playerQuery);
            if (querySnapshot.empty) {
                console.error("No documents found for the Assassin");
                return;
            }
            getAssassinPlayerName(newAssassin);
            const targetList = querySnapshot.docs[0].data().targets;
            getPossibleTargets(targetList);
        } catch (error) {
            console.error('Error fetching player documents:', error);
        }
    };

    return (
        <Box>
            <Select 
                id='assassin'
                placeholder='Select Assassin'
                value={selectedAssassin}
                onChange={handleChange}
            >
                {arrayOfAlivePlayers.map((player, index) => (
                    <option key={index} value={player}>
                        {player}
                    </option>
                ))}
            </Select>
        </Box>
    );
};

export default AssassinSelection;