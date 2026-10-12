import React, { useContext } from 'react';
import { Image, Heading, HStack, Spacer } from '@chakra-ui/react';
import whiteLogo from '../../assets/mall-logo-white-2.png';
import PlaybookLink from './PlaybookLink';
import ResetTargetsButton from './ResetTargetsButton';
import Endgamebutton from './Endgamebutton';
import LogoutButton from './LogoutButton';
import GameBoundaryButton from '../map_components/GameBoundaryButton';
import { gameContext } from '../Contexts';

const HeaderExecution = ({ addLog, arrayOfAlivePlayers, gameBoundary }) => {
    const { roomID } = useContext(gameContext);
    return (
        <HStack justifyContent="left" p="8px" h="100%" alignItems="center">
            <Image objectFit="cover" src={whiteLogo} alt="Logo" boxSize="36px" />
            <Heading>Lobby #: {roomID}</Heading>
            <Spacer />
            <PlaybookLink />
            <GameBoundaryButton roomID={roomID} gameBoundary={gameBoundary} />
            <ResetTargetsButton arrayOfPlayers={arrayOfAlivePlayers} addLog={addLog} />
            <Endgamebutton />
            <LogoutButton />
        </HStack>
    );
};

export default HeaderExecution;
