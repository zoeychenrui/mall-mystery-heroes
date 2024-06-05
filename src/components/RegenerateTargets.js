import React from 'react';
import {Button} from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { getDocs,
         updateDoc,
         where,
         query,
         collection
       } from 'firebase/firestore';
const RegenerateTargets = (props) => {
    const arrayOfAlivePlayers = props.arrayOfAlivePlayers;
    const roomID = props.roomID;
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');

    //randomizes order of array
    const randomizeArray = (array) => {
        for (let i = 0; i < array.length - 1; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
    
    //regenerate targets for players
    const handleRegeneration = async () => {
        let playersNeedingUpdate = [];
        const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned
        
        //makes an array of players that need to be updated
        for (let i = 0; i < arrayOfAlivePlayers.length; i++) {
            const playerQuery = query(playerCollectionRef, where('name', '==', arrayOfAlivePlayers[i]));
            const snapshot = await getDocs(playerQuery);
            //checks if player is in db
            if (snapshot.empty) {
                console.error("Error finding player: ", arrayOfAlivePlayers[i]);
                return;
            }
            const playerTargetRef = snapshot.docs[0].data().targets;
            if (playerTargetRef.length < MAXTARGETS) {
                playersNeedingUpdate = [...playersNeedingUpdate, arrayOfAlivePlayers[i]];
            }
        }
        console.log("Players needing update: ", playersNeedingUpdate);

        for (const player of playersNeedingUpdate) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            const playerTargetsQuery = query(playerCollectionRef, where('name', '==', player));
            const playerTargetsSnapshot = await getDocs(playerTargetsQuery);
            const playerDoc = playerTargetsSnapshot.docs[0];
            const playerData = playerDoc.data();
            let newTargetArray = [...playerData.targets];
            console.log(`Assigning targets for ${player}`);
            
            for (const playerTarget of randomizedAlivePlayers) {
                const targetQuery = query(playerCollectionRef, where('name', '==', playerTarget));
                const targetSnapshot = await getDocs(targetQuery);
                const targetDoc = targetSnapshot.docs[0];
                const targetData = targetDoc.data();

                if (
                    targetData.assassins.length < MAXTARGETS + 1 && //checks if target has max targets
                    !targetData.targets.includes(player) && //checks if target is targeting player
                    newTargetArray.length < MAXTARGETS && //checks if player already has max targets
                    !newTargetArray.includes(playerTarget) && //checks if target is already assigned
                    !targetData.assassins.includes(player) && //checks if target is an assassin
                    playerTarget !== player
                ) { //checks if target is the same as player
                    newTargetArray.push(playerTarget);
                    console.log(`Assigned ${playerTarget} to ${player}`);
                    
                    //updates Target's assassins array
                    await updateDoc(targetDoc.ref, {
                        assassins: [...targetData.assassins, player]
                    });

                    //breaks if player has max targets
                    if (newTargetArray.length >= MAXTARGETS) {
                        console.log(`breaking for ${player} with ${newTargetArray.length} targets`);
                        break;
                    }
                }
                console.log(`Targets for ${player}: ${newTargetArray}`);
            }
            await updateDoc(playerDoc.ref, {
                targets: [...newTargetArray]
            });
        }
    }

    return (  
        <div>
            <Button onClick={handleRegeneration}>
                Regenerate Targets
            </Button>
        </div>
    );
}
 
export default RegenerateTargets;
