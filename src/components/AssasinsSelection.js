import React, { useEffect, useState } from 'react';
import { db } from '../utils/firebase';
import { collection, query, getDocs, where, onSnapshot, updateDoc } from "firebase/firestore";
import { Select, Flex, Button } from '@chakra-ui/react';

const AssasinsSelection = (props) => {
    const { roomID, killedPlayerNamed, killedPlayerPoints, triggerAS, setTriggerAS } = props;
    const [possibleAssassin, setPossibleAssassin] = useState([]);
    const [selectedAssassin, setSelectedAssassin] = useState('');
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const [editableArray, setEditableArray] = useState([]);
    let newPoints = killedPlayerPoints;

    const handleChange = (event) => {
        setSelectedAssassin(event.target.value);
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
            console.log('Please select an assassin!!!');
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
                    <Flex padding='10px'>
                        <Select 
                            placeholder='Select Assassin'
                            value={selectedAssassin}
                            onChange={handleChange}
                        >
                            <option key='' value=''></option>
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
                        >
                            Assassin
                        </Button>
                    </Flex>
                </form>
            )}
        </>
    );
};

export default AssasinsSelection;
