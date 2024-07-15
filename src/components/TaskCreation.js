import React, { useEffect, useState } from 'react';
import {Input, 
        Button, 
        Flex,
        NumberInput,
        NumberInputField,
        NumberDecrementStepper,
        NumberIncrementStepper,
        NumberInputStepper,
        Select
    } from '@chakra-ui/react';
import CreateAlert from './CreateAlert';
import { addTaskForRoom, checkForTaskDupesForRoom } from './dbCalls';

const TaskCreation = ({roomID, onNewTaskAdded}) => {
    const [TaskTitle, setTaskTitle] = useState('');
    const [TaskDescription, setTaskDescription] = useState('');
    const [PointValue, setPointValue] = useState('0');
    const time = new Date();
    const [selectedTaskType, setSelectedTaskType] = useState('');
    const createAlert = CreateAlert();

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
        
        //error handling for no task type selected
        if (newTask.taskType === '') {
            return createAlert('error', 'Error', 'Task type must be selected', 1500);
        }
        //error handling for blank title
        if (newTask.title === '') {
            return createAlert('error', 'Error', 'Task title cannot be blank', 1500);
        }
        //error handling for task with 0 points
        if (newTask.pointValue === '0' && newTask.taskType === 'Task') {
            return createAlert('error', 'Error', 'Task cannot have 0 points', 1500);
        }
        //handling for blank description
        if (newTask.description === '') {
            newTask.description = 'No description provided';
        }
        //sets points to 0 for revival misisons
        if (newTask.taskType === 'Revival Mission') {
            newTask.pointValue = 0;
        }

        const dupeExists = await checkForTaskDupesForRoom(newTask, roomID, createAlert);
        if (!dupeExists) {
            await addTaskForRoom(newTask, roomID);
            onNewTaskAdded(newTask);
            createAlert('success', 'Task Added', 'Your task has been created', 1500);
        }
    }

    useEffect(() => {
        console.log(`usingEffect selectedTaskType: ${selectedTaskType}`);
    }, [selectedTaskType]);

    return (  
        <Flex m = '6px' direction = 'column'>
            <Flex mb = '4px'>
                <Input size = 'md'
                        borderRadius = '2xl'
                        placeholder = 'Task Title'
                        value = {TaskTitle}
                        onChange = {handleTitleChange}
                    />
                    <Input size = 'md'
                        borderRadius = '2xl'
                        placeholder='Description'
                        value = {TaskDescription}
                        onChange= {handleDescriptionChange}
                    />
            </Flex>

            <Flex>
                <Select size='md'
                        borderRadius = '2xl'
                        placeholder = 'Select Task Type'
                        value = {selectedTaskType}
                        onChange = {handleChangeTaskType}
                        m = '2px'

                >
                    <option value = 'Task'>Task</option>
                    <option value = 'Revival Mission'>Revival Mission</option>
                </Select>
                <NumberInput value = {PointValue}
                             onChange = {handlePointChange}
                             defaultValue = '15'
                             min= '0'
                             size = 'md'
                             m = '2px'
                >
                    <NumberInputField />
                    <NumberInputStepper>
                        <NumberIncrementStepper color = 'white'/>
                        <NumberDecrementStepper color = 'white'/>
                    </NumberInputStepper>
                </NumberInput>
                <Button size = 'md'
                        onClick = {handleAddTask}
                        colorScheme= 'blue'
                        width = '20%'
                        m = '2px'
                >
                    Add
                </Button>
        </Flex>
        </Flex>
    );
}
 
export default TaskCreation;