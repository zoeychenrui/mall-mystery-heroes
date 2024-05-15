import React, {useState} from 'react';
import {Button, Flex, Input} from '@chakra-ui/react';
import { collection, addDoc, query, where, getDocs} from "firebase/firestore"; 
import {db} from '../utils/firebase';

//adds player to database
const PlayerAddition = (props) => {
    const [PlayerName, setPlayerName] = useState('');
    const roomID = props.roomID;
    const handleInputChange = (event) => {
        setPlayerName(event.target.value);
    };

    //handles function to add player
    const handleAddPlayer = () => {
        //playerRef becomes a reference to the 'players' collection 
        const playerRef = collection(db, 'rooms', roomID, 'players');
        //playerQuery searches for same names
        const playerQuery = query(playerRef, where('name', '==', PlayerName))
        
        //retrieves docs within playerQuery
        getDocs(playerQuery)    
            .then((querySnapshot) => {
                //adds new doc with player info
                if (querySnapshot.empty) {
                    const docRef = addDoc((playerRef), {
                        name: PlayerName,
                        isAlive: true,
                        score: 0
                    })
                    //logs player added
                    .then((docRef) => {
                        console.log("Player added with ID: ", docRef.id);
                    })
                    .catch((error) => {
                        console.error("Error adding player:", error);
                    });
                }
                //notifies for duplicate player
                else {
                    console.error("Cannot add duplicate player!");
                }
            })
            .catch((error) => {
                console.error("Error checking for player: ", error);
            });

    }

    //handles submission
    const handleSubmit = (event) => {
        event.preventDefault();
        handleAddPlayer();
    }

    return ( 
        <form onSubmit={handleSubmit}>
            <Flex padding='10px'>
                <Input
                    placeholder = "Enter Player Name"
                    value = {PlayerName}
                    onChange = {handleInputChange}
                    size = 'lg'
                />

                <Button onClick={handleAddPlayer} 
                        colorScheme='blue'
                        size= 'lg'>
                    Add
                </Button>
            </Flex>            
        </form>

    );
};

export default PlayerAddition;