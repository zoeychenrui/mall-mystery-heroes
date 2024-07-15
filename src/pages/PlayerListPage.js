import React, {useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, 
         Divider, 
         Flex, 
         Heading,
         Image, 
    } from '@chakra-ui/react';
import PlayerAddition from '../components/PlayerAddition';
import PlayerList from '../components/PlayerList';
import PlayerRemove from "../components/PlayerRemove";
import { auth} from "../utils/firebase";
import { signOut } from "firebase/auth";
import CreateAlert from '../components/CreateAlert';
import mallLogo from '../assets/mall-logo-black-green.png';
import TargetGenerator from "../components/TargetGenerator";
import { fetchAllPlayersForRoom } from "../components/dbCalls";
const PlayerListPage = () => {
    const navigate = useNavigate();
    const { roomID } = useParams();
    const [arrayOfPlayers, setArrayOfPlayers] = useState([]);
    const createAlert = CreateAlert();

    const logout = async () => {
        try {
          await signOut(auth);
          console.log("User successfully logged out");
          navigate('/');
    
        } catch (err) {
          console.error(err);
        }
      };

    //fetches players when roomID or playerCollectionRef changes
    useEffect (() => {
        const fetchPlayers = async () => {
            try {
                const players = await fetchAllPlayersForRoom(roomID);
                setArrayOfPlayers(players);
            }
            catch (error) {
                console.log(error);
                createAlert('error', 'Error updating arrayOfPlayers', 'Check console.', 1500);
            }
        }
        
        if (roomID) {
            fetchPlayers();
        }
        //eslint-disable-next-line
    }, [roomID]);
     
    //logs when new player is added to array
    useEffect (() => {
        console.log(arrayOfPlayers);
    }, [arrayOfPlayers]);

    //navigates to lobby
    const handleLobbyRoom = async () => {
        //checks if arrayOfPlayers has at least two players
        if (arrayOfPlayers) {
            if (arrayOfPlayers.length <= 1) {
                return createAlert('error', 'Error', 'Not enough players (must have at least 2)', 1500);
            }
            }
        else {
            return createAlert('error', 'Error', 'arrayOfPlayers is not defined', 1500);
        }

        try {
            if (navigate) {
                navigate(`/rooms/${roomID}/GameMasterView`, {state: { arrayOfPlayers } });
            }
            else {
                return createAlert('error', 'Error', 'Navigate is not defined', 1500);
            }
        }
        catch (error) {
            console.error("Error navigating to lobby: ", error);
            createAlert('error', 'Error navigating to lobby', 'Check console.', 1500);
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
            createAlert('error', 'Error removing player', 'Check console.', 1500);
        }
    }

               
    return (
        <Flex
            h = '100vh'
            w = '100vw'
            justify = 'center'
            align = 'center'
            direction = 'row'
        >
            <Flex 
                direction = 'column'
                w = '40%'
                h = '100%'
                bg = '#66bf78'
                justify = 'center'
                align = 'center'
            >
                <Image
                    src = {mallLogo}
                    alt = 'logo'
                    w = '45%'
                    h = '40%'
                    mt = '20%'
                />
                <Heading 
                    as = "h2" 
                    size = "md"
                    mt = '10%' 
                    color = 'black'
                >
                    Lobby ID: {roomID}
                </Heading>
                <Heading
                    size = 'md'
                    mt = '6%'
                    mb = '4px'
                    color = 'black'
                >
                    Add Player
                </Heading>
                <PlayerAddition 
                    roomID = {roomID} 
                    onPlayerAdded = {handlePlayerAdded}
                />
                <TargetGenerator
                    roomID = {roomID}   
                    arrayOfPlayers = {arrayOfPlayers} 
                    handleLobbyRoom = {handleLobbyRoom}
                />
            </Flex>
            
            <Flex
                direction = 'column'
                h = '100%'
                w = '70%'
                bg = 'black'
            >
                <Flex 
                    justify = 'flex-end'
                    h = '6%'
                >
                    <Button 
                        colorScheme = 'red' 
                        m = '12px'
                        borderRadius = '2px'
                        variant = 'ghost'
                        _hover = {{ bg: 'red', color: 'white' }} 
                        onClick={logout}
                    >
                        Log Out
                    </Button> 
                </Flex>
                
                <Flex 
                    justify = 'center'
                    align = 'center'
                    mb = '1%'
                >
                    <Heading>Players ({arrayOfPlayers.length})</Heading>
                </Flex>
                <Divider />

                <Flex
                    h = '76%'
                    justify = 'center'
                    align = 'center'
                    overflow = 'hidden'
                >   
                    
                    <PlayerList 
                        arrayOfPlayers = {arrayOfPlayers}
                    /> 
                </Flex>

                <Flex
                    h = '16%'
                    align = 'center'
                    justify = 'center'
                    w = '100%'
                >
                    {arrayOfPlayers.length > 0 &&
                        <PlayerRemove 
                            roomID = {roomID} 
                            arrayOfPlayers = {arrayOfPlayers} 
                            onPlayerRemoved = {handlePlayerRemoved}
                        /> 
                    } 
                </Flex>    
            </Flex>
        </Flex>
    )
}

export default PlayerListPage;