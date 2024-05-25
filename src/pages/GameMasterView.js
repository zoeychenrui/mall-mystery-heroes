import React from 'react';
import AlivePlayersList from '../components/AlivePlayersList';
import { useParams, useNavigate } from "react-router-dom";

const Lobby = () => {
    const { roomID } = useParams();
    return (
        <div>
            <AlivePlayersList roomID = {roomID}/>
            {roomID}
        </div>
    );
}

export default Lobby;