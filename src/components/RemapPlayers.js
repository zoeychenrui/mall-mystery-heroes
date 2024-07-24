import { fecthAlivePlayersByAscendAssassinsLengthForRoom, 
         fecthAlivePlayersByAscendTargetsLengthForRoom, 
         fetchPlayerForRoom, 
         updateAssassinsForPlayer, 
         updateTargetsForPlayer } from './dbCalls';

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
        const tempNewTargets = {};
        const tempNewAssassins = {};

        try {
            const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned

            //updates targets for players that need to update targets
            for (const player of playersNeedingTarget) {
                const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
                
                //finds player in db and retrieves targets
                const playerDoc = await fetchPlayerForRoom(player, roomID);
                if (playerDoc === null) {
                    return createAlert('error', 'Error', 'Target Not Found', 1500);
                }
                const playerData = playerDoc.data();
                let newTargetArray = [...playerData.targets];
                
                //finds possible targets for player
                for (const possibleTarget of randomizedAlivePlayers) {
                    const possibleTargetDoc = await fetchPlayerForRoom(possibleTarget, roomID);
                    if (possibleTargetDoc === null) {
                        return createAlert('error', 'Error', 'Target Not Found', 1500);
                    }
                    const possibleTargetData = possibleTargetDoc.data();
                    
                    if (possibleTargetData.assassins.length >= MAXTARGETS || //checks if possible target has Max assassins
                        possibleTargetData.targets.includes(player) || //checks if possible target is targeting player
                        newTargetArray.includes(possibleTarget) || //checks if player is already targeting possible target
                        possibleTarget === player || //checks if target is the same as player
                        newTargetArray.length >= MAXTARGETS //checks if player has max targets
                        ) {
                            continue;
                    }
                    //adds possible target to targets
                    newTargetArray.push(possibleTarget);

                    //updates target's assassins in db
                    await updateAssassinsForPlayer(possibleTarget, [...possibleTargetData.assassins, player], roomID);
                    await handleRemapping("New target for " + player + ": " + possibleTarget);
                    console.log(`Assassins updated for ${possibleTarget} in database (loop1): ${possibleTargetData.assassins}`);

                    //breaks loop if player has max targets
                    if (newTargetArray.length >= MAXTARGETS) {
                        console.log('breaking');
                        break;
                    }
                }

                //final case if no suitable matches were found
                if (newTargetArray.length === 0) {
                    console.error('running final case for targets');
                    try {
                        const lastCaseTargetForPlayer = await fecthAlivePlayersByAscendAssassinsLengthForRoom(roomID, player, playerData.assassins);
                        console.log(`lastCaseTargetForPlayer: `, lastCaseTargetForPlayer);
                        let index = 0;
                        for (const target of lastCaseTargetForPlayer) {
                            if (target) {
                                newTargetArray.push(target.name);
                                await updateAssassinsForPlayer(target.name, [...target.assassins, player], roomID);
                                await handleRemapping("New target for " + player + ": " + target.name);
                                index++;
                            }
                            if (index >= MAXTARGETS) {
                                break;
                            }
                        }
                    } catch (error) {
                        console.error('Error finding last case target: ', error);
                    }
                }
                const newTargetsForPlayer = newTargetArray.filter(target => !playerData.targets.includes(target));
                tempNewTargets[player] = newTargetsForPlayer;
                await updateTargetsForPlayer(player, newTargetArray, roomID);
                console.log(`Targets updated for ${player} in database: ${newTargetArray}`);
            }

            for (const player of playersNeedingAssassins) {
                const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
                
                //finds player in db and retrieves assassins
                const playerDoc = await fetchPlayerForRoom(player, roomID);
                if (playerDoc === null) {
                    return createAlert('error', 'Error', 'Target Not Found', 1500);
                }
                const playerData = playerDoc.data();
                let newAssassinArray = [...playerData.assassins];

                //finds possible assassins for player
                for (const possibleAssassin of randomizedAlivePlayers) {
                    const possibleAssassinDoc = await fetchPlayerForRoom(possibleAssassin, roomID);
                    if (possibleAssassinDoc === null) {
                        return createAlert('error', 'Error', 'Target Not Found', 1500);
                    }
                    const possibleAssassinData = possibleAssassinDoc.data();

                    if (possibleAssassinData.targets.length >= MAXTARGETS || //checks if possible target has Max targets
                        possibleAssassinData.assassins.includes(player) || //checks if possible target is targeting player
                        newAssassinArray.includes(possibleAssassin) || //checks if player is already targeting possible target
                        possibleAssassin === player || //checks if target is the same as player
                        newAssassinArray.length >= MAXTARGETS //checks if player has max targets
                        ) {
                            continue;
                    }

                    //adds possible target to targets
                    newAssassinArray.push(possibleAssassin);

                    //updates target's targets in db
                    await updateTargetsForPlayer(possibleAssassin, [...possibleAssassinData.targets, player], roomID);
                    await handleRemapping("New target for " + player + ": " + possibleAssassin);
                    console.log(`Targets updated for ${possibleAssassin} in database (loop2): ${possibleAssassinData.targets}`);

                    //breaks loop if player has max targets
                    if (newAssassinArray.length >= MAXTARGETS) {
                        console.log('breaking');
                        break;
                    }
                }

                //final case if no suitable matches were found
                if (newAssassinArray.length === 0) {
                    console.error('running final case for assassins');
                    try {
                        const lastCaseAssassinForPlayer = await fecthAlivePlayersByAscendTargetsLengthForRoom(roomID, player, playerData.targets);
                        console.log(`lastCaseAssassinForPlayer: `, lastCaseAssassinForPlayer);
                        let index = 0;
                        for (const possibleLastCaseAssassin of lastCaseAssassinForPlayer) {
                            if (possibleLastCaseAssassin) {
                                newAssassinArray.push(possibleLastCaseAssassin.name);
                                await updateTargetsForPlayer(possibleLastCaseAssassin.name, [...possibleLastCaseAssassin.targets, player], roomID);
                                await handleRemapping("New target for " + possibleLastCaseAssassin.name + ": " + player);
                                index++
                            }
                            if (index >= MAXTARGETS) {
                                break;
                            }
                        }
                    } catch (error) {
                        console.error('Error finding last case target: ', error);
                    }
                }
                const newAssassinsForPlayer = newAssassinArray.filter(assassin => !playerData.assassins.includes(assassin));
                tempNewAssassins[player] = newAssassinsForPlayer;

                //updates player's assassins in db
                await updateAssassinsForPlayer(player, newAssassinArray, roomID);
                console.log(`Assassins updated for ${player} in database: ${newAssassinArray}`);
            }
            return [tempNewTargets, tempNewAssassins];
        } catch(error) {
            console.error("Error regenerating targets: ", error);
            createAlert('error', 'Error Regenerating Targets', 'Check console', 1500);
        }
    }

    return handleRegeneration;
}
 
export default RemapPlayers;