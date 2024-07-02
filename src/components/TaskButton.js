import React, { useState, useEffect } from 'react';
import { Button, Checkbox, 
         Modal, 
         ModalBody, 
         ModalCloseButton, 
         ModalContent, 
         ModalFooter, 
         ModalHeader, 
         ModalOverlay, 
         useDisclosure,
         Box,
         Image,
         Stack
    } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, 
         getDoc, 
         getDocs, 
         query, 
         where,
         doc,
         updateDoc
    } from 'firebase/firestore';
import CreateAlert from './CreateAlert';
import enter from '../assets/enter-green.png';
import enterHover from '../assets/enter-hovering.png';

const TaskButton = ({ taskID, roomID }) => {    
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [listOfChoices, setListOfchoices] = useState([]);
    const createAlert = CreateAlert();
    const [checkedPlayers, setCheckedPlayers] = useState([]);
    const [isHovering, setIsHovering] = useState(false);
    const [newCheckedPlayers, setNewCheckedPlayers] = useState([]);
    const [newRemovedPlayers, setNewRemovedPlayers] = useState([]);
    
    //cancels actions made in modal when cancel button is clicked
    const handleCancel = () => {
        setCheckedPlayers(prevCheckedPlayers => {
            let tempCheckedPlayers = [...prevCheckedPlayers];
            for (const player of newCheckedPlayers) {
                tempCheckedPlayers = tempCheckedPlayers.filter(p => p !== player);
            }
            for (const player of newRemovedPlayers) {
                tempCheckedPlayers.push(player);
            }
            return tempCheckedPlayers;
        });
        setNewCheckedPlayers([]);
        setNewRemovedPlayers([]);
        onClose();
    }

    //updates scores/live status when save button is clicked
    const handleSave = async () => {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskRef = doc(taskCollectionRef, taskID);
        const taskSnapshot = await getDoc(taskRef);
        const task = taskSnapshot.data();
        const taskDocRef = taskSnapshot.ref;
        const points = parseInt(task.pointValue);
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');

        //updates player scores for task types
        if (task.taskType === 'Task') {
            //adds points to new updated players
            for (const player of newCheckedPlayers) {
                const playerQuery = query(playerCollectionRef, where('name', '==', player));
                const playerSnapshot = await getDocs(playerQuery);
                const playerDoc = playerSnapshot.docs[0].ref;
                const playerScore = parseInt(playerSnapshot.docs[0].data().score);
                console.log('points: ' + points);
                console.log('playerScore: ' + playerScore);
                const newPoints = points + playerScore;
                await updateDoc(playerDoc, { score: newPoints });
            }
            //removes points for those that were initially checked, but now removed
            for (const player of newRemovedPlayers) {
                const playerQuery = query(playerCollectionRef, where('name', '==', player));
                const playerSnapshot = await getDocs(playerQuery);
                const playerdoc = playerSnapshot.docs[0].ref;
                const playerScore = parseInt(playerSnapshot.docs[0].data().score);
                const newPoints = playerScore - points;
                await updateDoc(playerdoc, { score: newPoints });
            }
        }
        //updates player live status for revival missions
        else if (task.taskType === 'Revival Mission') {
            //revives newly checked players
            for (const player of newCheckedPlayers) {
                const playerQuery = query(playerCollectionRef, where('name', '==', player));
                const playerSnapshot = await getDocs(playerQuery);
                const playerdoc = playerSnapshot.docs[0].ref;
                await updateDoc(playerdoc, { isAlive: true });
            }
            //kills those that were initially checked, but now removed
            for (const player of newRemovedPlayers) {
                const playerQuery = query(playerCollectionRef, where('name', '==', player));
                const playerSnapshot = await getDocs(playerQuery);
                const playerdoc = playerSnapshot.docs[0].ref;
                await updateDoc(playerdoc, { isAlive: false });
            }
        }
        
        //updates task to be completed by checkedplayers
        await updateDoc(taskDocRef, { completedBy: checkedPlayers });
        setNewCheckedPlayers([]);
        setNewRemovedPlayers([]);
        onClose();
    }

    //handles when complete button is clicked
    const handleComplete = async() => {
        await handleSave();
        createAlert('info', 'Completed', 'Task has been saved as completed', 1500);
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskDocRef = doc(taskCollectionRef, taskID);
        await updateDoc(taskDocRef, { isComplete: true });
        onClose();
    }

    //handles when checkbox is clicked
    const handleCheckedPlayers = (player) => {
        if (checkedPlayers.includes(player)) {
            setCheckedPlayers(checkedPlayers.filter(p => p !== player));
            if (!newCheckedPlayers.includes(player)) {
                setNewRemovedPlayers([...newRemovedPlayers, player]);   
            }
            setNewCheckedPlayers(newCheckedPlayers.filter(p => p !== player));
        }
        else {
            setCheckedPlayers([...checkedPlayers, player]);
            setNewCheckedPlayers([...newCheckedPlayers, player]);
            setNewRemovedPlayers(newRemovedPlayers.filter(p => p !== player));
        }   
    }
    
    //handles when image is clicked
    const handleEnterClicked = () => {
        //error when selected task is blank
        if (taskID === '') {
            createAlert('error', 'Error', 'Error: no task selected', 1500);
            return;
        }
        onOpen();
    }

    //creates listOfChoices based on the task type
    const createListOfChoices = async () => {
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');

        //error when task is blank
        if (!taskID || taskID === '') {
            setListOfchoices([]);
            console.error('taskID not defined');
            return;
        }

        const taskDocRef = doc(taskCollectionRef, taskID);
        const taskSnapshot = await getDoc(taskDocRef);
        const task = taskSnapshot.data();
        
        //alive players are shown for tasks
        if (task.taskType === 'Task') {
            const playerQuery = query(playerCollectionRef, where('isAlive', '==', true));
            const playerSnapshot = await getDocs(playerQuery);
            const tempList = playerSnapshot.docs.map(doc => doc.data().name); 
            setListOfchoices(tempList);
        }
        //dead players are shown for revival missions
        else if (task.taskType === 'Revival Mission') {
            const playerQuery = query(playerCollectionRef, where('isAlive', '==', false));
            const playerSnapshot = await getDocs(playerQuery);
            const tempList = playerSnapshot.docs.map(doc => doc.data().name);
            setListOfchoices(tempList);
        }

        else {
            console.error('invalid task type');
        }
    }

    //updates ListofChoices when the task changes
    useEffect(() => {
        createListOfChoices();
        console.log('task changed. List of choices updated');
    }, [taskID])

    useEffect(() => {
        console.log('checkedPlayers:', checkedPlayers);
        console.log('newCheckedPlayers:', newCheckedPlayers);
        console.log('newRemovedPlayers:', newRemovedPlayers);
    }, [checkedPlayers, newCheckedPlayers, newRemovedPlayers])

    return (
        <Box onMouseEnter = {() => setIsHovering(true)} 
             onMouseLeave = {() => setIsHovering(false)}
             m = '4px'
        >
            <Image 
                src = {isHovering ? enterHover : enter}
                alt = 'Enter'
                width = '60px'
                height = '48px'
                cursor = 'pointer'
                onClick = {handleEnterClicked}
            />

            <Modal isOpen = {isOpen}
                   onClose = {onClose}
                   onOpen = {onOpen}
            >
                <ModalOverlay>
                    <ModalContent backgroundColor = "rgb(32,32,48)"
                                  borderRadius = '2xl'
                    >
                        <ModalHeader>
                            Who Has Completed The Task? 
                        </ModalHeader>
                        <ModalCloseButton />
                        <ModalBody>
                            <Stack>
                                {listOfChoices.map(player => (
                                    <Checkbox
                                        key = {player}
                                        value = {player}
                                        isChecked = {checkedPlayers.includes(player)}
                                        onChange = {() => handleCheckedPlayers(player)}
                                    >
                                        {player}
                                    </Checkbox>
                                ))}
                            </Stack>
                        </ModalBody>

                        <ModalFooter>
                            <Button onClick = {handleCancel}
                                    backgroundColor = 'red'
                                    color = 'white'
                            >
                                Cancel
                            </Button>
                            <Button onClick = {handleSave}
                                    backgroundColor = 'blue.500'
                                    color = 'white'
                            >
                                Save Changes
                            </Button>
                            <Button onClick = {handleComplete}
                                    backgroundColor = 'green.500'
                                    color = 'white'
                            >
                                Complete Task
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </ModalOverlay>
            </Modal>
        </Box>
    );
}
 
export default TaskButton;