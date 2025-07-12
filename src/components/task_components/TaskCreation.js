import React, { useContext, useEffect, useState } from 'react';
import {Input, 
        Button, 
        Flex,
        NumberInput,
        NumberInputField,
        NumberDecrementStepper,
        NumberIncrementStepper,
        NumberInputStepper,
        Select,
        Box
    } from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import { addTaskForRoom, checkForTaskDupesForRoom, fetchTaskIndexThenIncrement } from '../firebase_calls/dbCalls';
import { gameContext, taskContext } from '../Contexts';

const TaskCreation = () => {
    const { handleNewTaskAdded } = useContext(taskContext);
    const { roomID } = useContext(gameContext);
    const [TaskTitle, setTaskTitle] = useState('');
    const [TaskDescription, setTaskDescription] = useState('');
    const [PointValue, setPointValue] = useState('0');
    const time = new Date();
    const [selectedTaskType, setSelectedTaskType] = useState('');
    const createAlert = CreateAlert();
    const [disableNumberInput, setDisableNumberInput] = useState(false);

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
        if (event.target.value === 'Revival Mission') {
            setDisableNumberInput(true); 
            setPointValue('0');           
        }
        else {
            setDisableNumberInput(false);
        }
        console.log(selectedTaskType);
    }

    //handles task submisison
    const handleAddTask = async () => {
        const titleTrimmedLowerCase = TaskTitle.replace(/\s/g, '').toLowerCase();
        const taskIndex = await fetchTaskIndexThenIncrement(roomID);

        let newTask = {
            title: TaskTitle,
            titleTrimmedLowerCase: titleTrimmedLowerCase,
            description: TaskDescription,
            pointValue: PointValue,
            taskType: selectedTaskType,
            taskIndex: taskIndex,
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

        const dupeExists = await checkForTaskDupesForRoom(newTask, roomID);
        if (!dupeExists) {
            await addTaskForRoom(newTask, roomID);
            handleNewTaskAdded(newTask);
            setTaskTitle('');
            setTaskDescription('');
            setPointValue('0');
            setSelectedTaskType('');
            createAlert('success', 'Task Added', 'Your task has been created', 1500);
        }
        if (dupeExists) {
            createAlert('error', 'Error', 'Task already exists', 1500);
        }
    }

    useEffect(() => {
        console.log(`usingEffect selectedTaskType: ${selectedTaskType}`);
    }, [selectedTaskType]);

    return (  
        <Flex m = '6px' direction = 'column'>
            <Flex mb = '4px'>
                <Input 
                    sx = {styles.titleInput}
                    value = {TaskTitle}
                    onChange = {handleTitleChange}
                    placeholder = "Task Title"
                />
                <Input 
                    placeholder = 'Description'
                    value = {TaskDescription}
                    onChange= {handleDescriptionChange}
                />
            </Flex>

            <Flex>
                <Select
                    sx = {styles.taskTypeSelection}
                    placeholder = 'Select Task Type'
                    value = {selectedTaskType}
                    onChange = {handleChangeTaskType}
                >
                    <option value = 'Task'>Task</option>
                    <option value = 'Revival Mission'>Revival Mission</option>
                </Select>
                
                <NumberInput 
                    style = {styles.pointInput}
                    value = {PointValue}
                    onChange = {handlePointChange}
                    isDisabled = {disableNumberInput}
                    m = '2px'
                    marginX = '4px'
                >
                    <NumberInputField />
                    <NumberInputStepper>
                        <NumberIncrementStepper color = 'white'/>
                        <NumberDecrementStepper color = 'white'/>
                    </NumberInputStepper>
                </NumberInput>
                
                <Button 
                    sx = {styles.addButton}
                    onClick = {handleAddTask}
                    colorScheme = 'blue'
                >
                    Add
                </Button>
            </Flex>
        </Flex>
    );
}
 
const styles = {
    titleInput: {
        size: 'md',
        borderRadius: '2xl',
        m: '2px'
    },
    descInput: {
        borderRadius: '2xl',
        m: '2px'
    },
    taskTypeSelection: {
        size: 'md',
        borderRadius: '2xl',
        m: '2px'
    },
    addButton: {
        size: 'md',
        width: '20%',
        m: '2px'
    },
    pointInput: {
        defaultValue: '15',
        min: '0',
        size: 'md',
    }
}
export default TaskCreation;