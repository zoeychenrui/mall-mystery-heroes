import React from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, useLocation } from 'react-router-dom';
import TargetGenerator from '../components/TargetGenerator';
import DeadPlayersList from '../components/DeadPlayersList';
import { Flex, Heading} from '@chakra-ui/react';

const GameMasterView = () => {
    const { roomID } = useParams();    
    const {arrayOfPlayers} = useLocation().state || {arrayOfPlayers: []};

    return (
        <div>
            <Heading >Game Master View</Heading>
            <Flex   direction="row" 
                    justifyContent="center">
                <AlivePlayersList roomID = {roomID}/>
                <DeadPlayersList roomID = {roomID}/>
            </Flex>
            
            <TargetGenerator arrayOfPlayers={arrayOfPlayers} 
                             roomID={roomID} />    
            {roomID}         
        </div>
    );
}

export default GameMasterView;