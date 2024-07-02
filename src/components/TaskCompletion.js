import React, { useEffect, useState } from 'react';
import { Flex, Select } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, getDocs, where, query, onSnapshot } from 'firebase/firestore';
import TaskButton from './TaskButton';

const TaskCompletion = (props) => {
    const [taskList, setTaskList] = useState([]);
    const roomID = props.roomID;
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

    useEffect(() => {
        fetchTasks();
        console.log('fetched tasks');
    },[]);

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
            />
        </Flex>
    );
}
 
export default TaskCompletion;