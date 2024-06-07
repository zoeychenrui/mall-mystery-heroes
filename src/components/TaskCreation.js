import React, { useState } from 'react';
import {Input, 
        Button, 
        Flex,
        NumberInput,
        NumberInputField,
        NumberDecrementStepper,
        NumberIncrementStepper,
        NumberInputStepper,
        useToast
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
    const [PointValue, setPointValue] = useState('15');
    const roomID = props.roomID;
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const toast = useToast();
    const time = new Date();
    const [error, setError] = useState('');

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
            completedBy: []
        };
        if (newTask.title === '') {
            setError("Task title cannot be blank");
            toast ({
                title: 'Error',
                description: error,
                status: 'error',
                duration: 1500,
                isClosable: true,
            });
            return;
        }
        if (newTask.pointValue === 0) {
            setError("Task cannot have 0 points");
            toast ({
                title: 'Error',
                description: error,
                status: 'error',
                duration: 1500,
                isClosable: true,
            });
            return;
        }
        if (newTask.description === '') {
            newTask.description = 'No description provided';
        }
        const checkTaskQuery = query(taskCollectionRef, where('title', '==', newTask.title));
        const checkTaskSnapshot = await getDocs(checkTaskQuery);
        if (checkTaskSnapshot.empty) {
            await addDoc(taskCollectionRef, newTask);
        }
        else {
            console.error("Error adding task: title already exists");
            setError("Error adding task: title already exists");
            toast ({
                title: 'Error',
                description: error,
                status: 'error',
                duration: 1500,
                isClosable: true,
            });
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