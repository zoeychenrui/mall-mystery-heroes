import React from "react";
import TaskList from "./TaskList";
import TaskCreation from "./TaskCreation";
import { Heading,
         Box,
    } from '@chakra-ui/react';
const TaskExecution = ({ arrayOfTasks, roomID, arrayOfPlayers, handleNewTaskAdded, completedTasks }) => {

    return (  
        <>
            <Box flex = '1' overflow = 'auto'>
                <Heading size = 'lg' textAlign = 'center'>Missions</Heading>
                <TaskList 
                    roomID = {roomID}
                    arrayOfTasks = {arrayOfTasks}
                    completedTasks = {completedTasks}                 
                />
            </Box>
            <Box >
                <TaskCreation
                    roomID = {roomID}
                    onNewTaskAdded = {handleNewTaskAdded}
                    arrayOfPlayers = {arrayOfPlayers}
                />      
            </Box>
        </>
    );
}
 
export default TaskExecution;