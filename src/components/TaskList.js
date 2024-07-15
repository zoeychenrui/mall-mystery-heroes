import React, { useEffect, useState } from 'react';
import {
    Tabs,
    Tab,
    Accordion,
    TabPanels,
    TabPanel,
    TabList
    } from '@chakra-ui/react';
import TaskAccordion from './TaskAccordion';
import { fetchActiveTasksForRoom, fetchInactiveTasksForRoom } from './dbCalls';

const TaskList = (props) => {
    const { roomID, arrayOfTasks, completedTasks } = props;
    const [arrayOfActiveTasks, setArrayOfActiveTasks] = useState([]);
    const [arrayOfInactiveTasks, setArrayOfInactiveTasks] = useState([]);

    // Fetch tasks from Firestore
    const fetchTaskForRooms = async () => {
        const activeTasks = await fetchActiveTasksForRoom(roomID);
        const inactiveTasks = await fetchInactiveTasksForRoom(roomID);
        setArrayOfActiveTasks(activeTasks.docs.map(doc => doc.data()));
        setArrayOfInactiveTasks(inactiveTasks.docs.map(doc => doc.data()));
    }

    //updates tasklists when task is added
    useEffect(() => {
        console.log(`fetching tasks in useEffect: ${roomID}`);
        fetchTaskForRooms();
        // eslint-disable-next-line
    }, [arrayOfTasks, completedTasks, roomID]);

    //makes an array where each item contains an accordion item of an active task object
    const listOfActiveTasks = arrayOfActiveTasks.map(eachTask => {
       return (
            <TaskAccordion
                key = {eachTask.title}
                task = {eachTask}
            />
       );
    });

    //makes an array where each item contains an accordion item of an inactive task object
    const listOfInactiveTasks = arrayOfInactiveTasks.map(eachTask => {
        return (
            <TaskAccordion
                 key = {eachTask.title}
                 task = {eachTask}
            />
        );
    });

     return (  
        <Tabs>
            <TabList>
                <Tab fontSize = 'md' fontWeight = 'bold'>Active Tasks ({arrayOfActiveTasks.length})</Tab>
                <Tab fontSize = 'md' fontWeight = 'bold'>Completed Tasks ({arrayOfInactiveTasks.length})</Tab>
            </TabList>
            <TabPanels>
                <TabPanel>
                    <Accordion allowToggle>
                        {listOfActiveTasks}
                    </Accordion>
                </TabPanel>
                <TabPanel>
                    <Accordion allowToggle>
                        {listOfInactiveTasks}
                    </Accordion>
                </TabPanel>
            </TabPanels>
        </Tabs> 
    );
}
 
export default TaskList;