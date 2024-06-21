import React, { useState } from 'react';
import AssassinSelection from './AssassinsSelection';
import KillButton from './KillButton';

const Execution = ({ roomID, arrayOfAlivePlayers, handleKillPlayer }) => {
    const [assassinPlayerNamed, setAssassinPlayerNamed] = useState('');

    const getAssassinPlayerName = (assassinName) => {
        setAssassinPlayerNamed(assassinName);
    };

    return (
        <div>
            <AssassinSelection
                roomID={roomID}
                getAssassinPlayerName={getAssassinPlayerName}
                arrayOfAlivePlayers={arrayOfAlivePlayers}
            />
            <KillButton
                roomID={roomID}
                assassinPlayerNamed={assassinPlayerNamed}
                handleKillPlayer={handleKillPlayer}
            />
        </div>
    );
};

export default Execution;
