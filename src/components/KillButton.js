import React, { useEffect, useState } from 'react';
import { db } from '../utils/firebase';
import { collection, query, getDocs, where, onSnapshot, updateDoc } from "firebase/firestore";
import { Select, Flex, Alert, AlertIcon, AlertTitle, AlertDescription, Box, HStack } from '@chakra-ui/react';
import killImage from '../assets/kill.png'; // Adjust the path according to your project structure

const KillButton = ({ roomID, assassinPlayerNamed, handleKillPlayer }) => {
    const [selectedTargetPlayer, setSelectedTargetPlayer] = useState('');
    const [showAlert, setShowAlert] = useState(false);
    const [possibleTargets, setPossibleTargets] = useState([]);
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');

    const handleChange = (event) => {
        setSelectedTargetPlayer(event.target.value);
        setShowAlert(false);
    };

    useEffect(() => {
        const assassinQuery = query(playerCollectionRef, where('name', '==', assassinPlayerNamed));
        const unsubscribe = onSnapshot(assassinQuery, (snapshot) => {
            if (!snapshot.empty) {
                const playerData = snapshot.docs[0].data();
                setPossibleTargets(playerData.targets || []);
            } else {
                console.error("No documents found with the specified query.");
            }
        });
        return () => unsubscribe();
    }, [assassinPlayerNamed, playerCollectionRef]);

    const handleKill = async () => {
        if (selectedTargetPlayer === '') {
            setShowAlert(true);
            return;
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
        setPossibleTargets([]);
        handleKillPlayer(selectedTargetPlayer);
    };

    return (
        <>
            <form>
                <Flex padding='10px' direction="column" align="center">
                    {showAlert && (
                        <Box mb={4} width="100%">
                            <Alert status="error">
                                <AlertIcon />
                                <AlertTitle>Please select a target</AlertTitle>
                                <AlertDescription>You need to choose a target to proceed.</AlertDescription>
                            </Alert>
                        </Box>
                    )}
                    <Flex width="100%" justifyContent="center">
                    <HStack spacing='40px'>
                        <img 
                                src={killImage} 
                                alt="Kill Button" 
                                onClick={handleKill} 
                                style={{ cursor: 'pointer', marginLeft: '1rem', width: '50px', height: '50px' }}
                            />
                            <Select 
                                id='killTarget'
                                placeholder='Player Name'
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
                    </Flex>
                </Flex>
            </form>
        </>
    );
};

export default KillButton;