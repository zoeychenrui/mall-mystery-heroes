import React, { useContext } from 'react';
import { Image,
         Heading,
         HStack,   
         Spacer
    } from '@chakra-ui/react';
import whiteLogo from '../assets/mall-logo-white-2.png';
import ResetTargetsButton from './ResetTargetsButton';
import Endgamebutton from './Endgamebutton';
import { gameContext } from './Contexts';

const HeaderExecution = ({ addLog, arrayOfAlivePlayers }) => {
    const { roomID } = useContext(gameContext);
    return (  
        <HStack justifyContent = 'left'
                p = '8px'
                h = '100%'
                alignItems = 'center'
        >
            <Image objectFit = 'cover'
                   src = {whiteLogo}
                   alt = 'Logo'
                   boxSize = '36px'
            />
            <Heading>Lobby #: {roomID}</Heading>
            <Spacer />
            <ResetTargetsButton 
                arrayOfPlayers = {arrayOfAlivePlayers}
                addLog = {addLog}
            />
            <Endgamebutton />
        </HStack>
    );
}
 
export default HeaderExecution;