import RemapPlayers from './RemapPlayers';
import { updateIsAliveForPlayer } from './dbCalls';

const PlayerRevive = (handleRemapping, createAlert) => {
    const handleRevivePlayer = async (player, roomID, arrayOfAlivePlayers) => {   
        if (player === '') {
            return createAlert('error', 'Error', 'Error: player undefined', 1500);
        }
        await updateIsAliveForPlayer(player, true, roomID);
        const handleRegeneration = RemapPlayers(handleRemapping, createAlert);
        await handleRegeneration(player, player, arrayOfAlivePlayers, roomID);
    }

    return handleRevivePlayer
}
 
export default PlayerRevive;