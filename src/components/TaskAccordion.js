import { Checkbox,
         Flex,
         Button,
         AccordionIcon,
         AccordionButton,
         AccordionItem,
         AccordionPanel,
         Box,
         AlertDialog,
         AlertDialogBody,
         AlertDialogFooter,
         AlertDialogHeader,
         AlertDialogContent,
         AlertDialogOverlay,
         AlertDialogCloseButton,
         useDisclosure         
    } from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
import { collection, 
         query, 
         where, 
         updateDoc,
         getDocs
    } from 'firebase/firestore';
import { db } from '../utils/firebase'
import CreateAlert from './CreateAlert';

const TaskAccordion = (props) => {
    const {task, players, roomID, arrayOfDeadPlayers } = props;
    const [checkedPlayers, setCheckedPlayers] = useState([]);
    const [playersAdded, setPlayersAdded] = useState([]);
    const [playersRemoved, setPlayersRemoved] = useState([]);
    const points = task.pointValue;
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const cancelRef = React.useRef();
    const {isOpen, onOpen, onClose} = useDisclosure();
    const createAlert = CreateAlert();
    let listOfPlayers = null;

    //saves checked players when page is refreshed
    useEffect(() => {
        console.log(`usingEffect setCheckedPlayers: ${task.completedBy}`);
        setCheckedPlayers(task.completedBy);
    }, [roomID, task.completedBy])

   //updates checkedplayers when a checkbox is clicked
    const handleCheckedPlayers = (player) => {
        //handling for task and revival mission types
        if (task.taskType === 'Task' || task.taskType === 'Revival Mission') {
            setCheckedPlayers(checkedPlayers => {
                if (checkedPlayers.includes(player)) { //if player is already checked
                    setPlayersRemoved(playersRemoved => [...playersRemoved, player]);
                    setPlayersAdded(playersAdded => playersAdded.filter(addedPlayer => addedPlayer !== player));
                    return checkedPlayers.filter(checkedPlayer => checkedPlayer !== player);
                }
                else { //if player is not already checked
                    setPlayersAdded(playersAdded => [...playersAdded, player]);
                    setPlayersRemoved(playersRemoved => playersRemoved.filter(removedPlayer => removedPlayer !== player));
                    return [...checkedPlayers, player];
                    
                }
            }); 
        }
    }

    //saves changes but does not make task inactive
    const handleSaveChanges = async (event) => {
        onClose();
        
        //updates completedBy for the task
        const taskQuery = query(taskCollectionRef, where('title', '==', task.title));
        const snapshot = await getDocs(taskQuery);
        const taskDoc = snapshot.docs[0].ref;
        await updateDoc(taskDoc, {
            completedBy: checkedPlayers
        });

        //updates points for tasks
        if (task.taskType === 'Task') {
            //adds points to player for tasks
            if (playersAdded.length > 0) {
                console.log(`players added: ${playersAdded}`);
                try {
                    const playerQuery = query(playerCollectionRef, where('name', 'in', playersAdded));
                    const playerSnapshot = await getDocs(playerQuery);
                    const playerDocs = playerSnapshot.docs;
                    let updatePlayersAdded = playersAdded;
                    for (const player of playerDocs) {
                        const playerDoc = player.ref;
                        let currScore = parseInt(player.data().score);
                        let pointVal = parseInt(points);
                        let total = currScore + pointVal;
                        console.log(total);
                        await updateDoc(playerDoc, {
                            score: total
                        });
                        updatePlayersAdded = updatePlayersAdded.filter(addedPlayer => addedPlayer !== player.data().name);
                        console.log(updatePlayersAdded);
                    }
                    setPlayersAdded(updatePlayersAdded);
                }
                catch(error) {
                    console.error('error adding player points', error);
                }
                console.log(`playersadded after: ${playersAdded}`);
            }
            //removes points from player for tasks
            if (playersRemoved.length > 0) {
                console.log(`players removed: ${playersRemoved}`);
                try {
                    const playerQuery = query(playerCollectionRef, where('name', 'in', playersRemoved));
                    const playerSnapshot = await getDocs(playerQuery);
                    const playerDocs = playerSnapshot.docs;
                    let updatedPlayersRemoved = playersRemoved;
                    for (const player of playerDocs) {
                        const playerDoc = player.ref;
                        let currScore = parseInt(player.data().score);
                        let pointVal = parseInt(points);
                        let total = currScore - pointVal;
                        console.log(total);
                        await updateDoc(playerDoc, {
                            score: total
                        });
                        updatedPlayersRemoved = updatedPlayersRemoved.filter(removedPlayer => removedPlayer !== player.data().name);
                    }
                    setPlayersRemoved(updatedPlayersRemoved);
                    console.log(`playersremoved after: ${playersRemoved}`);
                }
                catch(error) {
                    console.error('error removing player points', error);
                }
            }            
        }

        //updates isAlive for revival missions
        if (task.taskType === 'Revival Mission') {
            //revives player if checkmarked
            if (playersAdded.length > 0) {
                const playerQuery = query(playerCollectionRef, where('name', 'in', playersAdded));
                const playerSnapshot = await getDocs(playerQuery);
                const playerDocs = playerSnapshot.docs;
                let updatePlayersAdded = playersAdded;
                for (const player of playerDocs) {
                    const playerDoc = player.ref;
                    await updateDoc(playerDoc, {
                        isAlive: true
                    });
                    updatePlayersAdded = updatePlayersAdded.filter(addedPlayer => addedPlayer !== player.data().name);
                }
                setPlayersAdded(updatePlayersAdded);
            }
            //kills play if uncheckmarked
            if (playersRemoved.length > 0) {
                const playerQuery = query(playerCollectionRef, where('name', 'in', playersRemoved));
                const playerSnapshot = await getDocs(playerQuery);
                const playerDocs = playerSnapshot.docs;
                let updatedPlayersRemoved = playersRemoved;
                for (const player of playerDocs) {
                    const playerDoc = player.ref;
                    await updateDoc(playerDoc, {
                        isAlive: false
                    });
                    updatedPlayersRemoved = updatedPlayersRemoved.filter(removedPlayer => removedPlayer !== player.data().name);
                }
                setPlayersRemoved(updatedPlayersRemoved);
            }
        }
    }

    //actions for pressing complete button
    const handlePressedCompletedButton = async () => {
        if (checkedPlayers.length === 0) {
            createAlert('error', 'Error', 'Please select at least one player', 1500);
            return;
        }
        handleSaveChanges();
        try { 
            const title = task.title;
            const taskQuery = query(taskCollectionRef, where('title', '==', title));
            const snapshot = await getDocs(taskQuery);
            const taskDoc = snapshot.docs[0].ref;
            await updateDoc(taskDoc, {
                isComplete: true,
                completedBy: checkedPlayers
            });
            await props.refresh();
        } catch(error) {
            console.error("Error in handlePressedCompletedButton: ", error);
        }

    }

    //creates checkboxes of all players for task
    if (task.taskType === 'Task')  {
        listOfPlayers = players.map(player => (
            <Checkbox
                key = {player}
                value = {player}
                isChecked = {checkedPlayers.includes(player)}
                onChange = {() => handleCheckedPlayers(player)}
            >
                {player}
            </Checkbox>
        ));
    }

    //creates checkboxes of dead players for revival missions
    else if (task.taskType === 'Revival Mission') {
        console.log(`array1:`, arrayOfDeadPlayers);
        listOfPlayers = arrayOfDeadPlayers?.map(player => (
            <Checkbox
                key = {player}
                value = {player}
                isChecked = {checkedPlayers.includes(player)}
                onChange = {() => handleCheckedPlayers(player)}
            >
                {player}
            </Checkbox>
        ) || []);
    }


    return (
        <Flex>
            <AlertDialog
                isOpen = {isOpen}
                leastDestructiveRef = {cancelRef}
                onClose = {onClose}
            >
                <AlertDialogOverlay>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            Complete Task: {task.title}
                        </AlertDialogHeader>
                        <AlertDialogCloseButton/>
                        <AlertDialogBody>
                            Select Players:
                        </AlertDialogBody>
                        <AlertDialogBody>
                            <Flex flexDirection = 'column'>
                                {listOfPlayers}                     
                            </Flex>
                        </AlertDialogBody>
                        <AlertDialogFooter>
                            <Button 
                                colorScheme = 'gray'
                                ref = {cancelRef} 
                                value = {task.title}
                                onClick = {handleSaveChanges}
                            >
                                Save
                            </Button>
                            <Button
                                colorScheme = 'green'
                                onClick = {handlePressedCompletedButton}
                                ml= '3'
                            >
                                Complete
                            </Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialogOverlay>
            </AlertDialog>

            <AccordionItem key = {task.title}>
                <h2>
                    <AccordionButton>
                        <Box as="span" flex='1' textAlign='left'>
                            {task.title}
                        </Box>
                        <AccordionIcon />
                    </AccordionButton>
                </h2>
                <AccordionPanel pb='4'>
                    {task.description}
                </AccordionPanel>
                <AccordionPanel>
                    Points: {task.pointValue}
                </AccordionPanel>
                <AccordionPanel>
                    Task Type: {task.taskType}
                </AccordionPanel>
                <AccordionPanel>
                    {task.isComplete ? (
                        `Completed By: ${task.completedBy.join(', ')}`
                    ) : (
                        <Button
                            colorScheme = 'green'
                            onClick = {onOpen}
                        >
                            Choose
                        </Button>
                    )}
                </AccordionPanel>
            </AccordionItem>             
        </Flex>
    );
}

export default TaskAccordion;