import React, { useContext } from 'react';
import { Image, Heading, HStack, Spacer } from '@chakra-ui/react';
import whiteLogo from '../../assets/mall-logo-white-2.png';
import PlaybookLink from './PlaybookLink';
import ResetTargetsButton from './ResetTargetsButton';
import Endgamebutton from './Endgamebutton';
import LogoutButton from './LogoutButton';
import GameBoundaryButton from '../map_components/GameBoundaryButton';
import LivePlayerMapButton from '../map_components/LivePlayerMapButton';
import { gameContext } from '../Contexts';

const HeaderExecution = ({ addLog, arrayOfAlivePlayers, allPlayerNames, gameBoundary }) => {
    const { roomID } = useContext(gameContext);
    return (
        <HStack justifyContent="left" p="8px" h="100%" alignItems="center">
            <Image objectFit="cover" src={whiteLogo} alt="Logo" boxSize="36px" />
            <Heading>Lobby #: {roomID}</Heading>
            <Spacer />
            <PlaybookLink />
            <GameBoundaryButton roomID={roomID} gameBoundary={gameBoundary} />
            <LivePlayerMapButton
                roomID={roomID}
                // The FULL roster, not arrayOfAlivePlayers (alive-only by
                // construction) — an eliminated player's status doc can
                // still briefly carry a stale label-worthy entry, and the
                // GM's live map must resolve their real name rather than
                // falling back to the raw normalized id
                // (LivePlayerMapButton itself does no filtering; it
                // resolves labels against whatever `players` it's given).
                players={allPlayerNames.map((name) => ({ name }))}
                boundaryVertices={gameBoundary?.vertices ?? null}
            />
            <ResetTargetsButton arrayOfPlayers={arrayOfAlivePlayers} addLog={addLog} />
            <Endgamebutton />
            <LogoutButton />
        </HStack>
    );
};

export default HeaderExecution;
