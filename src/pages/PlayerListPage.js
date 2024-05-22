import React, {useEffect, useState} from "react";
import { useParams } from "react-router-dom";
import { Flex, Heading } from '@chakra-ui/react';
import PlayerAddition from '../components/PlayerAddition';
import PlayerList from '../components/PlayerList';
import PlayerRemove from "../components/PlayerRemove";
import TargetGeneratorTest from "../components/TargetGeneratorTest";

const PlayerListPage = () => {
    const { roomID } = useParams();
    // Fetches arrayOfPlayers from local storage if it exists. Otherwise [].
    const [arrayOfPlayers, setArrayOfPlayers] = useState(() => {
        const storedPlayers = localStorage.getItem('arrayOfPlayers');
        return storedPlayers ? JSON.parse(storedPlayers) : [];
    });    
    //updates local storage when arrayOfPlayers is affected. Prevents refresh resetting.
    useEffect(() => {
        localStorage.setItem('arrayOfPlayers', JSON.stringify(arrayOfPlayers));
    }, [arrayOfPlayers]);
    //refreshes arrayOfPlayers when new room is entered
    useEffect(() => {
        if (localStorage.getItem('arrayOfPlayers') !== null) {
            localStorage.removeItem('arrayOfPlayers');
        }    
    }, [roomID])

    //adds new player to arrayOfPlayers
    const handleNewPlayerAdded = (newPlayerName) => {
        setArrayOfPlayers(prevPlayers => [...prevPlayers, newPlayerName]);
        console.log(`${newPlayerName} added to arrayOfPlayers`);
    }
    //removes player from arrayOfPLayers
    const handleRemovePlayer = (PlayerName) => {
        try {
            let dex = arrayOfPlayers.indexOf(PlayerName);
            let spliced = arrayOfPlayers.slice();
            spliced.splice(dex, 1);
            setArrayOfPlayers(spliced);
        }
        catch(error) {
            console.error("Error removing player from array: ", error);
        }
    }
     
    //logs when new player is added to array
    useEffect (() => {
        console.log(arrayOfPlayers);
    }, [arrayOfPlayers]);

    return (
        <Flex>
        <Heading as="h2" size="xl" mb={4}>
            Room ID: {roomID}
        </Heading>
        <PlayerAddition roomID = {roomID}
                        onPlayerAdded = {handleNewPlayerAdded}
        />
        <PlayerList arrayOfPlayers = {arrayOfPlayers}/>        
        <PlayerRemove roomID = {roomID} 
                      onPlayerRemoved = {handleRemovePlayer}
                      arrayOfPlayers = {arrayOfPlayers}/>
        <TargetGeneratorTest>Generate Targets! (tester)</TargetGeneratorTest>
        </Flex>
    )
}

export default PlayerListPage;