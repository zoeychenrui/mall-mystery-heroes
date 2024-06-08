import React, { useEffect, useState } from 'react';
import {Input, 
        Button, 
        Flex,
        NumberInput,
        NumberInputField,
        NumberDecrementStepper,
        NumberIncrementStepper,
        NumberInputStepper,
        useToast,
        Select
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
    const [PointValue, setPointValue] = useState('0');
    const roomID = props.roomID;
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const toast = useToast();
    const time = new Date();
    const [error, setError] = useState('');
    const [selectedTaskType, setSelectedTaskType] = useState('');

    //stores task description
    const handleDescriptionChange = (event) => {
        setTaskDescription(event.target.value);
    }

    //stores task title
    const handleTitleChange = (event) => {
        setTaskTitle(event.target.value);
    }

    //stores point value
    const handlePointChange = (value) => {
        setPointValue(value);
    }

    //stores task type
    const handleChangeTaskType = (event) => {
        setSelectedTaskType(event.target.value);
        console.log(selectedTaskType);
    }

    //handles task submisison
    const handleAddTask = async () => {
        let newTask = {
            title: TaskTitle,
            description: TaskDescription,
            pointValue: PointValue,
            taskType: selectedTaskType,
            dateCreated: time.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
            isComplete: false,
            completedBy: []
        };

        //error handling for blank title
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

        //error handling for task with 0 points
        console.log (`before Testing: ${newTask.taskType}`);
        if (newTask.pointValue === 0 && newTask.taskType === 'Task') {
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
        
        //handling for blank description
        if (newTask.description === '') {
            newTask.description = 'No description provided';
        }
        
        if (newTask.taskType === 'Revival Mission') {
            newTask.pointValue = 0;
        }

        if (newTask.taskType === 'Open Season') {
            newTask.pointValue = 0;
        }

        const checkTaskQuery = query(taskCollectionRef, where('title', '==', newTask.title));
        const checkTaskSnapshot = await getDocs(checkTaskQuery); 
        //adds new document for new tasks
        if (checkTaskSnapshot.empty) {
            await addDoc(taskCollectionRef, newTask);
        }
        //error handling for duplicate titles
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

    useEffect(() => {
        console.log(`usingEffect selectedTaskType: ${selectedTaskType}`);
    }, [selectedTaskType]);
    return (  
        <Flex margin = '5px'>
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
            <Select size='lg'
                    placeholder = 'Select Task Type'
                    value = {selectedTaskType}
                    onChange = {handleChangeTaskType}

            >
                <option value = 'Task'>Task</option>
                <option value = 'Revival Mission'>Revival Mission</option>
                <option value = 'Open Season'>Open Season</option>
            </Select>
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