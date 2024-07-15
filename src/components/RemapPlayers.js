import { fetchPlayerForRoom, updateAssassinsForPlayer, updateTaregtsForPlayer } from './dbCalls';

const RemapPlayers = (handleRemapping, createAlert) => {

    //randomizes order of array
    const randomizeArray = (array) => {
        for (let i = 0; i < array.length; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    const handleRegeneration = async (playersNeedingTarget, playersNeedingAssassins, arrayOfAlivePlayers, roomID) => {
        const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned

        //updates targets for players that need to update targets
        for (const player of playersNeedingTarget) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            
            //finds player in db and retrieves targets
            const playerDoc = await fetchPlayerForRoom(player, roomID);
            const playerData = playerDoc.data();
            let newTargetArray = [...playerData.targets];
            
            //finds possible targets for player
            for (const possibleTarget of randomizedAlivePlayers) {
                const possibleTargetDoc = await fetchPlayerForRoom(possibleTarget, roomID);
                const possibleTargetData = possibleTargetDoc.data();
                
                if ( possibleTargetData.assassins.length < MAXTARGETS && //checks if possible target has max assassins
                     !possibleTargetData.targets.includes(player) && //checks if possible target is targeting player
                     !newTargetArray.includes(possibleTarget) && //checks if player is already targeting possible target
                     possibleTarget !== player && //checks if target is the same as player
                     newTargetArray.length < MAXTARGETS //checks if player has max targets
                ) {
                    //adds possible target to targets
                    newTargetArray.push(possibleTarget);

                    //updates target's assassins in db
                    await updateAssassinsForPlayer(possibleTarget, [...possibleTargetData.assassins, player], createAlert, roomID);
                    await handleRemapping("New target for " + player + ": " + possibleTarget);
                    console.log(`Assassins updated for ${possibleTarget} in database (loop1): ${possibleTargetData.assassins}`);

                    //breaks loop if player has max targets
                    if (newTargetArray.length >= MAXTARGETS) {
                        break;
                    }
                }
                else if ( possibleTargetData.assassins.length < MAXTARGETS + 1 && //checks if possible target has max assassins + 1
                         !possibleTargetData.targets.includes(player) && //checks if possible target is targeting player
                         !newTargetArray.includes(possibleTarget) && //checks if player is already targeting possible target
                         possibleTarget !== player && //checks if target is the same as player
                         newTargetArray.length < MAXTARGETS //checks if player has max targets
                ) {
                    newTargetArray.push(possibleTarget);
                    await updateAssassinsForPlayer(possibleTarget, [...possibleTargetData.assassins, player], createAlert, roomID);
                    await handleRemapping("New target for " + player + ": " + possibleTarget);
                    console.log(`Assassins updated for ${possibleTarget} in database (loop2): ${possibleTargetData.assassins}`);
                    //breaks loop if player has max targets
                    if (newTargetArray.length >= MAXTARGETS) {
                        break;
                    }
                }
            }
            await updateTaregtsForPlayer(player, newTargetArray, createAlert, roomID);
            console.log(`Targets updated for ${player} in database: ${newTargetArray}`);
        }

        for (const player of playersNeedingAssassins) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            
            //finds player in db and retrieves assassins
            const playerDoc = await fetchPlayerForRoom(player, roomID);
            const playerData = playerDoc.data();
            let newAssassinArray = [...playerData.assassins];

            //finds possible assassins for player
            for (const possibleAssassin of randomizedAlivePlayers) {
                const possibleAssassinDoc = await fetchPlayerForRoom(possibleAssassin, roomID);
                const possibleAssassinData = possibleAssassinDoc.data();

                if ( possibleAssassinData.targets.length < MAXTARGETS + 1 && //checks if possible assassin has max targets + 1
                     !possibleAssassinData.targets.includes(player) && //checks if possible assassin is targeting player
                     !newAssassinArray.includes(possibleAssassin) && //checks if player is already targeting possible target
                     possibleAssassin !== player &&//checks if target is the same as player
                     newAssassinArray.length < MAXTARGETS //checks if player has max assassins

                ) {
                    //adds possible target to targets
                    newAssassinArray.push(possibleAssassin);

                    //updates assassin's targets in db
                    await updateTaregtsForPlayer(possibleAssassin, [...possibleAssassinData.targets, player], createAlert, roomID);
                    await handleRemapping("New assassin for " + possibleAssassin + ": " + player);
                    console.log(`Targets updated for ${possibleAssassin} in database (loop3): ${possibleAssassinData.targets}`);

                    //breaks loop if player has max targets
                    if (newAssassinArray.length >= MAXTARGETS) {
                        break;
                    }
                }
            }

            //updates player's assassins in db
            await updateAssassinsForPlayer(player, newAssassinArray, createAlert, roomID);
            console.log(`Assassins updated for ${player} in database: ${newAssassinArray}`);
        }
    }

    return handleRegeneration;
}
 
export default RemapPlayers;