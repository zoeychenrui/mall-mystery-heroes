import React, { useEffect, useState } from 'react';
import { Flex, Select } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, getDocs, where, query } from 'firebase/firestore';
import TaskButton from './TaskButton';

const TaskCompletion = (props) => {
    const { roomID,
            arrayOfAlivePlayers,
            handlePlayerRevive,
            handleUndoRevive,
            arrayOfTasks,
            handleTaskCompleted,
            completedTasks,
            handleRemapping
        } = props;
    const [taskList, setTaskList] = useState([]);
    const [selectedTask, setSelectedTask] = useState('');

    //fetches tasks that are incomplete and turns tasklist to a list of the options
    const fetchTasks = async () => {
        const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
        const taskCollectionQuery = query(taskCollectionRef, where('isComplete', '==', false));
        const taskSnapshot = await getDocs(taskCollectionQuery);
        const tempTaskList = taskSnapshot.docs.map(doc => (
            <option key = {doc.data().title}
                    value = {doc.id}
            >
                 {doc.data().title}
             </option>
         ));
         setTaskList(tempTaskList);
    }

    //changes selected Task to the task selected
    const handleTaskSelected = (event) => {
        setSelectedTask(event.target.value);
    }

    //logs when selectedTask is changed.
    useEffect(() => {
        console.log(selectedTask);
    }, [selectedTask]);

    //updates tasklist when possible tasks are updated
    useEffect(() => {
        fetchTasks();
        console.log('fetched tasks');
        // disabled below because 'fetchTasks' does not need to be a dependency
        // eslint-disable-next-line
    },[arrayOfTasks, completedTasks]);

    return (  
        <Flex alignItems= 'center'>
            <Select placeholder = 'Select Task' 
                    onChange = {handleTaskSelected}
                    m = '4px'
            >
                {taskList}
            </Select>
            
            <TaskButton 
                taskID = {selectedTask}
                roomID = {roomID}
                handlePlayerRevive = {handlePlayerRevive}
                handleUndoRevive = {handleUndoRevive}
                arrayOfAlivePlayers = {arrayOfAlivePlayers}
                handleTaskCompleted = {handleTaskCompleted}
                handleRemapping = {handleRemapping}
            />
        </Flex>
    );
}
 
export default TaskCompletion;