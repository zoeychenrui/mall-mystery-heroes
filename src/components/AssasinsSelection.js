import React, { useEffect, useState } from 'react';
import { db } from '../utils/firebase';
import { collection, query, getDocs, where, onSnapshot, updateDoc } from "firebase/firestore";
import { Select, Flex, Button, Alert, AlertIcon, AlertTitle, AlertDescription, Box } from '@chakra-ui/react';

const AssasinsSelection = (props) => {
    const { roomID, killedPlayerNamed, killedPlayerPoints, triggerAS, setTriggerAS } = props;
    const [possibleAssassin, setPossibleAssassin] = useState([]);
    const [selectedAssassin, setSelectedAssassin] = useState('');
    const [showAlert, setShowAlert] = useState(false); // State to control the alert visibility
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const [editableArray, setEditableArray] = useState([]);
    let newPoints = killedPlayerPoints;

    const handleChange = (event) => {
        setSelectedAssassin(event.target.value);
        setShowAlert(false); // Hide alert when an assassin is selected
    };

    useEffect(() => {
        const playerQuery = query(playerCollectionRef, where('name', '==', killedPlayerNamed));
        const unsubscribe = onSnapshot(playerQuery, (snapshot) => {
            if (!snapshot.empty) {
                const playerData = snapshot.docs[0].data();
                setPossibleAssassin(playerData.assassins);
            } else {
                console.error("No documents found with the specified query.");
            }
        });
        return () => unsubscribe();
    }, [killedPlayerNamed]);

    const removeAssassin = async () => {
        if (selectedAssassin === '') {
            setShowAlert(true); // Show alert if no assassin is selected
            return;
        }

        console.log("Removing assassin: ", selectedAssassin);
        const assassinQuery = query(playerCollectionRef, where('name', '==', selectedAssassin));

        try {
            const querySnapshot = await getDocs(assassinQuery);
            const assassinData = querySnapshot.docs[0].data();
            const assassinRef = querySnapshot.docs[0].ref;
            setEditableArray([...assassinData.targets]);
            const index = editableArray.indexOf(killedPlayerNamed);
            const spliced = editableArray.slice();
            spliced.splice(index, 1);
            setEditableArray(spliced);
            await updateDoc(assassinRef, {
                targets: spliced,
                score: assassinData.score + newPoints 
            });
        } catch (error) {
            console.error("Error removing player: ", error);
        }
        setTriggerAS(false); // Use the passed callback to update the state in the parent component
    };

    return (
        <>
            {triggerAS && (
                <form>
                    <Flex padding='10px' direction="column" align="center">
                        {showAlert && (
                            <Box mb={4} width="100%" >
                                <Alert status="error" >
                                    <AlertIcon />
                                    <AlertTitle>Please select an assassin</AlertTitle>
                                    <AlertDescription>You need to choose an assassin to proceed.</AlertDescription>
                                </Alert>
                            </Box>
                        )}
                        <Flex width="100%" justifyContent="center">
                            <Select 
                                placeholder='Select Assassin'
                                value={selectedAssassin}
                                onChange={handleChange}
                            >
                                {possibleAssassin.map((player, index) => (
                                    <option key={index} value={player}>
                                        {player}
                                    </option>
                                ))}
                            </Select>
                            <Button 
                                onClick={removeAssassin}
                                colorScheme='red'
                                size='lg'
                                ml={3}
                            >
                                Assassin
                            </Button>
                        </Flex>
                    </Flex>
                </form>
            )}
        </>
    );
};

export default AssasinsSelection;
