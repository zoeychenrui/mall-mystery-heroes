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
import TaskCreation from './TaskCreation';
import { taskContext } from '../Contexts';

const TaskCreationModal = ({ isOpen, onClose, handleNewTaskAdded }) => {
    // /mission start opens this modal synchronously, while the same Enter
    // keystroke that submitted the command is still being dispatched — its
    // keyup lands on whatever now has focus. Chakra's focus trap always
    // moves focus into the modal, defaulting to the first focusable
    // descendant — normally ModalCloseButton — so that stray keyup was
    // landing on the close button and its native Enter-activates-buttons
    // behavior was clicking it, closing the modal the instant it opened.
    // Pointing initialFocusRef at a plain text input sidesteps it: a text
    // input has no activate-on-Enter behavior to (mis)trigger.
    const titleInputRef = useRef(null);

    return (
        <Modal isOpen={isOpen} onClose={onClose} initialFocusRef={titleInputRef}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Create a Mission</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <taskContext.Provider value={{ handleNewTaskAdded }}>
                        <TaskCreation ref={titleInputRef} />
                    </taskContext.Provider>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskCreationModal;
