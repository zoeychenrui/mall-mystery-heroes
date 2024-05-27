import React from 'react';
import { useState } from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, useLocation } from 'react-router-dom';
import TargetGenerator from '../components/TargetGenerator';
import DeadPlayersList from '../components/DeadPlayersList';
import { Flex, Heading } from '@chakra-ui/react';
import KillButton from '../components/KillButton';
import AssasinsSelection from '../components/AssasinsSelection';

const GameMasterView = () => {
    const { roomID } = useParams();    
    const { arrayOfPlayers } = useLocation().state || { arrayOfPlayers: [] };
    const [killedPlayerNamed, setKilledPlayerNamed] = useState('');
    const [killedPlayerPointed, setKilledPlayerPointed] = useState(0);
    const [triggerAS, setTriggerAS] = useState(false);

    const handleKillPlayer = (killedPlayerName, setAS) => {
        setKilledPlayerNamed(killedPlayerName); // sets the name of the player to be killed 
        setTriggerAS(true);
    };

    const handleKillPlayerPoints = (killedPlayerPoints) => {
        setKilledPlayerPointed(killedPlayerPoints);
    };

    return (
        <div>
            <Heading>Game Master View</Heading>
            <Flex direction="row" justifyContent="center">
                <AlivePlayersList roomID={roomID} />
                <DeadPlayersList roomID={roomID} />
            </Flex>
            <KillButton 
                arrayOfPlayers={arrayOfPlayers}
                roomID={roomID}
                onPlayerKilled={handleKillPlayer}
                killedPlayerPoints={handleKillPlayerPoints}
            />
            <TargetGenerator 
                arrayOfPlayers={arrayOfPlayers} 
                roomID={roomID} 
            />
            <AssasinsSelection  
                roomID={roomID}
                arrayOfPlayers={arrayOfPlayers} 
                killedPlayerPoints={killedPlayerPointed}
                killedPlayerNamed={killedPlayerNamed}
                triggerAS={triggerAS}
                setTriggerAS={setTriggerAS} // Pass the setter function as a prop
            />         
        </div>
    );
}

export default GameMasterView;
