import React, { useEffect, useState } from 'react';
import { Tabs, Tab, Accordion, TabPanels, TabPanel, TabList } from '@chakra-ui/react';
import PlayerTaskAccordion from './PlayerTaskAccordion';
import { fetchTasksByCompletionForRoom, fetchTasksQueryForRoom } from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import CreateAlert from '../CreateAlert';

// Read-only sibling of TaskList.js, for the player-facing "View Missions"
// popup — same Active/Completed tabs, same live subscription, but takes
// `roomID` as a prop instead of reading gameContext: PlayerGame.js (the
// only place this mounts) has no gameContext.Provider around it, unlike
// GameMasterView.js, so it passes roomID down the same way it already
// does to MessageFeed/MessageComposer.
const PlayerTaskList = ({ roomID }) => {
    const [arrayOfActiveTasks, setArrayOfActiveTasks] = useState([]);
    const [arrayOfInactiveTasks, setArrayOfInactiveTasks] = useState([]);
    const createAlert = CreateAlert();
    const taskQuery = fetchTasksQueryForRoom(roomID);

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

    const listOfActiveTasks = arrayOfActiveTasks.map((eachTask) => (
        <PlayerTaskAccordion key={eachTask.title} task={eachTask} />
    ));

    const listOfInactiveTasks = arrayOfInactiveTasks.map((eachTask) => (
        <PlayerTaskAccordion key={eachTask.title} task={eachTask} />
    ));

    return (
        <Tabs>
            <TabList>
                <Tab fontSize="sm" fontWeight="bold">
                    {' '}
                    Active ({arrayOfActiveTasks.length})
                </Tab>
                <Tab fontSize="sm" fontWeight="bold">
                    Completed ({arrayOfInactiveTasks.length})
                </Tab>
            </TabList>
            <TabPanels>
                <TabPanel>
                    <Accordion allowToggle>{listOfActiveTasks}</Accordion>
                </TabPanel>
                <TabPanel>
                    <Accordion allowToggle>{listOfInactiveTasks}</Accordion>
                </TabPanel>
            </TabPanels>
        </Tabs>
    );
};

export default PlayerTaskList;
