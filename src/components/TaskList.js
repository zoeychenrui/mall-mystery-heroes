import React, { useEffect, useState } from 'react';
import {
    Tabs,
    Tab,
    Accordion,
    TabPanels,
    TabPanel,
    TabList
    } from '@chakra-ui/react';
import { db } from '../utils/firebase';
import { collection, 
         getDocs 
    } from 'firebase/firestore';
import TaskAccordion from './TaskAccordion';

const TaskList = (props) => {
    const {roomID, arrayOfPlayers} = props;
    const taskCollectionRef = collection(db, 'rooms', roomID, 'tasks');
    const [tasks, setTasks] = useState([]);
    const arrayOfActiveTasks = tasks.filter(eachTask => eachTask.isComplete === false); //filters active tasks
    const arrayOfInactiveTasks = tasks.filter(eachTask => eachTask.isComplete === true); //filters inactive tasks

    // Fetch tasks from Firestore
    const fetchTasks = async () => {
        const taskSnapshot = await getDocs(taskCollectionRef);
        const taskArray = taskSnapshot.docs.map(doc => doc.data());
        setTasks(taskArray);
    }

    //updates tasklists when task is added
    useEffect(() => {
        console.log(`fetching tasks in useEffect: ${roomID}`);
        fetchTasks();
        // eslint-disable-next-line
    }, [props.arrayOfTasks, props.completedTasks]);

    //makes an array where each item contains an accordion item of an active task object
    const listOfActiveTasks = arrayOfActiveTasks.map(eachTask => {
       return (
            <TaskAccordion
                key = {eachTask.title}
                task = {eachTask}
                players = {arrayOfPlayers}
                roomID = {roomID}
                refresh = {fetchTasks}
                arrayOfDeadPlayers = {props.arrayOfDeadPlayers}
                arrayOfPlayers = {props.arrayOfPlayers}
            />
       );
    });

    //makes an array where each item contains an accordion item of an inactive task object
    const listOfInactiveTasks = arrayOfInactiveTasks.map(eachTask => {
        return (
            <TaskAccordion
                 key = {eachTask.title}
                 task = {eachTask}
                 players = {arrayOfPlayers}
                 roomID = {roomID}
                 refresh = {fetchTasks}
                 arrayOfDeadPlayers = {props.arrayOfDeadPlayers}
                 arrayOfPlayers = {props.arrayOfPlayers}
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