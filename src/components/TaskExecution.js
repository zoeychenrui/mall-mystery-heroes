import React from "react";
import TaskList from "./TaskList";
import TaskCreation from "./TaskCreation";
import { Heading,
         Box,
    } from '@chakra-ui/react';
const TaskExecution = () => {

    return (  
        <>
            <Box flex = '1' overflow = 'auto'>
                <Heading size = 'lg' textAlign = 'center'>Missions</Heading>
                <TaskList />
            </Box>
            <Box >
                <TaskCreation />      
            </Box>
        </>
    );
}
 
export default TaskExecution;