import React, {useState} from 'react';
import {Button, 
        Flex, 
        Input,
        Alert,
        AlertIcon,
        AlertTitle,
        AlertDescription,
        CloseButton,
        Box,
        onClose
        } from '@chakra-ui/react';

import { collection, addDoc, query, where, getDocs} from "firebase/firestore"; 
import {db} from '../utils/firebase';

//adds player to database
const PlayerAddition = (props) => {
    const [showAlert, setShowAlert] = useState(false); //defines state of alert showing
    const [PlayerName, setPlayerName] = useState(''); //defines player name
    const [error, setError] = useState(''); //defines the message for error
    const roomID = props.roomID;
    
    const handleInputChange = (event) => {
        setPlayerName(event.target.value);
    };

    //closes alert message
    const onClose = () => {
        setShowAlert(false);
    }

    //handles function to add player
    const handleAddPlayer = () => {
        if (PlayerName === '') {
            setError("Input cannot be blank");
            setShowAlert(true);
            console.error("Error adding player: name cannot be blank");
            return;
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
                    const docRef = addDoc((playerRef), {
                        name: PlayerName,
                        nameLowerCase: PlayerNameLowCase,
                        isAlive: true,
                        score: 0
                    })
                    //logs player added
                    .then((docRef) => {
                        console.log("Player added with ID: ", docRef.id);
                    })
                    .catch((error) => {
                        setError("Error while adding player. Check console.");
                        setShowAlert(true);
                        console.error("Error adding player:", error);
                    });
                }
                //notifies for duplicate player
                else {
                    setError(`Cannot add duplicate player: ${PlayerName}`);
                    setShowAlert(true);
                    console.error(`Cannot add duplicate player: ${PlayerName}`);
                }
            })
            .catch((error) => {
                setError("Error while checking for player. Check console.");
                setShowAlert(true);
                console.error("Error checking for player: ", error);
            });

    }

    //handles submission
    const handleSubmit = (event) => {
        event.preventDefault();
        handleAddPlayer();
    }

    return ( 
        <div>
            {showAlert && (
            <Alert status='error'>
                <Box>
                    <AlertIcon/>
                    <AlertTitle>Error: </AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                    </Box>
                <CloseButton
                    alignSelf='flex-start'
                    position='relative'
                    right={-1}
                    top={-1}
                    onClick={onClose}
                />
            </Alert>
            )}
                
            <form onSubmit={handleSubmit}>
                <Flex padding='10px'>
                    <Input
                        placeholder = "Enter Player Name"
                        value = {PlayerName}
                        onChange = {handleInputChange}
                        size = 'lg'
                    />
                    <Button 
                        onClick={handleAddPlayer} 
                        colorScheme='blue'
                        size= 'lg'>
                    Add
                    </Button>
                </Flex> 
            </form>
        </div>
           
        

    );
};

export default PlayerAddition;