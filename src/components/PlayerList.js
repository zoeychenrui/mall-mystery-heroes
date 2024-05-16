import React, { useState, useEffect } from "react";
import { ListItem, OrderedList, Flex } from '@chakra-ui/react';
import { db } from "../utils/firebase";
import { collection, onSnapshot, getDocs } from "firebase/firestore";

const PlayerList = (props) => { 
    const [playerData, setPlayerData] = useState([]);
    const roomID = props.roomID;

    useEffect(() => {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');

        // pulls player names from database
        const unsubscribe = onSnapshot(playerCollectionRef, (snapshot) => {
            const newPlayerData = [];
            snapshot.forEach(doc => {
                newPlayerData.push(doc.data().name);
            });
            setPlayerData(newPlayerData);
        });

        return () => {
            unsubscribe();
        };
    }, [playerData]); 

    // Sort Names alphabetically
    playerData.sort();
    const listOfNames = playerData.map(eachName => <ListItem key={eachName}>{eachName}</ListItem>);
    
    return (
        <div className='parent'>
            <Flex justifyContent="center">
                <div className='displayNames'>
                    <OrderedList> 
                        {listOfNames}
                    </OrderedList>
                </div>
            </Flex>
        </div>
    );
};

export default PlayerList;
