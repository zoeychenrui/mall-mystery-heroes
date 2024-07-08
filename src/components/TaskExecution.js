import React from "react";
import TaskList from "./TaskList";
import TaskCreation from "./TaskCreation";
import { Heading,
         Box,
    } from '@chakra-ui/react';
const TaskExecution = ({ arrayOfTasks, roomID, arrayOfPlayers, arrayOfDeadPlayers, handleNewTaskAdded, completedTasks }) => {

    return (  
        <>
            <Box flex = '1' overflow = 'auto'>
                <Heading size = 'lg' textAlign = 'center'>Missions</Heading>
                <TaskList 
                    arrayOfTasks = {arrayOfTasks}
                    roomID = {roomID}
                    arrayOfPlayers = {arrayOfPlayers}
                    DeadPlayers = {arrayOfDeadPlayers}   
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