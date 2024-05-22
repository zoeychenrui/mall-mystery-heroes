import React, {useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, 
         Flex, 
         Heading, 
         Alert, 
         AlertIcon, 
         AlertTitle, 
         AlertDescription, 
         CloseButton, 
         Box } from '@chakra-ui/react';
import PlayerAddition from '../components/PlayerAddition';
import PlayerList from '../components/PlayerList';
import PlayerRemove from "../components/PlayerRemove";
import {collection, query, getDocs} from 'firebase/firestore';
import {db} from '../utils/firebase';

const PlayerListPage = () => {
    const navigate = useNavigate();
    const { roomID } = useParams();
    const [showAlert, setShowAlert] = useState(false); //defines state of alert showing
    const [error, setError] = useState(''); //defines the message for error
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //reference to players subcollection
    const [arrayOfPlayers, setArrayOfPlayers] = useState([]);

    //closes Alert
    const onClose = () => {
        setShowAlert(false);
    }

    //fetches players when roomID or playerCollectionRef changes
    useEffect (() => {
        const fetchPlayers = async () => {
            try {
                const playerQuery = query(playerCollectionRef);
                const playerSnapshot = await getDocs(playerQuery);
                const players = playerSnapshot.docs.map(doc => doc.data().name);
                setArrayOfPlayers(players);
            }
            catch (error) {
                console.error("Error updating arrayOfPlayers: ", error);
                setError("Error updating arrayOfPlayers: ", error);
                setShowAlert(true);
            }
        }
        
        if (roomID) {
            fetchPlayers();
        }
    
    }, [roomID]);
     
    //logs when new player is added to array
    useEffect (() => {
        console.log(arrayOfPlayers);
    }, [arrayOfPlayers]);

    //navigates to lobby
    const handleLobbyRoom = async () => {
        //checks if arrayOfPlayers has at least two players
        if (arrayOfPlayers) {
            if (arrayOfPlayers <= 1) {
                console.error("Must have at least two players");
                setError("Must have at least two players");
                setShowAlert(true);
                return;
            }
        }
        else {
            console.error("arrayOfPlayers not defined");
            setError("arrayOfPlayers not defined");
            setShowAlert(true);
        }

        try {
            if (navigate) {
                navigate(`/rooms/${roomID}/GameMasterView`);
            }
            else {
                console.error("navigate not defined");
                setError("navigate not defined");
                setShowAlert(true);
            }
        }
        catch (error) {
            console.error("Error navigating to lobby: ", error);
            setError("Error navigating to lobby: ", error);
            setShowAlert(true);
        }
    }
    //addes player to arrayOfPlayers when they are added
    const handlePlayerAdded = (PlayerName) => {
        setArrayOfPlayers(arrayOfPlayers => [...arrayOfPlayers, PlayerName]);
    }
    //removes player from arrayOfPlayers when they are removed
    const handlePlayerRemoved = (PlayerName) => {
        try {
            const index = arrayOfPlayers.indexOf(PlayerName);
            const spliced = arrayOfPlayers.slice();
            spliced.splice(index, 1);
            setArrayOfPlayers(spliced);
        }
        catch(error) {
            console.error("Error removing player: ", error);
            setError("Error removing player: ", error);
            setShowAlert(true);
        }
    }
               
    return (
        <Flex>
            {showAlert && (
                <Alert status='error'>
                    <Box>
                        <AlertIcon/>
                        <AlertTitle>Error: </AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Box>
                    <CloseButton alignSelf='flex-start'
                                 position='relative'
                                 right={-1}
                                 top={-1}
                                 onClick={onClose}/>
                </Alert>
            )}

            <Heading as="h2" size="xl" mb={4}>
                Room ID: {roomID}
            </Heading>
            <PlayerAddition roomID = {roomID} onPlayerAdded = {handlePlayerAdded}/>
            <PlayerList arrayOfPlayers = {arrayOfPlayers}/>        
            <PlayerRemove roomID = {roomID} arrayOfPlayers = {arrayOfPlayers} onPlayerRemoved = {handlePlayerRemoved}/>
            <Button colorScheme='teal' variant='outline' onClick={handleLobbyRoom}>
                Begin Game
            </Button>
        </Flex>
    )
}

export default PlayerListPage;