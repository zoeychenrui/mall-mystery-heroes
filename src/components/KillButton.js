import React, { useEffect, useState } from 'react';
import { db } from '../utils/firebase';
import { collection, query, getDocs, where, onSnapshot, updateDoc } from "firebase/firestore";
import { Select, Flex, Alert, AlertIcon, AlertTitle, AlertDescription, Box, HStack, Tooltip } from '@chakra-ui/react';
import kill from '../assets/kill-white.png';
import killHover from '../assets/kill-hover.png';
import CreateAlert from './CreateAlert';

const KillButton = ({ roomID, assassinPlayerNamed, onPlayerKilled }) => {
    const [selectedTargetPlayer, setSelectedTargetPlayer] = useState('');
    const [possibleTargets, setPossibleTargets] = useState([]);
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const createAlert = CreateAlert();
    const [isHovering, setIsHovering] = useState(false);

    const handleChange = (event) => {
        setSelectedTargetPlayer(event.target.value);
    };

    //updates possible targets when assassinPlayerNamed changes
    useEffect(() => {
        const fetchTargets = async () => {
            if (assassinPlayerNamed === '') {
                setPossibleTargets([]);
                return;
            }

            const assassinQuery = query(playerCollectionRef, where('name', '==', assassinPlayerNamed));
            const assassinSnapshot = await getDocs(assassinQuery);
            const assassinData = assassinSnapshot.docs[0].data();
            setPossibleTargets(assassinData.targets);
        }

        if (assassinPlayerNamed) {
            fetchTargets();
        }
    }, [assassinPlayerNamed]);

    const handleKill = async () => {
        if (selectedTargetPlayer === '') {
            return createAlert('error', 'Error', 'Must Select Target', 1500);
        }

        console.log("The following player will be killed: ", selectedTargetPlayer);
        const targetQuery = query(playerCollectionRef, where('name', '==', selectedTargetPlayer));
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
                        const index = targetArray.indexOf(selectedTargetPlayer);
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
                        const index = assassinArray.indexOf(selectedTargetPlayer);
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
        const targets = possibleTargets.filter(target => target !== selectedTargetPlayer);
        setPossibleTargets(targets);
        onPlayerKilled(selectedTargetPlayer, assassinPlayerNamed);
    };

    return (
        <form>
            <HStack spacing='40px'>
                <Box onMouseEnter = {() => setIsHovering(true)} 
                     onMouseLeave = {() => setIsHovering(false)}
                >
                    <Tooltip label = 'Kill Player'>
                    <img 
                                src={isHovering ? killHover : kill} 
                                alt="Kill Button" 
                                onClick={handleKill} 
                                style={{ cursor: 'pointer', marginLeft: '1rem', width: '60px', height: '50px' }}
                        />
                    </Tooltip>
                </Box>
                    <Select 
                        id='killTarget'
                        placeholder='Select Target'
                        value={selectedTargetPlayer}
                        onChange={handleChange}
                    >
                        {possibleTargets.map((player, index) => (
                            <option key={index} value={player}>
                                {player}
                            </option>
                        ))}
                    </Select>
            </HStack>
        </form>
    );
};

export default KillButton;