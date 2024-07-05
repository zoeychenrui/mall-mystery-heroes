import { query, 
         updateDoc,
         where,
         getDocs,
         collection
    } from 'firebase/firestore';
import { db } from '../utils/firebase';

const RemapPlayers = (handleRemapping) => {

    //randomizes order of array
    const randomizeArray = (array) => {
        for (let i = 0; i < array.length; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    const handleRegeneration = async (playersNeedingTarget, playersNeedingAssassins, arrayOfAlivePlayers, roomID) => {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned

        //updates targets for players that need to update targets
        for (const player of playersNeedingTarget) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            
            //finds player in db and retrieves targets
            const playerQuery = query(playerCollectionRef, where('name', '==', player));
            const playerSnapshot = await getDocs(playerQuery);
            const playerDoc = playerSnapshot.docs[0];
            const playerData = playerDoc.data();
            let newTargetArray = [...playerData.targets];
            
            //finds possible targets for player
            for (const possibleTarget of randomizedAlivePlayers) {
                const possibleTargetQuery = query(playerCollectionRef, where('name', '==', possibleTarget));
                const possibleTargetSnapshot = await getDocs(possibleTargetQuery);
                const possibleTargetDoc = possibleTargetSnapshot.docs[0];
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
                    await updateDoc(possibleTargetDoc.ref, {
                        assassins: [...possibleTargetData.assassins, player]
                    });
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
                    await updateDoc(possibleTargetDoc.ref, {
                        assassins: [...possibleTargetData.assassins, player]
                    })
                    await handleRemapping("New target for " + player + ": " + possibleTarget);
                    
                    console.log(`Assassins updated for ${possibleTarget} in database (loop2): ${possibleTargetData.assassins}`);

                    //breaks loop if player has max targets
                    if (newTargetArray.length >= MAXTARGETS) {
                        break;
                    }
                }
            }
            await updateDoc(playerDoc.ref, {
                targets: [...newTargetArray]
            });
            console.log(`Targets updated for ${player} in database: ${newTargetArray}`);
        }

        for (const player of playersNeedingAssassins) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            
            //finds player in db and retrieves assassins
            const playerQuery = query(playerCollectionRef, where('name', '==', player));
            const playerSnapshot = await getDocs(playerQuery);
            const playerDoc = playerSnapshot.docs[0];
            const playerData = playerDoc.data();
            let newAssassinArray = [...playerData.assassins];

            //finds possible assassins for player
            for (const possibleAssassin of randomizedAlivePlayers) {
                const possibleAssassinQuery = query(playerCollectionRef, where('name', '==', possibleAssassin));
                const possibleAssassinSnapshot = await getDocs(possibleAssassinQuery);
                const possibleAssassinDoc = possibleAssassinSnapshot.docs[0];
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
                    await updateDoc(possibleAssassinDoc.ref, {
                        targets: [...possibleAssassinData.targets, player]
                    });
                    await handleRemapping("New assassin for " + possibleAssassin + ": " + player);
                    console.log(`Targets updated for ${possibleAssassin} in database (loop3): ${possibleAssassinData.targets}`);

                    //breaks loop if player has max targets
                    if (newAssassinArray.length >= MAXTARGETS) {
                        break;
                    }
                }
            }

            //updates player's assassins in db
            await updateDoc(playerDoc.ref, {
                assassins: [...newAssassinArray]
            });
            console.log(`Assassins updated for ${player} in database: ${newAssassinArray}`);
        }
    }

    return handleRegeneration;
}
 
export default RemapPlayers;