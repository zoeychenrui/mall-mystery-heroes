import React from 'react';
import { useParams, useLocation } from 'react-router-dom';
import TargetGenerator from '../components/TargetGenerator';

const GameMasterView = () => {
    const { roomID } = useParams();
    const {arrayOfPlayers} = useLocation().state || {arrayOfPlayers: []};

    return (
        <div>
            <TargetGenerator arrayOfPlayers={arrayOfPlayers} 
                             roomID={roomID} 
            />                
        </div>
    );
}

export default GameMasterView;