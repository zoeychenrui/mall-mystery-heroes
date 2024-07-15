import React from 'react';
import { Flex } from '@chakra-ui/react';
import { query, 
         updateDoc,
         where,
         getDocs,
         collection
    } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { Button } from '@chakra-ui/react';
import { fetchAssassinsForPlayer, fetchTargetsForPlayer, updateAssassinsForPlayer, updateTaregtsForPlayer } from './dbCalls';
import CreateAlert from './CreateAlert';

const RegenerateTargets = (props) => {
    const arrayOfAlivePlayers = props.arrayOfAlivePlayers;
    const roomID = props.roomID;
    const handleRemapping = props.handleRemapping;
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const createAlert = CreateAlert();
    
    //randomizes order of array
    const randomizeArray = (array) => {
        for (let i = 0; i < array.length; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }


    const handleRegeneration = async () => {
        let playersNeedingTarget = [];
        const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned
        
        //loops through all alive players to find players needing more targets
        for (const player of arrayOfAlivePlayers) {
            const playerTargetRef = await fetchTargetsForPlayer(player, roomID);
            //adds player to playersNeedingTarget if player does not have enough targets
            if (playerTargetRef.length < MAXTARGETS) {
                playersNeedingTarget = [...playersNeedingTarget, player];
            }
        }
        console.log(`playersNeedingTarget: ${playersNeedingTarget}`);

        //updates targets for players that need to update targets
        for (const player of playersNeedingTarget) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            
            //finds player in db and retrieves targets
            const playerDoc = await fetchPlayerForRoom(player, roomID, createAlert);
            const playerData = playerDoc.data();
            let newTargetArray = [...playerData.targets];
            
            //finds possible targets for player
            for (const possibleTarget of randomizedAlivePlayers) {
                const possibleTargetDoc = await fetchPlayerForRoom(possibleTarget, roomID, createAlert);
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
                    await updateAssassinsForPlayer(possibleTarget, [...playerData.assassins, player], createAlert, roomID);
                    await handleRemapping('New target for ' + player + ': ' + possibleTarget);
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
                    await updateAssassinsForPlayer(possibleTarget, [...playerData.assassins, player], createAlert, roomID);
                    await handleRemapping('New target for ' + player + ': ' + possibleTarget);
                    console.log(`Assassins updated for ${possibleTarget} in database (loop2): ${possibleTargetData.assassins}`);

                    //breaks loop if player has max targets
                    if (newTargetArray.length >= MAXTARGETS) {
                        break;
                    }
                }
            }
            await updateTaregtsForPlayer(player, newTargetArray, createAlert, roomID);;
            console.log(`Targets updated for ${player} in database: ${newTargetArray}`);
        }

        let playersNeedingAssassins = [];

        //loops through all alive players to find players needing more assassins
        for (const player of arrayOfAlivePlayers) {
            const playerAssassinRef = await fetchAssassinsForPlayer(player, createAlert, roomID);
            if (playerAssassinRef.length < MAXTARGETS) {
                playersNeedingAssassins = [...playersNeedingAssassins, player];
            }
        }
        console.log(`playersNeedingAssassins: ${playersNeedingAssassins}`);

        for (const player of playersNeedingAssassins) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            
            //finds player in db and retrieves assassins
            const playerDoc = await fetchPlayerForRoom(player, roomID, createAlert);
            const playerData = playerDoc.data();
            let newAssassinArray = [...playerData.assassins];

            //finds possible assassins for player
            for (const possibleAssassin of randomizedAlivePlayers) {
                const possibleAssassinDoc = await fetchPlayerForRoom(possibleAssassin, roomID, createAlert);
                const possibleAssassinData = possibleAssassinDoc.data();

                if ( possibleAssassinData.targets.length < MAXTARGETS + 1 && //checks if possible assassin has max targets + 1
                     !possibleAssassinData.targets.includes(player) && //checks if possible assassin is targeting player
                     !newAssassinArray.includes(possibleAssassin) && //checks if player is already targeting possible target
                     possibleAssassin !== player && //checks if target is the same as player
                     newAssassinArray.length < MAXTARGETS //checks if player has max assassins
                ) {
                    //adds possible target to targets
                    newAssassinArray.push(possibleAssassin);

                    //updates assassin's targets in db
                    await updateTaregtsForPlayer(possibleAssassin, [...playerData.targets, player], createAlert, roomID);
                    await handleRemapping('New target for ' + possibleAssassin + ': ' + player);

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

    return (  
        <Flex>
            <Button 
                onClick = {handleRegeneration}
                lm = '5px'
                size= 'lg'
                color = 'teal'
                variant = 'solid'
            >
                Regenerate Targets
            </Button>
            
        </Flex>
    );
}
 
export default RegenerateTargets;