import React, { useState} from 'react';
import { Box, Tooltip } from '@chakra-ui/react';
import CreateAlert from './CreateAlert';
import kill from '../assets/kill-white.png';
import killHover from '../assets/kill-hover.png';
import { db } from '../utils/firebase';
import { collection, query, where, getDocs, updateDoc } from 'firebase/firestore';

const KillButton = (props) => {
    const { roomID, assassinPlayerNamed, handleKillPlayer, selectedTarget, possibleTargets, getPossibleTargets } = props;
    const [isHovering, setIsHovering] = useState(false);
    const createAlert = CreateAlert();
    const playerCollectionRef = collection (db, 'rooms', roomID, 'players');

    const handleKill = async () => {
        if (selectedTarget === '') {
            return createAlert('error', 'Error', 'Must Select Target', 1500);
        }

        console.log("The following player will be killed: ", selectedTarget);
        const targetQuery = query(playerCollectionRef, where('name', '==', selectedTarget));
        const assassinQuery = query(playerCollectionRef, where('name', '==', assassinPlayerNamed));

        try {
            const [assassinSnapshot, targetSnapshot] = await Promise.all([getDocs(assassinQuery), getDocs(targetQuery)]);
            if (!assassinSnapshot.empty && !targetSnapshot.empty) {
                const assassinData = assassinSnapshot.docs[0].data();
                const targetData = targetSnapshot.docs[0].data();
                const assassinRef = assassinSnapshot.docs[0].ref;
                const targetRef = targetSnapshot.docs[0].ref;

                await updateDoc(assassinRef, {
                    score: assassinData.score + targetData.score
                });
                await updateDoc(targetRef, {
                    score: 0,
                    isAlive: false,
                    targets: [],
                    assassins: []
                });

                for (let i = 0; i < targetData.assassins.length; i++) {
                    const tempPlayer = targetData.assassins[i];
                    const newQuery = query(playerCollectionRef, where('name', '==', tempPlayer));
                    const newSnapshot = await getDocs(newQuery);
                    if (!newSnapshot.empty) {
                        const targetArray = [...newSnapshot.docs[0].data().targets];
                        const index = targetArray.indexOf(selectedTarget);
                        if (index !== -1) {
                            targetArray.splice(index, 1);
                            await updateDoc(newSnapshot.docs[0].ref, {
                                targets: targetArray,
                            });
                        }
                    }
                }

                for (let i = 0; i < targetData.targets.length; i++) {
                    const tempPlayer = targetData.targets[i];
                    const newQuery = query(playerCollectionRef, where('name', '==', tempPlayer));
                    const newSnapshot = await getDocs(newQuery);
                    if (!newSnapshot.empty) {
                        const assassinArray = [...newSnapshot.docs[0].data().assassins];
                        const index = assassinArray.indexOf(selectedTarget);
                        if (index !== -1) {
                            assassinArray.splice(index, 1);
                            await updateDoc(newSnapshot.docs[0].ref, {
                                assassins: assassinArray,
                            });
                        }
                    }
                }
            } else {
                console.error("Assassin or target not found.");
            }
        } catch (error) {
            console.error("Error updating assassin's score: ", error);
        }
        const targets = possibleTargets.filter(target => target !== selectedTarget);
        getPossibleTargets(targets);
        handleKillPlayer(selectedTarget, assassinPlayerNamed);
    };

    return (  
        <Box onMouseEnter = {() => setIsHovering(true)} 
             onMouseLeave = {() => setIsHovering(false)}
             w = '54px'
             h = '50px'
             display = 'flex'
             justifyContent = 'center'
             alignItems = 'center'
             ml = '16px'
             mr = '16px'
        >
            <Tooltip label = 'Kill Player'>
            <img 
                        src={isHovering ? killHover : kill} 
                        alt="Kill Button" 
                        onClick={handleKill} 
                        style={{ cursor: 'pointer', width: '54px', height: '50px' }}
                />
            </Tooltip>
        </Box>
    );
}
 
export default KillButton;