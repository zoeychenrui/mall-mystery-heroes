import React, { useContext, useEffect, useState } from 'react';
import {
    Tabs,
    Tab,
    Accordion,
    TabPanels,
    TabPanel,
    TabList
    } from '@chakra-ui/react';
import TaskAccordion from './TaskAccordion';
import { fetchTasksByCompletionForRoom, fetchTasksQueryForRoom } from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import { gameContext } from '../Contexts';

const TaskList = () => {
    const { roomID } = useContext(gameContext);
    const [arrayOfActiveTasks, setArrayOfActiveTasks] = useState([]);
    const [arrayOfInactiveTasks, setArrayOfInactiveTasks] = useState([]);
    const taskQuery = fetchTasksQueryForRoom(roomID);

    // Fetch tasks from Firestore
    const fetchTaskForRooms = async () => {
        const activeTasks = await fetchTasksByCompletionForRoom(false, roomID);
        const inactiveTasks = await fetchTasksByCompletionForRoom(true, roomID);
        setArrayOfActiveTasks(activeTasks.docs.map(doc => doc.data()));
        setArrayOfInactiveTasks(inactiveTasks.docs.map(doc => doc.data()));
    }

    useEffect(() => {
        const unsubscribe = onSnapshot(taskQuery, () => {
            fetchTaskForRooms();
            console.log('running unsubscribe');
        })

        return () => unsubscribe();
        //eslint-disable-next-line
    }, [])

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
                <Tab fontSize = 'sm' fontWeight = 'bold'> Active ({arrayOfActiveTasks.length})</Tab>
                <Tab fontSize = 'sm' fontWeight = 'bold'>Completed ({arrayOfInactiveTasks.length})</Tab>
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