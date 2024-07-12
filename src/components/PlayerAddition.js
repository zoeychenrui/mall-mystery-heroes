import React, {useState} from 'react';
import {Box, Button, 
        Flex, 
        Image, 
        Input,
    } from '@chakra-ui/react';

import {collection, 
        addDoc, 
        query, 
        where, 
        getDocs,
    } from "firebase/firestore"; 
import {db} from '../utils/firebase';
import CreateAlert from './CreateAlert';
import enter from '../assets/enter-black.png';
import enterHovering from '../assets/enter-black-hover.png';

//adds player to database
const PlayerAddition = (props) => {
    const [PlayerName, setPlayerName] = useState(''); //defines player name
    const roomID = props.roomID;
    const onPlayerAdded = props.onPlayerAdded;
    const createAlert = CreateAlert();
    const [isHover, setIsHover] = useState(false);
    
    //setes PlayerName to input
    const handleInputChange = (event) => {
        setPlayerName(event.target.value);
    };

    //handles function to add player
    const handleAddPlayer = () => {
        if (PlayerName === '') {
            return createAlert('error', 'Error', 'name cannot be blank', 1500);
        }

        // player name becomes lowercased
        const PlayerNameLowCase = PlayerName.toLowerCase();
        //playerRef becomes a reference to the 'players' collection 
        const playerRef = collection(db, 'rooms', roomID, 'players');
        //playerQuery searches for same names
        const playerQuery = query(playerRef, where('nameLowerCase', '==', PlayerNameLowCase))
        
        //retrieves docs within playerQuery
        getDocs(playerQuery)    
            .then((querySnapshot) => {
                //adds new doc with player info
                if (querySnapshot.empty) {
                    addDoc((playerRef), {
                        name: PlayerName,
                        nameLowerCase: PlayerNameLowCase,
                        isAlive: true,
                        score: 10,
                        targets: [],
                        assassins: []
                    })
                    //logs player added
                    .then((docRef) => {
                        console.log("Player added with ID: ", docRef.id);
                    })
                    .catch((error) => {
                        console.error("Error adding player:", error);
                        return createAlert('error', 'Error', 'Error adding player. Check console.', 1500);
                    });
    
                    //onPlayerAdded callback called
                    if (onPlayerAdded) {
                        onPlayerAdded(PlayerName);
                    }
                }
                //notifies for duplicate player
                else {
                    console.error(`Cannot add duplicate player: ${PlayerName}`);
                    return createAlert('error', 'Error', `Cannot add duplicate player: ${PlayerName}`, 1500);
                }
            })
            .catch((error) => {
                console.error("Error checking for player: ", error);
                return createAlert('error', 'Error', 'Error checking for player. Check console.', 1500);
            });
            setPlayerName('');
    }

    //handles submission
    const handleSubmit = (event) => {
        event.preventDefault();
        handleAddPlayer();
    }

    return ( 
        <div> 
            <form onSubmit={handleSubmit}>
                <Flex 
                    padding='10px' 
                    w = '100%'
                >
                    <Input
                        placeholder = "Enter Player Name"
                        value = {PlayerName}
                        onChange = {handleInputChange}
                        size = 'lg'
                        borderRadius = '3xl'
                        ml = '30%'
                        borderColor = 'black'
                        borderWidth = '2px'
                        bg = '#9FF0AB'
                        _hover = {{borderColor: 'white', bg: '#9FF0AB'}}
                    />
                    <Box 
                        ml = '6px'
                    >
                        <Image 
                            src = {isHover ? enterHovering : enter}
                            onMouseEnter = {() => setIsHover(true)}
                            onMouseLeave = {() => setIsHover(false)}
                            onClick = {handleSubmit}
                            w = '30%'
                            h = '100%'
                        />
                    </Box>
                </Flex> 
            </form>
        </div>
           
        

    );
};

export default PlayerAddition;