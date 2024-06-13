import React from 'react';
import { Button } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection } from "firebase/firestore";
const RegenerateTargets = (props) => {
    const { arrayOfAlivePlayers, roomID } = props;
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');

    //randomizes order of array
    const randomizeArray = (array) => {
        for (let i = 0; i < array.length; i++) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    //returns array of players needing more targets
    const findPlayersNeedingTargets = (players, MAXTARGETS) => {
        let playersNeedingUpdate = [];
        for (let i = 0; i < players.length; i++) {
            for (let j = MAXTARGETS - 1; j > -1; j--) {
                const player = players[i];
                const playerQuery = query(playerCollectionRef, where('name', '==', player));
                const playerSnapshot = getDocs(playerQuery);
                const playerTargetRef = playerSnapshot.docs[0].data().targets;
                if (playerTargetRef.length === j) {
                    playersNeedingUpdate.push({
                        name: player,
                        Targets: playerTargetRef
                    });
                }
            }
        }
        return playersNeedingUpdate;
    };

    //returns array of players needing more assassins
    const findPlayersNeedingAssassins = (players, MAXTARGETS) => {
        let playersNeedingUpdate = [];
        for (let i = 0; i < players.length; i++) {
            for (let j = MAXTARGETS - 1; j > -1; j--) {
                const player = players[i];
                const playerQuery = query(playerCollectionRef, where('name', '==', player));
                const playerSnapshot = getDocs(playerQuery);
                const playerAssassinRef = playerSnapshot.docs[0].data().assassins;
                if (playerAssassinRef.length === j) {
                    playersNeedingUpdate.push({
                        name: player,
                        Assassins: playerAssassinRef,
                        Targets: playerSnapshot.docs[0].data().targets
                    });
                }                
            }
        }
        return playersNeedingUpdate;
    };

    const handleRegeneration = () => {
        const MAXTARGETS = arrayOfAlivePlayers.length > 15 ? 3 : (arrayOfAlivePlayers.length > 5 ? 2 : 1); //defines what max targets each player should be assigned
        const playersNeedingTargets = findPlayersNeedingTargets(arrayOfAlivePlayers, MAXTARGETS);
        const playersNeedingAssassins = findPlayersNeedingAssassins(arrayOfAlivePlayers, MAXTARGETS);

        while (playersNeedingTargets.length > 0) {
            const player = playersNeedingTargets.pop();
            let newTargetArray = player.Targets.map(target => target.name);

            while (player.Targets.length < MAXTARGETS) {
                for (let i = playersNeedingAssassins.length - 1; i > -1; i--) {
                    const target = playersNeedingAssassins[i];
                    if (!target.Assassins.includes(player.name) && //checks if target is already targeted by player
                        !player.Targets.includes(target.name) && //checks if player is already targeting target
                        !target.Targets.includes(player.name) && //checks if target is targeting player
                         player !== target //checks if player is target
                            ) {
                        player.Targets.push(target.name);
                        
                    }
                }
            }

        }
        
    };

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