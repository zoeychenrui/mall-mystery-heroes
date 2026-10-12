import React, { useContext, useEffect, useState } from 'react';
import {
    Input,
    Button,
    Flex,
    NumberInput,
    NumberInputField,
    NumberDecrementStepper,
    NumberIncrementStepper,
    NumberInputStepper,
    Select,
} from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import {
    addTaskForRoom,
    checkForTaskDupesForRoom,
    fetchTaskIndexThenIncrement,
} from '../firebase_calls/dbCalls';
import { gameContext, taskContext } from '../Contexts';

const TaskCreation = React.forwardRef((props, titleInputRef) => {
    const { handleNewTaskAdded } = useContext(taskContext);
    const { roomID } = useContext(gameContext);
    const [TaskTitle, setTaskTitle] = useState('');
    const [TaskDescription, setTaskDescription] = useState('');
    const [PointValue, setPointValue] = useState('0');
    const [MaxCompletions, setMaxCompletions] = useState('');
    const time = new Date();
    const [selectedTaskType, setSelectedTaskType] = useState('');
    const createAlert = CreateAlert();
    const [disableNumberInput, setDisableNumberInput] = useState(false);

    //stores task description
    const handleDescriptionChange = (event) => {
        setTaskDescription(event.target.value);
    };

    //stores task title
    const handleTitleChange = (event) => {
        setTaskTitle(event.target.value);
    };

    //stores point value
    const handlePointChange = (value) => {
        setPointValue(value);
    };

    //stores the optional completion cap
    const handleMaxCompletionsChange = (value) => {
        setMaxCompletions(value);
    };

    //stores task type
    const handleChangeTaskType = (event) => {
        setSelectedTaskType(event.target.value);
        if (event.target.value === 'Revival Mission') {
            setDisableNumberInput(true);
            setPointValue('0');
        } else {
            setDisableNumberInput(false);
        }
        console.log(selectedTaskType);
    };

    //handles task submisison
    //
    // fetchTaskIndexThenIncrement throws on failure rather than swallowing
    // errors (docs/improvements.md item 10) — this function had no try/catch
    // at all, so a failure would have been an unhandled promise rejection.
    //
    // The index is fetched last, only once every validation check and the
    // dupe check have already passed — fetchTaskIndexThenIncrement
    // atomically consumes a taskIndex the moment it's called, whether or not
    // a task ends up created with it. Fetching it up front (the previous
    // order) meant a failed submission — wrong task type, blank title, a
    // duplicate title — permanently burned an index with no task ever using
    // it, so the next successful creation skipped a number.
    const handleAddTask = async () => {
        const titleTrimmedLowerCase = TaskTitle.replace(/\s/g, '').toLowerCase();

        const newTask = {
            title: TaskTitle,
            titleTrimmedLowerCase: titleTrimmedLowerCase,
            description: TaskDescription,
            pointValue: PointValue,
            taskType: selectedTaskType,
            // Optional — blank means unlimited, same as missions created
            // before this field existed. Checked against completedBy's
            // length after each /mission done to auto-end the mission.
            maxCompletions: MaxCompletions ? Number(MaxCompletions) : null,
            dateCreated: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isComplete: false,
            completedBy: [],
        };

        //error handling for no task type selected
        if (newTask.taskType === '') {
            return createAlert('error', 'Error', 'Task type must be selected', 1500);
        }
        //error handling for blank title
        if (newTask.title === '') {
            return createAlert('error', 'Error', 'Task title cannot be blank', 1500);
        }
        //error handling for task with 0 points
        if (newTask.pointValue === '0' && newTask.taskType === 'Task') {
            return createAlert('error', 'Error', 'Task cannot have 0 points', 1500);
        }
        //handling for blank description
        if (newTask.description === '') {
            newTask.description = 'No description provided';
        }
        //sets points to 0 for revival misisons
        if (newTask.taskType === 'Revival Mission') {
            newTask.pointValue = 0;
        }

        // checkForTaskDupesForRoom, fetchTaskIndexThenIncrement, and
        // addTaskForRoom all throw on failure rather than swallowing
        // (docs/improvements.md item 10) — this component is mounted inside
        // TaskCreationModal (item 15), and the try/catch matches the pattern
        // used everywhere else in this file so it doesn't reintroduce an
        // unhandled rejection.
        try {
            const dupeExists = await checkForTaskDupesForRoom(newTask, roomID);
            if (dupeExists) {
                return createAlert('error', 'Error', 'Task already exists', 1500);
            }
            newTask.taskIndex = await fetchTaskIndexThenIncrement(roomID);
            await addTaskForRoom(newTask, roomID);
            handleNewTaskAdded(newTask);
            setTaskTitle('');
            setTaskDescription('');
            setPointValue('0');
            setMaxCompletions('');
            setSelectedTaskType('');
            createAlert('success', 'Task Added', 'Your task has been created', 1500);
        } catch (error) {
            console.error('Error creating task: ', error);
            createAlert('error', 'Error creating task', error.message, 1500);
        }
    };

    useEffect(() => {
        console.log(`usingEffect selectedTaskType: ${selectedTaskType}`);
    }, [selectedTaskType]);

    return (
        <Flex m="6px" direction="column">
            <Flex mb="4px">
                <Input
                    ref={titleInputRef}
                    sx={styles.titleInput}
                    value={TaskTitle}
                    onChange={handleTitleChange}
                    placeholder="Task Title"
                />
                <Input
                    placeholder="Description"
                    value={TaskDescription}
                    onChange={handleDescriptionChange}
                />
            </Flex>

            <Flex>
                <Select
                    sx={styles.taskTypeSelection}
                    placeholder="Select Task Type"
                    value={selectedTaskType}
                    onChange={handleChangeTaskType}
                >
                    <option value="Task">Task</option>
                    <option value="Revival Mission">Revival Mission</option>
                </Select>

                <NumberInput
                    style={styles.pointInput}
                    value={PointValue}
                    onChange={handlePointChange}
                    isDisabled={disableNumberInput}
                    m="2px"
                    marginX="4px"
                >
                    <NumberInputField />
                    <NumberInputStepper>
                        <NumberIncrementStepper color="white" />
                        <NumberDecrementStepper color="white" />
                    </NumberInputStepper>
                </NumberInput>

                <NumberInput
                    style={styles.pointInput}
                    value={MaxCompletions}
                    onChange={handleMaxCompletionsChange}
                    min={0}
                    m="2px"
                    marginX="4px"
                >
                    <NumberInputField placeholder="Max completions" />
                    <NumberInputStepper>
                        <NumberIncrementStepper color="white" />
                        <NumberDecrementStepper color="white" />
                    </NumberInputStepper>
                </NumberInput>

                <Button sx={styles.addButton} onClick={handleAddTask} colorScheme="blue">
                    Add
                </Button>
            </Flex>
        </Flex>
    );
});
TaskCreation.displayName = 'TaskCreation';

const styles = {
    titleInput: {
        size: 'md',
        borderRadius: '2xl',
        m: '2px',
    },
    descInput: {
        borderRadius: '2xl',
        m: '2px',
    },
    taskTypeSelection: {
        size: 'md',
        borderRadius: '2xl',
        m: '2px',
    },
    addButton: {
        size: 'md',
        width: '20%',
        m: '2px',
    },
    pointInput: {
        defaultValue: '15',
        min: '0',
        size: 'md',
    },
};
export default TaskCreation;
