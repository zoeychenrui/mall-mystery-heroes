import {
    AccordionIcon,
    AccordionButton,
    AccordionItem,
    AccordionPanel,
    Text,
} from '@chakra-ui/react';
import React from 'react';

// Read-only sibling of TaskAccordion.js, for the player-facing "View
// Missions" popup (docs superpowers spec: player-selects-target-mission
// design's Section 1, approved separately as a bounded change). Same
// fields, same layout — no Edit/Delete, and no gameContext/executionContext
// dependency, since a player's own session never carries either.
const PlayerTaskAccordion = ({ task }) => {
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
            </AccordionPanel>
        </AccordionItem>
    );
};

export default PlayerTaskAccordion;
