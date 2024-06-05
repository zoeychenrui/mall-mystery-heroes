import React, { useEffect, useState } from 'react';
import {
    Flex,
    Accordion,
    AccordionItem,
    AccordionButton,
    AccordionPanel,
    AccordionIcon,
    Box,
    Button,
    AlertDialog,
    AlertDialogBody,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogContent,
    AlertDialogCloseButton,
    useDisclosure,
    AlertDialogOverlay,
    Checkbox
    } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, 
         updateDoc, 
         getDocs, 
         where, 
         query 
    } from 'firebase/firestore';

const TaskList = (props) => {
    const roomID = props.roomID;
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const {isOpen, onOpen, onClose} = useDisclosure();
    const cancelRef = React.useRef();
    const arrayOfPlayers = props.arrayOfPlayers;
    const [selectedTask, setSelectedTask] = useState('');
    const [checkedPlayers, setCheckedPlayers] = useState([]);
    const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
    const [points, setPoints] = useState(0);
    const [tasks, setTasks] = useState([]);
    const arrayOfActiveTasks = tasks.filter(eachTask => eachTask.isComplete === false); //filters active tasks
    const arrayOfInactiveTasks = tasks.filter(eachTask => eachTask.isComplete === true); //filters inactive tasks

    //Fetch tasks from Firestore
    const fetchTasks = async () => {
        const taskSnapshot = await getDocs(taskCollectionRef);
        const taskArray = taskSnapshot.docs.map(doc => doc.data());
        setTasks(taskArray);
    }
    //updates checkedplayers when a checkbox is clicked
    const handleCheckedPlayers = (player) => {
        setCheckedPlayers(checkedPlayers => {
            if (checkedPlayers.includes(player)) {
                return checkedPlayers.filter(checkedPlayer => checkedPlayer !== player);
            }
            else {
                return [...checkedPlayers, player];
            }
        });
    }

    //actions for pressing complete button
    const handlePressedCompletedButton = async (event) => {
        try{ 
            const title = event.target.value;
            console.log(title);
            setSelectedTask(title);
            const taskQuery = await query(taskCollectionRef, where('title', '==', title));
            const snapshot = await getDocs(taskQuery);
            const taskPoints = snapshot.docs[0].data().pointValue;
            setPoints(parseInt(taskPoints));
            onOpen();
        }
        catch(error) {
            console.error("Error in handlePressedCompletedButton: ", error);
        }

    }

    //ccreates list of checkboxes for players
    const checkedBoxOfPlayers = arrayOfPlayers.map(eachPlayer => {
        return (
            <Checkbox 
                value = {eachPlayer}
                isChecked = {checkedPlayers.includes(eachPlayer)}
                onChange = {() => handleCheckedPlayers(eachPlayer)}
            >
                {eachPlayer}
            </Checkbox>
        );
    });

    //makes an array where each item contains an accordion item of an active task object
    const  listOfActiveTasks = arrayOfActiveTasks.map(eachTask => {
       return (
            <AccordionItem key = {eachTask.id}>
            <h2>
                <AccordionButton>
                    <Box as="span" flex='1' textAlign='left'>
                        {eachTask.title}
                    </Box>
                    <AccordionIcon />
                </AccordionButton>
            </h2>
            <AccordionPanel pb='4'>
                {eachTask.description}
            </AccordionPanel>
            <AccordionPanel>
                Points: {eachTask.pointValue}
            </AccordionPanel>
            <AccordionPanel>
                <Button 
                    value = {eachTask.title}
                    onClick = {handlePressedCompletedButton}
                >
                    Complete
                </Button>
            </AccordionPanel>
        </AccordionItem> 
       );
    });

    //makes an array where each item contains an accordion item of an inactive task object
    const listOfInactiveTasks = arrayOfInactiveTasks.map(eachTask => {
        return (
             <AccordionItem key = {eachTask.id}>
             <h2>
                 <AccordionButton>
                     <Box as="span" flex='1' textAlign='left'>
                         {eachTask.title}
                     </Box>
                     <AccordionIcon />
                 </AccordionButton>
             </h2>
             <AccordionPanel pb='4'>
                 {eachTask.description}
             </AccordionPanel>
             <AccordionPanel>
                 Points: {eachTask.pointValue}
             </AccordionPanel>
             <AccordionPanel>
                Completed By: {eachTask.completedBy.join(", ")}
            </AccordionPanel>
         </AccordionItem> 
        );
    });

    //updates db, changing player points and task status
    const handleTaskCompleted = async (event) => {
        onClose();
        //updates task status to complete
        try {
            console.log(selectedTask);
            const taskQuery = query(taskCollectionRef, where('title', '==', selectedTask));
            const taskSnapshot = await getDocs(taskQuery);
            const taskDoc = taskSnapshot.docs[0].ref;
            await updateDoc(taskDoc, {
                isComplete: true,
                completedBy: checkedPlayers
            });

            await fetchTasks()
        }
        catch (error) {
            console.error('error updating tasks',error);
        }
        //updates player points
        try {
            const playerQuery = query(playerCollectionRef, where('name', 'in', checkedPlayers));
            const playerSnapshot = await getDocs(playerQuery);
            const playerDocs = playerSnapshot.docs;
            for (let i = 0; i < playerDocs.length; i++) {
                const playerDoc = playerDocs[i].ref;
                let currScore = parseInt(playerDocs[i].data().score);
                let pointVal = parseInt(points);
                let total = currScore + pointVal;
                console.log(total);
                await updateDoc(playerDoc, {
                    score: total
                });
            }
        }
        catch (error) {
            console.error('error updating player points', error);
        }
    }

    //Fetch tasks on component mount
    useEffect(() => {
        fetchTasks();
    // eslint-disable-next-line
    }, [props.arrayOfTasks]);
    
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
                            Complete Task: {selectedTask}
                        </AlertDialogHeader>
                        <AlertDialogCloseButton/>
                        <AlertDialogBody>
                            Select Players:
                        </AlertDialogBody>
                        <AlertDialogBody>
                            <Flex flexDirection = 'column'>
                                {checkedBoxOfPlayers}
                            </Flex>
                        </AlertDialogBody>
                        <AlertDialogFooter>
                            <Button 
                                colorScheme = 'gray'
                                ref = {cancelRef} 
                                onClick = {onClose}
                            >
                                Cancel
                            </Button>
                            <Button
                                colorScheme = 'green'
                                value = {selectedTask}
                                onClick = {handleTaskCompleted}
                                ml= '3'
                            >
                                Complete
                            </Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialogOverlay>
            </AlertDialog>

            <Flex flexDirection='column'>
                <Flex flexDirection= "column" margin= '5'>
                    <h1>Active Tasks</h1>
                    <Accordion>
                        {listOfActiveTasks}
                    </Accordion>
                </Flex>

                <Flex flexDirection= "column" margin = '5'>
                    <h1>Inactive Tasks</h1>
                    <Accordion>
                        {listOfInactiveTasks}
                    </Accordion>
                </Flex>
            </Flex>    
        </Flex>

    );
}
 
export default TaskList;