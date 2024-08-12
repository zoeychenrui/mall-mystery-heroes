import React, { useState, useEffect, useContext } from 'react';
import { Button, Checkbox, 
         Modal, 
         ModalBody, 
         ModalCloseButton, 
         ModalContent, 
         ModalFooter, 
         ModalHeader, 
         ModalOverlay, 
         useDisclosure,
         Box,
         Image,
         Stack,
         Popover,
         PopoverTrigger,
         PopoverContent,
         PopoverArrow,
         PopoverCloseButton,
         PopoverBody,
         PopoverFooter,
         Text
    } from '@chakra-ui/react';
import CreateAlert from './CreateAlert';
import enter from '../assets/enter-green.png';
import enterHover from '../assets/enter-hovering.png';
import RemapPlayers from './RemapPlayers';
import { updateIsCompleteToTrueForTask, 
         fetchPlayersByStatusForRoom,
         fetchTaskForRoom, 
         updateCompletedByForTask, 
         updatePointsForPlayer, 
         fetchReferenceForTask,
         updateIsAliveForPlayer,
         fetchPlayerForRoom
    } from './dbCalls';
import { executionContext, gameContext } from './Contexts';

const TaskButton = (props) => {    
    const { taskID,
        } = props;
    const { arrayOfAlivePlayers,
            handleAddNewAssassins,
            handleAddNewTargets,
            handleRemapping,
            handlePlayerRevive,
            handleUndoRevive,
            handleTaskCompleted,
            handleSetShowMessageToTrue
        } = useContext(executionContext);
    const { roomID } = useContext(gameContext);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [listOfChoices, setListOfchoices] = useState([]);
    const createAlert = CreateAlert();
    const [checkedPlayers, setCheckedPlayers] = useState([]);
    const [isHovering, setIsHovering] = useState(false);
    const [newCheckedPlayers, setNewCheckedPlayers] = useState([]);
    const [newRemovedPlayers, setNewRemovedPlayers] = useState([]);
    const handleRegeneration = RemapPlayers(handleRemapping, createAlert);

    useEffect (() => {
        const fetchCheckedPlayers = async () => {
            if (!taskID) return;
            const task = await fetchTaskForRoom(taskID, roomID);
            setCheckedPlayers(task.completedBy);
        }       
        if (taskID) fetchCheckedPlayers();
    }, [roomID,taskID])

    //cancels actions made in modal when cancel button is clicked
    const handleCancel = () => {
        setCheckedPlayers(prevCheckedPlayers => {
            let tempCheckedPlayers = [...prevCheckedPlayers];
            for (const player of newCheckedPlayers) {
                tempCheckedPlayers = tempCheckedPlayers.filter(p => p !== player);
            }
            for (const player of newRemovedPlayers) {
                tempCheckedPlayers.push(player);
            }
            return tempCheckedPlayers;
        });
        setNewCheckedPlayers([]);
        setNewRemovedPlayers([]);
        onClose();
    }

    //updates scores/live status when save button is clicked
    const handleSave = async () => {
        try {
            const task = await fetchTaskForRoom(taskID, roomID);
            const taskDocRef = await fetchReferenceForTask(taskID, roomID);
            if (taskDocRef === null) {
                return createAlert('error', 'Error', 'task does not exist', 1500);
            }
            let points = parseInt(task.pointValue);

            //updates player scores for task types
            if (task.taskType === 'Task') {
                //adds points to new updated players
                for (const player of newCheckedPlayers) {
                    await updatePointsForPlayer(player, points, roomID);
                }
                //removes points for those that were initially checked, but now removed
                for (const player of newRemovedPlayers) {
                    const playerDoc = await fetchPlayerForRoom(player, roomID);
                    if (playerDoc.data().isAlive === false) continue;
                    points = points * -1;
                    await updatePointsForPlayer(player, points, roomID);
                }
            }
            //updates player live status for revival missions
            else if (task.taskType === 'Revival Mission') {
                const alivePlayers = [...arrayOfAlivePlayers];
                //revives newly checked players
                for (const player of newCheckedPlayers) {
                    await updateIsAliveForPlayer(player, true, roomID);
                    handlePlayerRevive(player);
                    if (!alivePlayers.includes(player)) {
                        alivePlayers.push(player);
                    }
                }
                //remaps targets and assassins for revived player ONLY
                const [targets, assassins] = await handleRegeneration(newCheckedPlayers, newCheckedPlayers, alivePlayers, roomID);
                handleAddNewAssassins(assassins);
                handleAddNewTargets(targets);
                handleSetShowMessageToTrue();

                //kills those that were initially checked, but now removed
                for (const player of newRemovedPlayers) {
                    await updateIsAliveForPlayer(player, false, roomID);
                    handleUndoRevive(player);
                }
            }
            
            //updates task to be completed by checkedplayers
            await updateCompletedByForTask(taskDocRef, checkedPlayers);
            setNewCheckedPlayers([]);
            setNewRemovedPlayers([]);
            onClose();
        }
        catch (error) {
            console.error(error);
            return createAlert('error', 'Error saving task', 'Check console', 1500);
        }
    }

    //handles when complete button is clicked
    const handleComplete = async() => {
        await handleSave();
        createAlert('info', 'Completed', 'Task has been saved as completed', 1500);
        const task = await fetchTaskForRoom(taskID, roomID);
        await updateIsCompleteToTrueForTask(taskID, roomID);
        const taskTitle = task.title;
        handleTaskCompleted(taskTitle);
        onClose(taskTitle);
    }

    //handles when checkbox is clicked
    const handleCheckedPlayers = (player) => {
        if (checkedPlayers.includes(player)) {
            setCheckedPlayers(checkedPlayers.filter(p => p !== player));
            if (!newCheckedPlayers.includes(player)) {
                setNewRemovedPlayers([...newRemovedPlayers, player]);   
            }
            setNewCheckedPlayers(newCheckedPlayers.filter(p => p !== player));
        }
        else {
            setCheckedPlayers([...checkedPlayers, player]);
            setNewCheckedPlayers([...newCheckedPlayers, player]);
            setNewRemovedPlayers(newRemovedPlayers.filter(p => p !== player));
        }   
    }
    
    //handles when image is clicked
    const handleEnterClicked = () => {
        //error when selected task is blank
        if (taskID === '') {
            createAlert('error', 'Error', 'Error: no task selected', 1500);
            return;
        }
        onOpen();
    }

    //creates listOfChoices based on the task type
    const createListOfChoices = async () => {
        //error when task is blank
        if (!taskID || taskID === '') {
            setListOfchoices([]);
            console.error('taskID not defined');
            return;
        }
        //fetches task
        const task = await fetchTaskForRoom(taskID, roomID);
        //alive players are shown for tasks
        if (task.taskType === 'Task') {
            let tempList = await fetchPlayersByStatusForRoom(true, roomID);
            for (const player of task.completedBy) {
                if (!tempList.includes(player)) {
                    tempList.push(player);
                }
            }
            setListOfchoices(tempList);
        }
        //dead players are shown for revival missions
        else if (task.taskType === 'Revival Mission') {
            let tempList = await fetchPlayersByStatusForRoom(false, roomID);
            for (const player of task.completedBy) {
                if (!tempList.includes(player)) {
                    tempList.push(player);
                }
            }            
            setListOfchoices(tempList);
        }
        //error when invalid task type
        else {
            console.error('invalid task type');
        }
    }

    //updates ListofChoices when the task changes
    useEffect(() => {
        const fetchCheckedPlayersAndCreateChoices = async () => {
            await createListOfChoices();
        }
        
        if (taskID) {
            fetchCheckedPlayersAndCreateChoices();
        }
        console.log('task changed. List of choices updated');
        //disabled below becaue 'createListOfchoices' does not need to be in dependency array
        //eslint-disable-next-line
    }, [roomID, taskID])

    useEffect(() => {
        console.log('listOfChoices:', listOfChoices);
    }, [listOfChoices])

    return (
        <Box onMouseEnter = {() => setIsHovering(true)} 
             onMouseLeave = {() => setIsHovering(false)}
             m = '4px'
        >
            <Image 
                src = {isHovering ? enterHover : enter}
                alt = 'Enter'
                width = '60px'
                height = '48px'
                cursor = 'pointer'
                onClick = {handleEnterClicked}
            />

            <Modal isOpen = {isOpen}
                   onClose = {onClose}
                   onOpen = {onOpen}
            >
                <ModalOverlay>
                    <ModalContent backgroundColor = "rgb(32,32,48)"
                                  borderRadius = '2xl'
                    >
                        <ModalHeader>
                            Who Has Completed The Task? 
                        </ModalHeader>
                        <ModalCloseButton />
                        <ModalBody>
                            <Stack>
                                {listOfChoices.map(player => (
                                    <Checkbox
                                        key = {player}
                                        value = {player}
                                        isChecked = {checkedPlayers.includes(player)}
                                        onChange = {() => handleCheckedPlayers(player)}
                                    >
                                        {player}
                                    </Checkbox>
                                ))}
                            </Stack>
                        </ModalBody>

                        <ModalFooter>
                            <Button onClick = {handleCancel}
                                    backgroundColor = 'red'
                                    color = 'white'
                            >
                                Cancel
                            </Button>
                            <Button onClick = {handleSave}
                                    backgroundColor = 'blue.500'
                                    color = 'white'
                            >
                                Save Changes
                            </Button>
                            <Popover>
                                <PopoverTrigger>
                                    <Button backgroundColor = 'green.500'
                                            color = 'white'
                                    >
                                        Complete Task
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent backgroundColor = "rgb(32,32,48)">
                                    <PopoverArrow />
                                    <PopoverCloseButton />
                                    <PopoverBody>
                                        <Text>Confirm that task is finalized.</Text>
                                        <Text>Players: {checkedPlayers.join(', ')}</Text>
                                    </PopoverBody>
                                    <PopoverFooter>
                                        <Button onClick = {handleComplete}
                                                backgroundColor = 'green.500'
                                                color = 'white'
                                        >
                                            Confirm
                                        </Button>
                                    </PopoverFooter>
                                </PopoverContent>
                            </Popover>
                        </ModalFooter>
                    </ModalContent>
                </ModalOverlay>
            </Modal>
        </Box>

    );
}
 
export default TaskButton;