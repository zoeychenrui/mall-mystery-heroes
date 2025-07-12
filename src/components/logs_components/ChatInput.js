import { Box, Image } from "@chakra-ui/react";
import { useContext, useState } from "react";
import Autosuggest from "react-autosuggest";
import enter from '../../assets/enter-green.png';
import { executionContext, gameContext } from "../Contexts";
import { addPlayerToCompletedByForTask, checkOpenSzn, fetchAlivePlayerNamesForRoom, fetchAllPlayersForRoom, fetchPlayerForRoom, fetchPlayersByStatusForRoom, fetchPointsForPlayerInRoom, fetchReferenceByIndexForTask, fetchTargetsForPlayer, fetchTaskByIndexForRoom, killPlayerForRoom, setOpenSznOfPlayerToValueForRoom, updateIsAliveForPlayer, updateIsCompleteToTrueForTaskByIndex, updatePointsForPlayer } from "../firebase_calls/dbCalls";
import RemapPlayers from "../RemapPlayers";
import CreateAlert from "../CreateAlert";

export default function ChatInput() {
    const [value, setValue] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const { roomID } = useContext(gameContext);
    const xecutionContext = useContext(executionContext);
    const createAlert = CreateAlert();

    const onChange = (event, { newValue }) => {
        setValue(newValue);
    };

    const onSuggestionsFetchRequested = () => {
        setSuggestions(getSuggestions(value));
    };

    const onSuggestionsClearRequested = () => {
        setSuggestions([]);
    };

    const inputProps = {
        placeholder: 'Input Texts/Commands Here ',
        value,
        onChange,
        onKeyDown: (event) => {
            if (event.key === "Enter") {
                handleCommandExecution(value, setValue, roomID, xecutionContext, createAlert);
            }
        }
    };

    return (
        <Box sx = {styles.inputBox}>
            <Autosuggest 
                suggestions = {suggestions}
                onSuggestionsFetchRequested = {onSuggestionsFetchRequested}
                onSuggestionsClearRequested = {onSuggestionsClearRequested}
                getSuggestionValue = {getSuggestionValue}
                renderSuggestion = {renderSuggestion}
                inputProps = {inputProps}
                theme = {{...inputTheme, suggestionsContainer: inputTheme.suggestionsContainer(suggestions)}}
            />
            <Image
                src = {enter}
                style = {styles.enterImage}
                onClick = {() => handleCommandExecution(value, setValue, roomID, xecutionContext, createAlert)}
                _hover = {{opacity: '.3'}}
                transition = "opacity 0.1s ease-in-out"
            />
        </Box>
    );
}

// Commands used for game purposes
const commands = [
    { text: '/add [player] points', command: console.log('running')},
    { text: '/broadcast [message]', command: console.log('running')},
    { text: '/kill [player] [assassin]', command: console.log('running')},
    { text: '/leaderboard send', command: console.log('running')},
    { text: '/mission done [player name] mission_index', command: console.log('running')},
    { text: '/mission end mission_index', command: console.log('running')},
    { text: '/openSeason [player] start/end', command: console.log('running')},
    { text: '/revive [player]', command: console.log('running')},
    { text: '/whisper [player] [message]', command: console.log('running')},
];

// input sanity checking for commands
// all possible commands that could be executed should be put into this array
const sanityCheckCommandInputs = [
    "/add",
    "/broadcast",
    "/kill",
    "/leaderboard",
    "/mission",
    "/openseason",
    "/revive",
    "/whisper"
];

// Filter suggestions based on current input
const getSuggestions = (value) => {
    const inputValue = value.trim().toLowerCase();
    const inputLength = inputValue.length;

    return inputLength === 0 ? [] 
        : commands.filter((command) => 
            (command.text.toLowerCase().slice(0, inputLength) === inputValue)
            );
}

// Get Name for Display Purposes
const getSuggestionValue = (suggestion) => {return suggestion.text};

// Rending for each display
const renderSuggestion = (suggestion) => {
    return <Box listStyleType = 'none'>{suggestion.text}</Box>
}

// handling for command execution
const handleCommandExecution = async (value, setValue, roomID, xecutionContext, createAlert) => {
    console.log("executing command: ", value);

    // parse command and args
    const parts = value.match(/\/\S+|(\[[^\]]+\]|\S+)/g).map(s => s.replace(/[\[\]]/g, ''));
    if (!parts) return null;

    const commandLine = parts[0].toLowerCase();
    const args = parts.slice(1);
    console.log(commandLine);
    console.log(args);
    
    const { 
        handleRemapping, 
        handleKillPlayer, 
        handleSetShowMessageToTrue, 
        handleAddNewAssassins, 
        handleAddNewTargets, 
        handleOpenSznstarted,
        handleOpenSznended,
        handlePlayerRevive,
        handleTaskCompleted
    } = xecutionContext; // retrieve contexts

    
    // sanity check that command input is valid
    if (sanityCheckCommandInputs.includes(commandLine)) {
        const arrayOfPlayerNames = (await fetchAllPlayersForRoom(roomID)).map(name => name.toLowerCase());
        const handleTargetRegeneration = RemapPlayers(handleRemapping, createAlert); // initial remapping of players function
        let arrayOfAlivePlayers;
        let arrayOfDeadPlayers;
        let playerName;
        let arg;
        let missionIndex;
        
        switch (commandLine) {
            case "/add":
                // sanity check player input
                if (arrayOfPlayerNames.includes(args[0])) {
                    // sanity check point input
                    if (!isNaN(Number(args[1]))) {
                        await updatePointsForPlayer(args[0], Number(args[1]), roomID);
                    } else {
                        createAlert('error', 'Error', 'Please input valid points', 1500);
                        console.error("Please input valid points");
                    }
                } else {
                    createAlert('error', 'Error', `Player ${args[0]} is invalid`, 1500);
                    console.error(`Player ${args[0]} is invalid.`)
                }
                break;

            case "/broadcast":
                //TO DO
                break;

            case "/kill":
                // sanity check target and assassin input
                if (!args || args.length < 2) {
                    createAlert('error', 'Error', 'Missing Arguments', 1500);
                    console.error("Missing Arguments");
                    break;
                }

                const targetName = args[0] ? args[0].toLowerCase() : "";
                const assassinName = args[1] ? args[1].toLowerCase() : "";
                if (arrayOfPlayerNames.includes(targetName) && arrayOfPlayerNames.includes(assassinName)) {
                    // check if target on assassins' target list or target is openSZN
                    const arrayOfTargetsOfAssassin = await fetchTargetsForPlayer(assassinName, roomID);
                    const isOpenSzn = await checkOpenSzn(roomID, assassinName);
                    if (isOpenSzn || arrayOfTargetsOfAssassin.includes(targetName)) {
                        // update assassin points
                        let currTargetPoints = await fetchPointsForPlayerInRoom(targetName, roomID);
                        currTargetPoints = currTargetPoints >= 0 ? currTargetPoints : 0;
                        await updatePointsForPlayer(assassinName, currTargetPoints, roomID);
                        
                        // get target data before killing
                        const targetDoc = await fetchPlayerForRoom(targetName, roomID);
                        const playersNeedingTargets = targetDoc.data().assassins; // get target's assassins to update their targets
                        const playersNeedingAssassins = targetDoc.data().targets; // get target's targets to update their assassins

                        // kill target
                        await killPlayerForRoom(targetName, roomID); // kill target and update db
                        await handleKillPlayer(targetName, assassinName, isOpenSzn);

                        // update targets/assassins as needed
                        console.log(`PnT: ${playersNeedingTargets}, PnA: ${playersNeedingAssassins}`)
                        const arrayOfAlivePlayers = await fetchAlivePlayerNamesForRoom(roomID);
                        const [targets, assassins] = await handleTargetRegeneration(
                                                        playersNeedingTargets, 
                                                        playersNeedingAssassins,
                                                        arrayOfAlivePlayers, 
                                                        roomID
                                                     );
                        handleAddNewAssassins(assassins);
                        handleAddNewTargets(targets);
                        handleSetShowMessageToTrue();
                    } else {
                        createAlert('error', 'Error',`${targetName} is not a valid taret for ${assassinName}`, 1500);
                        console.error(`"${targetName}" is not a valid target for "${assassinName}"`);
                    }
                } else {
                    createAlert('error', 'Error',`Invalid players: ${args[0]}, ${args[1]}`, 1500);
                    console.error(`One of the following inputs are invalid: Target - "${args[0]}", Assassin - "${args[1]}"`);
                }
                break;

            case "/leaderboard":
                // TO DO
                break;

            case "/mission":
                arg = args[0] ? args[0].toLowerCase() : "";
                switch (arg) {
                    case "done":
                        playerName = args[1] ? args[1].toLowerCase() : "";
                        missionIndex = args[2] ? Number(args[2]) : -1;
                        if (missionIndex === -1) {
                            createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
                            console.error(`${args[2]} is not a valid index`);
                            break;
                        }
                        
                        // sanity check player input
                        if (arrayOfPlayerNames.includes(playerName)) {
                            // sanity check mission index
                            const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                            const taskDocRef = await fetchReferenceByIndexForTask(missionIndex, roomID);
                            if (!task) {
                                createAlert('error', 'Error', 'Invalid task index', 1500);
                                console.error("invalid task");
                                break;
                            }

                            // check if player has completed task
                            if (!task.completedBy.includes(playerName)) {
                                //updates player scores for task types
                                if (task.taskType === 'Task') {
                                    const points = parseInt(task.pointValue);
                                    await updatePointsForPlayer(playerName, points, roomID);
                                } else if (task.taskType === 'Revival Mission') { //updates player live status for revival missions
                                    arrayOfDeadPlayers = await fetchPlayersByStatusForRoom(false, roomID);
                                    if (arrayOfDeadPlayers.includes(playerName)) {
                                        await updateIsAliveForPlayer(playerName, true, roomID);
                                        handlePlayerRevive(playerName);
                                        arrayOfAlivePlayers = await fetchAlivePlayerNamesForRoom(roomID);
                                        console.log("xxx: ", playerName)
                                        const [targets, assassins] = await handleTargetRegeneration(
                                                                            [playerName], 
                                                                            [playerName],
                                                                            arrayOfAlivePlayers, 
                                                                            roomID
                                                                        );
                                        handleAddNewAssassins(assassins);
                                        handleAddNewTargets(targets);
                                        handleSetShowMessageToTrue();
                                    } else {
                                        createAlert('error', 'Error', `Player ${args[1]} is not dead`, 1500);
                                        console.error(`Player ${args[1]} is not dead`);
                                    }
                                }
                                await addPlayerToCompletedByForTask(taskDocRef, playerName);

                            } else {
                                createAlert('error', 'Error', `Player ${args[1]} has already completed the mission`, 1500);
                                console.error(`Player ${args[1]} has already completed the mission`);
                            }
                            
                        } else {
                            createAlert('error', 'Error', `Player ${args[1]} is invalid`, 1500);
                            console.error(`Player ${args[1]} is invalid.`)
                        }
                        break;

                    case "end":
                        missionIndex = args[1] ? Number(args[1]) : -1;
                        if (missionIndex === -1) {
                            createAlert('error', 'Error', `${args[2]} is not a valid index`, 1500);
                            console.error(`${args[2]} is not a valid index`);
                            break;
                        }

                        createAlert('info', 'Completed', 'Task has been saved as completed', 1500);
                        const task = await fetchTaskByIndexForRoom(missionIndex, roomID);
                        await updateIsCompleteToTrueForTaskByIndex(missionIndex, roomID);
                        const taskTitle = task.title;
                        handleTaskCompleted(taskTitle);
                        break;
                    default:
                        createAlert('error', 'Error', `Inavlid argument: ${args[0]}`, 1500);
                        console.error(`Inavlid argument: ${args[0]}`);
                        break;
                }
                break;

            case "/openseason":
                // TO DO: double check szn alrdy on/off
                // sanity check openSeason target
                playerName = args[0] ? args[0].toLowerCase() : "";
                arg = args[1] ? args[1].toLowerCase() : "";
                if (arrayOfPlayerNames.includes(playerName)) {
                    switch (arg) {
                        case "start":
                            await setOpenSznOfPlayerToValueForRoom(playerName, true, roomID);
                            handleOpenSznstarted(playerName);
                            break;
                        case "end":
                            await setOpenSznOfPlayerToValueForRoom(playerName, false, roomID);
                            handleOpenSznended(playerName);
                            break;
                        default: 
                            createAlert('error', 'Error', `${args[1]} is not a valid input`, 1500);
                            console.error(`${args[1]} is not a valid input`);
                            break;
                    }
                } else {
                    createAlert('error', 'Error', `${args[0]} is not a valid player`, 1500);
                    console.error(`${args[0]} is not a valid player`);
                }
                break;

            case "/revive":
                arrayOfDeadPlayers = await fetchPlayersByStatusForRoom(false, roomID);
                playerName = args[0] ? args[0].toLowerCase() : "";
                // sanity check if player exists as dead player
                if (arrayOfDeadPlayers.includes(playerName)) {
                    await updateIsAliveForPlayer(playerName, true, roomID);
                    const activePlayers = await fetchAlivePlayerNamesForRoom(roomID);
                    const [target, assassin] = await handleTargetRegeneration(
                                                         [playerName], 
                                                         [playerName],
                                                         activePlayers, 
                                                         roomID
                                                        );
                    handleAddNewAssassins(assassin);
                    handleAddNewTargets(target);
                    handleSetShowMessageToTrue();
                    handlePlayerRevive(playerName, createAlert);
                }
                break;

            case "/whisper":
                // TO DO
                break;

            default:
                createAlert('error', 'Error', `Unknown command: ${commandLine}`, 1500);
                console.error("Unknown command:", commandLine);
                break;
        }

        setValue('');
    } else {
        createAlert('error', 'Error', `The follow command is not legal: ${commandLine}`, 1500);
        console.error(`Error executing command. The follow command is not legal: ${commandLine}`);
        setValue('');
    }
}

const styles = {
    inputBox: {
        h: '100%',
        w: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    enterImage: {
        width: '6%',
        height: '70%',
    
    }
}

const inputTheme = {
    container: {
        width: '78%',
        height: '60%',
        margin: '8px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
    },
    input: {
        width: '100%',
        height: '100%',
        background: 'transparent',
        borderWidth: 1,
        borderRadius: 8,
        padding: 8
    },
    suggestionsList: {
        listStyleType: 'none'
    },
    suggestionsContainer: (suggestions) => ({
        position: 'absolute',
        zIndex: '10',
        bottom: '100%',
        width: '100%',
        padding: '4px',
        background: '#202030',
        listStyleType: 'none',
        borderWidth: 1,
        borderRadius: 8,
        display: suggestions.length === 0 ? 'none' : 'block'
    }),
    suggestion: {
        padding: '4px',
        cursor: 'pointer',
    },
    suggestionHighlighted: {
        background: '#8b8bb2',
    },

}