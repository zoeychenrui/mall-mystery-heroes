import React, { useContext, useEffect, useState } from 'react';
import { Flex, Select } from '@chakra-ui/react';
import TaskButton from './TaskButton';
import { fetchTasksByCompletionForRoom } from './dbCalls';
import { executionContext, gameContext } from './Contexts';

const TaskCompletion = () => {
    const { arrayOfTasks, completedTasks } = useContext(executionContext);
    const { roomID } = useContext(gameContext);
    const [taskList, setTaskList] = useState([]);
    const [selectedTask, setSelectedTask] = useState('');

    //fetches tasks that are incomplete and turns tasklist to a list of the options
    const fetchTaskForRooms = async () => {
        const taskSnapshot = await fetchTasksByCompletionForRoom(false, roomID);
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
        fetchTaskForRooms();
        console.log('fetched tasks');
        // disabled below because 'fetchTaskForRooms' does not need to be a dependency
        // eslint-disable-next-line
    },[arrayOfTasks, completedTasks]);

    useEffect (() => {
        setSelectedTask('');
    }, [roomID]);

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
            />
        </Flex>
    );
}
 
export default TaskCompletion;