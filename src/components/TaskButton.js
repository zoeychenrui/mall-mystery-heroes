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
         where ,
         doc
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
        for (const player of newCheckedPlayers) {
            setCheckedPlayers(checkedPlayers.filter(p => p !== player));
        }
        for (const player of newRemovedPlayers) {
            setCheckedPlayers([...checkedPlayers, player]);
        }
        setNewCheckedPlayers([]);
        setNewRemovedPlayers([]);
        onClose();
    }

    //handles when save button is clicked
    const handleSave = () => {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskDocRef = doc(taskCollectionRef, taskID);
        const taskSnapshot = getDoc(taskDocRef);
        const task = taskSnapshot.data();

        onClose();
    }

    //handles when complete button is clicked
    const handleComplete = () => {
        onClose();
    }

    //handles when checkbox is clicked
    const handleCheckedPlayers = (player) => {
        if (checkedPlayers.includes(player)) {
            setCheckedPlayers(checkedPlayers.filter(p => p !== player));
            setNewRemovedPlayers([...newRemovedPlayers, player]);
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
                            Player 
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