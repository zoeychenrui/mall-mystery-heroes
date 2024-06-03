import React from 'react';
import { useState, useEffect } from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, 
         useLocation } from 'react-router-dom';
import TargetGenerator from '../components/TargetGenerator';
import DeadPlayersList from '../components/DeadPlayersList';
import { Flex, 
         Heading,} from '@chakra-ui/react';
import KillButton from '../components/KillButton';
import AssasinsSelection from '../components/AssasinsSelection';
import PlayerRevive from '../components/PlayerRevive';
import { db } from '../utils/firebase';
import { collection,
         getDocs,
         query
        } from "firebase/firestore";

const GameMasterView = () => {
    const { roomID } = useParams();    
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const [killedPlayerNamed, setKilledPlayerNamed] = useState('');
    const [killedPlayerPointed, setKilledPlayerPointed] = useState(0);
    const [triggerAS, setTriggerAS] = useState(false);
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players'); //reference to players subcollection
    const [arrayOfDeadPlayers, setArrayOfDeadPlayers] = useState([]);

    useEffect (() => {
        const fetchPlayers = async () => {
            try {
                const playerQuery = query(playerCollectionRef);
                const playerSnapshot = await getDocs(playerQuery);
                const players = playerSnapshot.docs
                                    .filter(doc => doc.data().isAlive === false)
                                    .map(doc => doc.data().name);
                setArrayOfDeadPlayers(players);
                console.log(arrayOfDeadPlayers.length);
            }
            catch (error) {
                console.error("Error updating arrayOfPlayers: ", error);
            }
        }
        
        if (roomID) {
            fetchPlayers();
        }
        //eslint-disable-next-line
    }, [roomID]);

    const handleKillPlayer = (killedPlayerName, setAS) => {
        setKilledPlayerNamed(killedPlayerName); // sets the name of the player to be killed 
        setTriggerAS(true);
        setArrayOfDeadPlayers(arrayOfDeadPlayers => [...arrayOfDeadPlayers, killedPlayerName]);
    };

    const handleKillPlayerPoints = (killedPlayerPoints) => {
        setKilledPlayerPointed(killedPlayerPoints);
    };

    const handlePlayerRevive = (revivedPlayerName) => {
        setArrayOfDeadPlayers(arrayOfDeadPlayers.filter((name) => name !== revivedPlayerName));
    };

    return (
        <div>
            <Heading>Game Master View</Heading>
            <TargetGenerator 
                arrayOfPlayers={arrayOfPlayers} 
                roomID={roomID} 
            />
            <Flex direction="row" justifyContent="center" gap='20'>
                <AlivePlayersList roomID={roomID} />
                <DeadPlayersList roomID={roomID} />
            </Flex>
            <KillButton 
                arrayOfPlayers={arrayOfPlayers}
                roomID={roomID}
                onPlayerKilled={handleKillPlayer}
                killedPlayerPoints={handleKillPlayerPoints}
            />
            <AssasinsSelection  
                roomID={roomID}
                arrayOfPlayers={arrayOfPlayers} 
                killedPlayerPoints={killedPlayerPointed}
                killedPlayerNamed={killedPlayerNamed}
                triggerAS={triggerAS}
                setTriggerAS={setTriggerAS} // Pass the setter function as a prop
            />         
            <PlayerRevive 
                roomID = {roomID}
                onPlayerRevived = {handlePlayerRevive}
                arrayOfDeadPlayers = {arrayOfDeadPlayers}
            />
        </div>
    );
}

export default GameMasterView;
