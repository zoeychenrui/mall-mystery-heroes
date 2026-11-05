import React, { useContext, useMemo } from 'react';
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
    // Memoized by the roster's actual names, sorted — not by
    // `allPlayerNames`'s own reference, which is a fresh array every
    // GameMasterView render (even on an unrelated player-doc write, e.g.
    // a boundary location report every 5-15s) — and not by insertion
    // order, which reshuffles whenever a score changes even though the
    // roster itself didn't. Keeping this reference stable across renders
    // that don't actually add/remove/rename a player is what stops
    // LivePlayerMapButton's effect (keyed on this same `players` value)
    // from tearing down and re-subscribing its Firestore listener —
    // which re-reads every document in the collection, not just the
    // delta — on every one of those unrelated renders.
    const livePlayerMapPlayers = useMemo(
        () => allPlayerNames.map((name) => ({ name })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [[...allPlayerNames].sort().join('|')]
    );
    return (
        <HStack justifyContent="left" p="8px" h="100%" alignItems="center">
            <Image objectFit="cover" src={whiteLogo} alt="Logo" boxSize="36px" />
            <Heading fontSize="32px" fontWeight="bold" mr="32px">
                Lobby #: {roomID}
            </Heading>
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
                players={livePlayerMapPlayers}
                boundaryVertices={gameBoundary?.vertices ?? null}
            />
            <PlaybookLink />
            <Spacer />
            <ResetTargetsButton arrayOfPlayers={arrayOfAlivePlayers} addLog={addLog} />
            <Endgamebutton />
            <LogoutButton />
        </HStack>
    );
};

export default HeaderExecution;
