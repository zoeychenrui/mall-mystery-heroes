import React, { useContext, useEffect, useState } from 'react';
import {
    Tabs,
    Tab,
    Accordion,
    TabPanels,
    TabPanel,
    TabList,
    Button,
    Box,
    Divider,
} from '@chakra-ui/react';
import TaskAccordion from './TaskAccordion';
import { fetchTasksByCompletionForRoom, fetchTasksQueryForRoom } from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import CreateAlert from '../CreateAlert';
import { gameContext } from '../Contexts';

const TaskList = ({ onStartMission }) => {
    const { roomID } = useContext(gameContext);
    const [arrayOfActiveTasks, setArrayOfActiveTasks] = useState([]);
    const [arrayOfInactiveTasks, setArrayOfInactiveTasks] = useState([]);
    const createAlert = CreateAlert();
    const taskQuery = fetchTasksQueryForRoom(roomID);

    // fetchTasksByCompletionForRoom throws on failure rather than swallowing
    // (docs/improvements.md item 10) — surfaced with createAlert rather than
    // console.error only, since item 15 remounted this as TaskListModal and a
    // failure here is visible to the GM again.
    const fetchTaskForRooms = async () => {
        try {
            const activeTasks = await fetchTasksByCompletionForRoom(false, roomID);
            const inactiveTasks = await fetchTasksByCompletionForRoom(true, roomID);
            setArrayOfActiveTasks(activeTasks.docs.map((doc) => doc.data()));
            setArrayOfInactiveTasks(inactiveTasks.docs.map((doc) => doc.data()));
        } catch (error) {
            console.error('Error fetching tasks: ', error);
            createAlert('error', 'Error fetching missions', error.message, 1500);
        }
    };

    useEffect(() => {
        const unsubscribe = onSnapshot(taskQuery, () => {
            fetchTaskForRooms();
        });

        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    //makes an array where each item contains an accordion item of an active task object
    const listOfActiveTasks = arrayOfActiveTasks.map((eachTask) => {
        return <TaskAccordion key={eachTask.title} task={eachTask} />;
    });

    //makes an array where each item contains an accordion item of an inactive task object
    const listOfInactiveTasks = arrayOfInactiveTasks.map((eachTask) => {
        return <TaskAccordion key={eachTask.title} task={eachTask} />;
    });

    return (
        <Box display="flex" flexDirection="column" flex="1" minH={0}>
            <Tabs display="flex" flexDirection="column" flex="1" minH={0} overflow="hidden">
                <TabList flexShrink={0}>
                    <Tab fontSize="sm" fontWeight="bold" w="50%">
                        {' '}
                        Active ({arrayOfActiveTasks.length})
                    </Tab>
                    <Tab fontSize="sm" fontWeight="bold" w="50%">
                        Completed ({arrayOfInactiveTasks.length})
                    </Tab>
                </TabList>
                <TabPanels flex="1" minH={0} overflow="hidden" px={1}>
                    <TabPanel h="100%" overflowY="auto" px={2}>
                        <Accordion allowToggle>{listOfActiveTasks}</Accordion>
                    </TabPanel>
                    <TabPanel h="100%" overflowY="auto" px={2}>
                        <Accordion allowToggle>{listOfInactiveTasks}</Accordion>
                    </TabPanel>
                </TabPanels>
            </Tabs>
            <Divider />
            <Button
                borderRadius="3xl"
                onClick={onStartMission}
                colorScheme="blue"
                my={2}
                flexShrink={0}
            >
                Start Mission
            </Button>
        </Box>
    );
};

export default TaskList;
