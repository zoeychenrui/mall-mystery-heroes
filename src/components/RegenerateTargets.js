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
        for (let i = 0; i < array.length; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
    
    //regenerate targets for players
    const handleRegeneration = async () => {
        let playersNeedingUpdate = [];
        console.log(`arrayOfAlivePlayers for handleRegeneration: ${arrayOfAlivePlayers}`);
        const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned
        
        //makes an array of players that need more targets
        for (let i = 0; i < arrayOfAlivePlayers.length; i++) {
            const playerName = arrayOfAlivePlayers[i];
            const playerQuery = query(playerCollectionRef, where('name', '==', playerName));
            const snapshot = await getDocs(playerQuery);
            //checks if player is in db
            if (snapshot.empty) {
                console.error("Error finding player: ", playerName);
                return;
            }
            const playerTargetRef = snapshot.docs[0].data().targets;
            if (playerTargetRef.length < MAXTARGETS) {
                playersNeedingUpdate = [...playersNeedingUpdate, playerName];
            }
        }
        console.log("Players needing update: ", playersNeedingUpdate);
        
        //updates targets for players that need to update targets
        for (const player of playersNeedingUpdate) {
            const randomizedAlivePlayers = randomizeArray(arrayOfAlivePlayers);
            console.log(`randomizedAlivePlayers for ${player}: ${randomizedAlivePlayers}`);
            const playerTargetsQuery = query(playerCollectionRef, where('name', '==', player));
            const playerTargetsSnapshot = await getDocs(playerTargetsQuery);
            const playerDoc = playerTargetsSnapshot.docs[0];
            const playerData = playerDoc.data();
            let newTargetArray = [...playerData.targets];
            console.log(`Assigning targets for ${player}`);
            
            //assigns target to player if meets criteria
            for (const playerTarget of randomizedAlivePlayers) {
                const targetQuery = query(playerCollectionRef, where('name', '==', playerTarget));
                const targetSnapshot = await getDocs(targetQuery);
                const targetDoc = targetSnapshot.docs[0];
                const targetData = targetDoc.data();
                
                //target is assigned if criteria met 
                if (
                    targetData.assassins.length < MAXTARGETS + 1 && //checks if target has max assassins
                    !targetData.targets.includes(player) && //checks if target is targeting player
                    newTargetArray.length < MAXTARGETS && //checks if player already has max targets
                    !newTargetArray.includes(playerTarget) && //checks if target is already assigned
                    !targetData.assassins.includes(player) && //checks if target is an assassin
                    playerTarget !== player //checks if target is the same as player
                ) {
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
                else {
                    console.log(`no new targets found for ${player}`);
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
            <Button 
                onClick={handleRegeneration}
                m='5px'
            >
                Regenerate Targets
            </Button>
        </div>
    );
}
 
export default RegenerateTargets;
