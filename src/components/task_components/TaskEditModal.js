import React, { useRef, useState } from 'react';
import {
    Alert,
    AlertIcon,
    Button,
    Flex,
    FormLabel,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    NumberDecrementStepper,
    NumberIncrementStepper,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    Select,
    Text,
} from '@chakra-ui/react';
import CreateAlert from '../CreateAlert';
import {
    addPlayerMessageForRoom,
    updatePointsForPlayer,
    updateTaskForRoom,
} from '../firebase_calls/dbCalls';
import { planScoreAdjustment, createApplyProgress } from '../../game/missionEdit';

// Self-contained: owns both the Modal chrome and the form fields, unlike
// TaskCreationModal/TaskCreation's split — editing's field set is small
// enough not to warrant a separate presentational component. Not a reuse
// of TaskCreation.js: no dupe-check, no new taskIndex, isComplete/
// completedBy are preserved untouched
// (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
//
// Errors surface only through CreateAlert's toast, matching
// TaskCreation.js/ResetTargetsButton.js's existing convention — no
// separate persistent inline error box, which would otherwise render the
// same message text twice (toast description + inline box) and break a
// single-match `findByText` lookup.
//
// Every field's state is seeded once, from the `task` prop, by its
// useState initializer — so this component must be mounted only while it
// is open. TaskAccordion renders it behind `{isEditOpen && ...}` for
// exactly that reason: closing unmounts it, and reopening remounts it
// with the current task's values, instead of resurrecting edits the GM
// abandoned by clicking "Close".
const TaskEditModal = ({ isOpen, onClose, task, roomID, addLog }) => {
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [taskType, setTaskType] = useState(task.taskType);
    const [pointValue, setPointValue] = useState(String(task.pointValue));
    const [maxCompletions, setMaxCompletions] = useState(
        task.maxCompletions === null || task.maxCompletions === undefined
            ? ''
            : String(task.maxCompletions)
    );
    // Set only between "Save" (when planScoreAdjustment finds a non-null
    // adjustment) and the GM's explicit "Confirm" — a distinct step, not
    // an automatic silent recompute of players' scores
    // (docs/superpowers/specs/2026-08-20-mission-edit-delete-design.md).
    const [pendingAdjustment, setPendingAdjustment] = useState(null);
    const createAlert = CreateAlert();
    // Changing Task <-> Revival Mission after anyone has completed the
    // mission is blocked — a Task completion awards points, a Revival
    // Mission completion revives a player, and retroactively undoing
    // either is out of scope (see the design doc's Decisions section).
    const hasCompletions = task.completedBy.length > 0;
    // The taskType Select is disabled once anyone has completed the
    // mission, but a completion can land (another GM's view, a /mission
    // done in chat) after the GM has already changed the dropdown — so the
    // constraint is re-checked here rather than trusted from what the UI
    // happened to show. Read both by buildUpdates (what gets written) and
    // by the Select's own `value` (what the GM sees), so a save that gets
    // silently locked back to task.taskType never displays a different,
    // about-to-be-discarded value in the dropdown.
    const effectiveTaskType = hasCompletions ? task.taskType : taskType;

    // What of the current save attempt has already landed in Firestore.
    // A "Confirm" retry after a mid-loop failure re-enters applyUpdate
    // from the top with the same adjustment, and updatePointsForPlayer is
    // additive (Firestore increment()) — so without this, every player
    // who succeeded on the first attempt would receive the delta a second
    // time. Players are tracked by position rather than by name so a
    // repeated name in completedBy could never make one skip the other.
    // A ref, not state: it is read and written inside a single async run
    // and must never trigger a re-render.
    const applyProgress = useRef(createApplyProgress());

    const resetApplyProgress = () => {
        applyProgress.current = createApplyProgress();
    };

    const buildUpdates = () => {
        return {
            title,
            // Kept in step with `title` on every edit: it is the only
            // field checkForTaskDupesForRoom queries, so letting it go
            // stale would permanently desync the duplicate-title index
            // from the visible title. Mirrors TaskCreation.js.
            titleTrimmedLowerCase: title.replace(/\s/g, '').toLowerCase(),
            // Matches TaskCreation.js's blank-description default — an
            // edit that clears the field should not leave the mission with
            // no description at all (docs/improvements.md item 64).
            description: description === '' ? 'No description provided' : description,
            taskType: effectiveTaskType,
            // Stored as the raw string from the Chakra NumberInput,
            // matching TaskCreation.js's convention and what
            // docs/data-model.md documents ("read back with parseInt") —
            // coercing with Number() here would leave the same field
            // holding a string on unedited missions and a number on
            // edited ones. A Revival Mission is always worth 0: the input
            // is disabled for that type, and this forces it regardless.
            pointValue: effectiveTaskType === 'Revival Mission' ? '0' : pointValue,
            maxCompletions: maxCompletions === '' ? null : Number(maxCompletions),
        };
    };

    // Sequential, not Promise.all — matches ResetTargetsButton.js's
    // UpdateDatabase, this repo's established convention for a
    // multi-player write loop.
    const applyUpdate = async (updates, adjustment) => {
        try {
            if (!applyProgress.current.taskWritten) {
                await updateTaskForRoom(task.taskIndex, updates, roomID);
                applyProgress.current.taskWritten = true;
            }
            if (adjustment) {
                for (let index = 0; index < adjustment.players.length; index += 1) {
                    if (applyProgress.current.appliedPlayerIndexes.has(index)) continue;
                    await updatePointsForPlayer(
                        adjustment.players[index],
                        adjustment.delta,
                        roomID
                    );
                    applyProgress.current.appliedPlayerIndexes.add(index);
                }
            }
            await addLog(`Mission "${updates.title}" was edited`, 'blue.400');
            await addPlayerMessageForRoom(
                {
                    type: 'broadcast',
                    recipient: null,
                    text: `Mission ${updates.title} was edited`,
                    standings: null,
                },
                roomID
            );
            createAlert('success', 'Task Updated', 'Your mission has been updated', 1500);
            setPendingAdjustment(null);
            onClose();
        } catch (submitError) {
            // updateTaskForRoom/updatePointsForPlayer both throw on
            // failure rather than swallowing (docs/improvements.md item
            // 10). A failure partway through the score-adjustment loop is
            // a real, accepted risk here, not a transaction — surfaced as
            // an error, not silently retried (see the design doc's Error
            // handling section). pendingAdjustment is intentionally left
            // set on failure so the GM can retry with "Confirm" without
            // re-triggering the notice; that retry resumes where this
            // attempt stopped, skipping the task write and the players
            // recorded in applyProgress above, and so never awards the
            // same player the delta twice.
            console.error('Error saving mission edit:', submitError);
            createAlert('error', 'Error saving mission', submitError.message, 1500);
        }
    };

    // Field validity is enforced here, not only at creation time: the
    // same three rules TaskCreation.js applies (non-blank title, no
    // 0-point Task, a Revival Mission is worth 0) with the same copy, so
    // an edit cannot produce a mission that creation would have rejected.
    const handleSave = () => {
        const updates = buildUpdates();
        if (updates.title.trim() === '') {
            return createAlert('error', 'Error', 'Task title cannot be blank', 1500);
        }
        if (updates.taskType === 'Task' && Number(updates.pointValue) === 0) {
            return createAlert('error', 'Error', 'Task cannot have 0 points', 1500);
        }
        const adjustment = planScoreAdjustment(task, updates);
        // A fresh save attempt: nothing of it has been written yet, so
        // none of the previous attempt's progress may be carried over.
        resetApplyProgress();
        if (adjustment) {
            setPendingAdjustment({ updates, adjustment });
            return;
        }
        applyUpdate(updates, null);
    };

    const handleConfirmAdjustment = () => {
        applyUpdate(pendingAdjustment.updates, pendingAdjustment.adjustment);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent bg="#202030">
                <ModalHeader color="#ffffff">Edit Mission</ModalHeader>
                <ModalCloseButton aria-label="Close modal" />
                <ModalBody>
                    <Flex direction="column" gap={2}>
                        <Input
                            placeholder="Task Title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                        <Input
                            placeholder="Description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                        <Select
                            value={effectiveTaskType}
                            onChange={(event) => setTaskType(event.target.value)}
                            isDisabled={hasCompletions}
                        >
                            <option value="Task">Task</option>
                            <option value="Revival Mission">Revival Mission</option>
                        </Select>
                        <FormLabel htmlFor="edit-point-value" color="#ffffff" mb={0}>
                            Point Value
                        </FormLabel>
                        {/*
                            A Revival Mission is worth no points, so the
                            field is disabled for that type — matching
                            TaskCreation.js's disableNumberInput — and
                            shows the 0 that will actually be written
                            rather than a leftover number the save would
                            silently discard. Switching back to Task
                            restores what was typed, since the state
                            itself is left alone.
                        */}
                        <NumberInput
                            id="edit-point-value"
                            value={effectiveTaskType === 'Revival Mission' ? '0' : pointValue}
                            onChange={setPointValue}
                            isDisabled={effectiveTaskType === 'Revival Mission'}
                        >
                            <NumberInputField />
                            <NumberInputStepper>
                                <NumberIncrementStepper color="white" />
                                <NumberDecrementStepper color="white" />
                            </NumberInputStepper>
                        </NumberInput>
                        <NumberInput value={maxCompletions} onChange={setMaxCompletions} min={0}>
                            <NumberInputField placeholder="Max completions" />
                            <NumberInputStepper>
                                <NumberIncrementStepper color="white" />
                                <NumberDecrementStepper color="white" />
                            </NumberInputStepper>
                        </NumberInput>
                        {pendingAdjustment && (
                            <Alert status="warning">
                                <AlertIcon />
                                <Text>
                                    This will adjust {pendingAdjustment.adjustment.players.length}{' '}
                                    player
                                    {pendingAdjustment.adjustment.players.length === 1 ? '' : 's'}
                                    &apos; scores by{' '}
                                    {pendingAdjustment.adjustment.delta > 0 ? '+' : ''}
                                    {pendingAdjustment.adjustment.delta} each.
                                </Text>
                            </Alert>
                        )}
                    </Flex>
                </ModalBody>
                <ModalFooter>
                    <Button onClick={onClose} mr={2}>
                        Close
                    </Button>
                    {pendingAdjustment ? (
                        <Button colorScheme="green" onClick={handleConfirmAdjustment}>
                            Confirm
                        </Button>
                    ) : (
                        <Button colorScheme="blue" onClick={handleSave}>
                            Save
                        </Button>
                    )}
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};

export default TaskEditModal;
