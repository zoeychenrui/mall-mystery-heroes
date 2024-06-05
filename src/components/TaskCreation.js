import React, { useState } from 'react';
import {Input, 
        Button, 
        Flex,
        NumberInput,
        NumberInputField,
        NumberDecrementStepper,
        NumberIncrementStepper,
        NumberInputStepper,
        useToast,
        Alert,
        AlertIcon,
        AlertTitle,
        AlertDescription,
        CloseButton,
        Box
    } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, 
         addDoc,
         getDocs,
         where,
         query
    } from 'firebase/firestore';

const TaskCreation = (props) => {
    const [TaskTitle, setTaskTitle] = useState('');
    const [TaskDescription, setTaskDescription] = useState('');
    const [PointValue, setPointValue] = useState('');
    const roomID = props.roomID;
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const toast = useToast();
    const time = new Date();
    const [showAlert, setShowAlert] = useState(false);
    const [error, setError] = useState('');

    const onClose = () => {
        setShowAlert(false);
    } 

    const handleDescriptionChange = (event) => {
        setTaskDescription(event.target.value);
    }

    const handleTitleChange = (event) => {
        setTaskTitle(event.target.value);
    }

    const handlePointChange = (value) => {
        setPointValue(value);
    }

    const handleAddTask = async () => {
        let newTask = {
            title: TaskTitle,
            description: TaskDescription,
            pointValue: PointValue,
            dateCreated: time.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
            isComplete: false,
            completedBy: null
        };
        const checkTaskQuery = query(taskCollectionRef, where('title', '==', newTask.title));
        const checkTaskSnapshot = await getDocs(checkTaskQuery);
        if (checkTaskSnapshot.empty) {
            await addDoc(taskCollectionRef, newTask);
        }
        else {
            console.error("Error adding task: title already exists");
            setError("Error adding task: title already exists");
            setShowAlert(true);
            return;
        }
        props.onNewTaskAdded(newTask);
        toast ({
            title: 'Task Added',
            description: 'Your task has been created.',
            status: 'success',
            duration: 1500,
            isClosable: true,
        });
    }

    return (  
        <Flex>
            {showAlert && (
                <Alert status='error'>
                    <Box>
                        <AlertIcon/>
                        <AlertTitle>Error: </AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Box>
                    <CloseButton
                        alignSelf='flex-start'
                        position='relative'
                        right={-1}
                        top={-1}
                        onClick={onClose}
                    />
                </Alert>
            )}
            <Input size = 'lg'
                   placeholder = 'Enter Task Title'
                   value = {TaskTitle}
                   onChange = {handleTitleChange}
            />
            <Input size = 'lg'
                   placeholder='Enter Task Description'
                   value = {TaskDescription}
                   onChange= {handleDescriptionChange}
            />
            <NumberInput value = {PointValue}
                         onChange = {handlePointChange}
                         defaultValue = '15'
                         min= '0'
                         size = 'lg'           
            >
                <NumberInputField />
                <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                </NumberInputStepper>
            </NumberInput>
            <Button size = 'lg'
                    onClick = {handleAddTask}
                    colorScheme= 'blue'
            >
                Add Task
            </Button>
        </Flex>
    );
}
 
export default TaskCreation;