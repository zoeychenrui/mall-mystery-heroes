import {
    AccordionIcon,
    AccordionButton,
    AccordionItem,
    AccordionPanel,
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    Button,
    Text,
    useDisclosure,
} from '@chakra-ui/react';
import React, { useContext, useRef, useState } from 'react';
import { gameContext, executionContext } from '../Contexts';
import { deleteTaskForRoom, addPlayerMessageForRoom } from '../firebase_calls/dbCalls';
import CreateAlert from '../CreateAlert';
import TaskEditModal from './TaskEditModal';

const TaskAccordion = (props) => {
    const task = props.task;
    const { roomID } = useContext(gameContext);
    const { addLog } = useContext(executionContext);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
    const cancelRef = useRef();
    const createAlert = CreateAlert();

    const handleConfirmDelete = async () => {
        try {
            await deleteTaskForRoom(task.taskIndex, roomID);
            await addLog(`Mission "${task.title}" was deleted`, 'red.400');
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: `Mission ${task.title} was deleted`,
                    standings: null,
                },
                roomID
            );
        } catch (error) {
            console.error('Error deleting mission:', error);
            createAlert('error', 'Error deleting mission', error.message, 1500);
        } finally {
            onDeleteClose();
        }
    };

    return (
        <AccordionItem key={task.title} fontSize="md">
            <AccordionButton>
                <Text as="span" flex="1" textAlign="left" m="4px">
                    {task.taskIndex}. {task.title}
                </Text>
                <Text m="4px" mr="10px">
                    {task.pointValue}
                </Text>
                <AccordionIcon />
            </AccordionButton>
            <AccordionPanel>
                <Text pb="12px">Description: {task.description}</Text>
                <Text pb="12px">Task Type: {task.taskType}</Text>
                <Text pb="12px">
                    Completions: {task.completedBy.length}
                    {task.maxCompletions ? ` / ${task.maxCompletions}` : ''}
                </Text>
                <Text pb="12px">
                    {task.completedBy.length === '0' || !task.isComplete
                        ? 'Incomplete'
                        : `Completed By: ${task.completedBy.length === '0' ? 'None' : task.completedBy.join(', ')}`}
                </Text>
                <Button size="sm" mr={2} onClick={() => setIsEditOpen(true)}>
                    Edit
                </Button>
                <Button size="sm" colorScheme="red" onClick={onDeleteOpen}>
                    Delete
                </Button>
            </AccordionPanel>
            {/*
                Mounted only while open. TaskEditModal seeds each form
                field from the `task` prop in a useState initializer,
                which runs once per mount — kept permanently mounted, a
                GM who typed an edit and then clicked "Close" would find
                that discarded text still in the form on reopen, and
                saving would write it.
            */}
            {isEditOpen && (
                <TaskEditModal
                    isOpen={isEditOpen}
                    onClose={() => setIsEditOpen(false)}
                    task={task}
                    roomID={roomID}
                    addLog={addLog}
                />
            )}
            <AlertDialog
                isOpen={isDeleteOpen}
                leastDestructiveRef={cancelRef}
                onClose={onDeleteClose}
            >
                <AlertDialogOverlay />
                <AlertDialogContent bg="#202030">
                    <AlertDialogHeader color="red">WARNING</AlertDialogHeader>
                    <AlertDialogBody color="#FFFFFF">
                        Delete {task.title}? This cannot be undone.
                        {task.completedBy.length > 0 && (
                            <Text mt={2}>
                                {task.completedBy.length} player
                                {task.completedBy.length === 1 ? '' : 's'} already completed this
                                mission.
                            </Text>
                        )}
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={onDeleteClose} colorScheme="red">
                            Go Back
                        </Button>
                        <Button colorScheme="green" onClick={handleConfirmDelete}>
                            Confirm
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AccordionItem>
    );
};

export default TaskAccordion;
