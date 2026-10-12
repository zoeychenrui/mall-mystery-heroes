import {
    Button,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
} from '@chakra-ui/react';
import React, { useRef } from 'react';
import TaskList from './TaskList';

const TaskListModal = ({ isOpen, onClose }) => {
    // /mission view opens this modal synchronously, while the Enter
    // keystroke that submitted the command is still being dispatched — see
    // the comment in TaskCreationModal.js for the full mechanism. TaskList's
    // first focusable descendants are Chakra Tabs, which activate on Enter
    // same as a button (each mission's Edit/Delete buttons only enter the
    // tab order once its accordion panel is expanded, so they don't affect
    // this), so there's no safe input to target here — instead the trap is
    // pointed at the body container itself, a plain, non-activating
    // element.
    const bodyRef = useRef(null);

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="xl" initialFocusRef={bodyRef}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Missions</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody ref={bodyRef} tabIndex={-1}>
                    <TaskList />
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskListModal;
