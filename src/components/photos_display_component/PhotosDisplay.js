import { Box, Heading, Image, Text } from '@chakra-ui/react';
import { useContext, useEffect, useState } from 'react';
import { gameContext } from '../Contexts';
import {
    addPlayerMessageForRoom,
    approvePhotoAsMissionForRoom,
    approvePhotoForRoom,
    fetchPhotosQueryByAscendingTimestampForRoom,
    fetchTasksQueryForRoom,
    updatePhotoStatusForRoom,
} from '../firebase_calls/dbCalls';
import { onSnapshot } from 'firebase/firestore';
import { splitPhotosByStatus } from '../../game/photoJudgments';
import { resolvePlayerDisplayName } from '../../game/playerNames';
import { executeKill } from '../executeKill';
import { undoKill } from '../undoKill';
import confirm from '../../assets/enter-green.png';
import deny from '../../assets/red-x.png';
import undo from '../../assets/arrow-left.png';
import GamePhotos from './GamePhotos';
import { executionContext } from '../Contexts';
import CreateAlert from '../CreateAlert';
import { completeMission } from '../completeMission';
import { undoMissionPhotoApproval } from '../undoMissionPhotoApproval';

// A player now names their own target or mission when submitting a photo
// (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md)
// — this component's job is purely display + approve/deny, with no
// override capability. `players` is the same live roster
// GameMasterView.js already subscribes to, used here only for display
// name resolution.
const PhotosDisplay = ({ players = [] }) => {
    const [unjudgedPhotos, setUnjudgedPhotos] = useState([]);
    const [judgedPhotos, setJudgedPhotos] = useState([]);
    // Photo IDs the GM has clicked Approve/Deny on but Firestore hasn't
    // confirmed yet — executeKill/updatePhotoStatusForRoom can take
    // several real seconds against a cold Cloud Function, and this app
    // never displays a "judged" history list to reconcile against (only
    // the current unjudged photo), so suppressing these IDs from
    // unjudgedPhotos is enough to make the queue advance instantly.
    const [optimisticallyJudgedIds, setOptimisticallyJudgedIds] = useState([]);
    const [missions, setMissions] = useState([]);
    const { roomID } = useContext(gameContext);
    const {
        addLog,
        handleRemapping,
        handleAddNewAssassins,
        handleAddNewTargets,
        handleSetShowMessageToTrue,
        handlePlayerRevive,
        handleOpenSznended,
    } = useContext(executionContext);
    const createAlert = CreateAlert();

    // Both lists are derived from Firestore on every snapshot, not
    // accumulated locally (docs/improvements.md item 6) — judgedPhotos used
    // to live only in React state, built up as the GM clicked through a
    // session, so reloading the console lost every prior judgment (and the
    // originalPlayerData an undo needs) even though the photo documents
    // were already approved/denied in Firestore. splitPhotosByStatus is the
    // pure, unit-tested piece of this (src/game/photoJudgments.js).
    useEffect(() => {
        const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(
            photosQuery,
            (snapshot) => {
                const allPhotos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                const { unjudged, judged } = splitPhotosByStatus(allPhotos);
                setUnjudgedPhotos(unjudged);
                setJudgedPhotos(judged);
                // Once Firestore's own data no longer lists a photo as
                // pending, any optimistic suppression of it is redundant —
                // drop it, so this list never grows past what's actually
                // still in flight.
                setOptimisticallyJudgedIds((previous) =>
                    previous.filter((id) => unjudged.some((photo) => photo.id === id))
                );
            },
            (error) => {
                console.error('Error fetching photos: ', error);
            }
        );

        return () => unsubscribe();
    }, [roomID]);

    useEffect(() => {
        const missionsQuery = fetchTasksQueryForRoom(roomID);
        const unsubscribe = onSnapshot(
            missionsQuery,
            (snapshot) => {
                setMissions(snapshot.docs.map((doc) => doc.data()));
            },
            (error) => {
                console.error('Error fetching missions: ', error);
            }
        );

        return () => unsubscribe();
    }, [roomID]);

    const visibleUnjudgedPhotos = unjudgedPhotos.filter(
        (photo) => !optimisticallyJudgedIds.includes(photo.id)
    );
    const currentPhoto = visibleUnjudgedPhotos[0];

    // The claim is already resolved by the time a moderator sees it — a
    // player picks their own target/mission at submission time now
    // (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md).
    // This component's job is purely display + approve/deny, with no
    // override capability.
    const currentMissionTitle = currentPhoto
        ? missions.find((mission) => mission.taskIndex === currentPhoto.mission)?.title
        : undefined;

    // Approving a photo used to kill the target unconditionally — no check
    // that the assassin was actually hunting them, and no remap of the
    // target's own assassins/targets onto new ones (docs/improvements.md
    // item 5). executeKill now runs the validate/transfer-points/kill/
    // unmap/remap sequence atomically server-side (item 4) — the same
    // Cloud Function /kill (ChatInput.js) calls, so the two paths can't
    // diverge; its preKillSnapshot is exactly the map of every touched
    // player's pre-kill data that undoKillPlayer needs to fully reverse a
    // kill (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
    const handlePass = async () => {
        if (visibleUnjudgedPhotos.length === 0) return;
        const [approvingPhoto] = visibleUnjudgedPhotos;
        if (approvingPhoto.mission == null && !approvingPhoto.target) return;
        setOptimisticallyJudgedIds((previous) => [...previous, approvingPhoto.id]);

        try {
            if (approvingPhoto.mission != null) {
                const missionIndex = approvingPhoto.mission;
                const result = await completeMission(missionIndex, approvingPhoto.assassin, roomID);
                await approvePhotoAsMissionForRoom(
                    roomID,
                    approvingPhoto.id,
                    missionIndex,
                    result.reversalSnapshot
                );
                const displayName = resolvePlayerDisplayName(approvingPhoto.assassin, players);

                await addLog(`${displayName} completed mission: ${result.taskTitle}`, 'green.400');
                await addPlayerMessageForRoom(
                    {
                        type: 'broadcast',
                        recipient: null,
                        text: `${displayName} completed mission: ${result.taskTitle}`,
                        standings: null,
                    },
                    roomID
                );

                if (result.revivesPlayer) {
                    handlePlayerRevive(displayName);
                }

                if (result.reversalSnapshot.wasAutoEnded) {
                    await addLog(
                        `Mission "${result.taskTitle}" auto-ended — reached its ${result.maxCompletions}-completion cap`,
                        'purple.400'
                    );
                    await addPlayerMessageForRoom(
                        {
                            type: 'broadcast',
                            recipient: null,
                            text: `Mission ${result.taskTitle} has been completed!`,
                            standings: null,
                        },
                        roomID
                    );
                }

                if (result.revivesPlayer) {
                    for (const log of result.remapLogs) {
                        await handleRemapping(log);
                    }
                    handleAddNewAssassins(result.addedAssassins);
                    handleAddNewTargets(result.addedTargets);
                    handleSetShowMessageToTrue();
                }
            } else {
                const target = approvingPhoto.target;
                const {
                    targetWasOpenSzn,
                    preKillSnapshot,
                    addedTargets,
                    addedAssassins,
                    remapLogs,
                } = await executeKill(target, approvingPhoto.assassin, roomID);

                await approvePhotoForRoom(roomID, approvingPhoto.id, target, preKillSnapshot);
                // Mirrors handleKillPlayer's own ordering for the typed
                // /kill command (GameMasterView.js) — open season already
                // ends server-side inside killPlayer.js's own transaction
                // regardless of which path triggered the kill; this is
                // just catching the photo path up on announcing it, which
                // it never did before.
                if (targetWasOpenSzn) {
                    await handleOpenSznended(target);
                }
                await addLog(`${target} was killed by ${approvingPhoto.assassin}`, 'red.400');
                await addPlayerMessageForRoom(
                    {
                        type: 'killResult',
                        recipient: null,
                        text: `${target} was killed by ${approvingPhoto.assassin}`,
                        standings: null,
                        mission: null,
                        sender: null,
                        assassin: approvingPhoto.assassin,
                        target,
                        outcome: 'approved',
                    },
                    roomID
                );

                for (const log of remapLogs) {
                    await handleRemapping(log);
                }
                handleAddNewAssassins(addedAssassins);
                handleAddNewTargets(addedTargets);
                handleSetShowMessageToTrue();
            }
        } catch (error) {
            console.error('Error approving photo: ', error);
            setOptimisticallyJudgedIds((previous) =>
                previous.filter((id) => id !== approvingPhoto.id)
            );
            createAlert('error', 'Error approving photo', error.message, 1500);
        }
    };

    // Denying never needs a resolved target — an ambiguous or otherwise
    // invalid photo can be rejected without anyone ever deciding who it
    // was supposedly of.
    const handleDeny = async () => {
        if (visibleUnjudgedPhotos.length === 0) return;
        const [denyingPhoto] = visibleUnjudgedPhotos;
        setOptimisticallyJudgedIds((previous) => [...previous, denyingPhoto.id]);

        try {
            await updatePhotoStatusForRoom(roomID, denyingPhoto.id, 'denied');
            await addLog(`${denyingPhoto.assassin}'s photo submission was denied`, 'gray');
            await addPlayerMessageForRoom(
                {
                    type: 'killResult',
                    recipient: null,
                    text: `${denyingPhoto.assassin}'s photo submission was denied`,
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: denyingPhoto.assassin,
                    target: null,
                    outcome: 'denied',
                },
                roomID
            );
        } catch (error) {
            console.error('Error denying photo: ', error);
            setOptimisticallyJudgedIds((previous) =>
                previous.filter((id) => id !== denyingPhoto.id)
            );
            createAlert('error', 'Error denying photo', error.message, 1500);
        }
    };

    // For an approved kill, the full reversal (every player killPlayer.js's
    // transaction touched, not just the target) now happens atomically
    // inside undoKillPlayer, which also resets the photo's status back to
    // pending as part of the same transaction — so this function no longer
    // needs to know anything about individual player fields, and no longer
    // calls updatePhotoStatusForRoom for that path
    // (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md). A
    // denied judgment never touched player data, so undoing one is still
    // just a status reset here.
    const handleUndo = async () => {
        if (judgedPhotos.length === 0) return;

        const last = judgedPhotos[judgedPhotos.length - 1];
        const { photo, action } = last;

        if (action === 'missionPass') {
            try {
                await undoMissionPhotoApproval(roomID, photo.id);
                await addLog('Undo: the last mission completion was reverted', 'blue.200');
                await addPlayerMessageForRoom(
                    {
                        type: 'broadcast',
                        recipient: null,
                        text: 'Undo: the last mission completion was reverted',
                        standings: null,
                    },
                    roomID
                );
            } catch (error) {
                console.error('Error undoing mission completion:', error);
                createAlert('error', 'Error undoing photo judgment', error.message, 1500);
            }
            return;
        }

        try {
            if (action === 'pass') {
                await undoKill(roomID, photo.id);
                await addLog(
                    `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                    'blue.200'
                );
                await addPlayerMessageForRoom(
                    {
                        type: 'killResult',
                        recipient: null,
                        text: `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                        standings: null,
                        mission: null,
                        sender: null,
                        assassin: photo.assassin,
                        target: photo.target,
                        outcome: 'undoneApproval',
                    },
                    roomID
                );
            }

            if (action === 'deny') {
                await updatePhotoStatusForRoom(roomID, photo.id, 'pending');
                await addLog(
                    `Undo: denial of ${photo.assassin}'s kill attempt was reverted.`,
                    'blue.200'
                );
                await addPlayerMessageForRoom(
                    {
                        type: 'killResult',
                        recipient: null,
                        text: `Undo: denial of ${photo.assassin}'s kill attempt was reverted.`,
                        standings: null,
                        mission: null,
                        sender: null,
                        assassin: photo.assassin,
                        target: null,
                        outcome: 'undoneDenial',
                    },
                    roomID
                );
            }
            // unjudgedPhotos/judgedPhotos update via the onSnapshot listener
            // once the writes above land — no local update needed.
        } catch (error) {
            console.error('Error undoing photo judgment:', error);
            createAlert('error', 'Error undoing photo judgment', error.message, 1500);
        }
    };

    return (
        <>
            <Box sx={styles.photosContainer}>
                <Heading size="lg" m="4px">
                    Photos
                    {visibleUnjudgedPhotos.length > 0
                        ? ` (${visibleUnjudgedPhotos.length} pending)`
                        : ''}
                </Heading>
                <Box sx={styles.photosBox}>
                    <GamePhotos photo={currentPhoto} />
                </Box>
                {currentPhoto && (
                    <Box sx={styles.targetPickerBox}>
                        {currentPhoto.mission != null ? (
                            <Text mb={1}>
                                {currentPhoto.assassin}'s mission attempt: {currentMissionTitle}
                            </Text>
                        ) : currentPhoto.target ? (
                            <Text mb={1}>
                                {currentPhoto.assassin}'s kill attempt on {currentPhoto.target}
                            </Text>
                        ) : (
                            <Text color="gray.400">No target selected.</Text>
                        )}
                    </Box>
                )}
                <Box sx={styles.buttonsBox}>
                    <Image src={deny} alt="Deny" sx={styles.buttonImage} onClick={handleDeny} />
                    <Image src={undo} alt="Undo" sx={styles.buttonImage} onClick={handleUndo} />
                    <Image
                        src={confirm}
                        alt="Approve"
                        sx={styles.buttonImage}
                        opacity={currentPhoto?.mission != null || currentPhoto?.target ? 1 : 0.3}
                        cursor={
                            currentPhoto?.mission != null || currentPhoto?.target
                                ? 'pointer'
                                : 'not-allowed'
                        }
                        onClick={handlePass}
                    />
                </Box>
            </Box>
        </>
    );
};

const styles = {
    photosContainer: {
        h: '100%',
        w: '100%',
        borderWidth: 2,
        borderRadius: '3xl',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    photosBox: {
        w: '94%',
        // Fixed h:'75%' used to fight with flexGrow:1 here — a long
        // caption (e.g. "assassin's mission attempt: <long title>") could
        // need more than the remaining 25%, and nothing was reserving room
        // for it, so the button row got squeezed up into the caption text.
        // flexGrow alone lets this box take only what's left over *after*
        // targetPickerBox/buttonsBox below have claimed the room their own
        // content actually needs.
        minH: 0,
        textAlign: 'center',
        flexGrow: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginX: '2px',
        borderWidth: 1,
    },
    targetPickerBox: {
        w: '94%',
        textAlign: 'center',
        marginX: '2px',
    },
    buttonsBox: {
        display: 'flex',
        flexDirection: 'row',
        w: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        mt: '10px',
    },
    buttonImage: {
        w: '10%',
        m: '4px',
        marginX: '30px',
        transition: 'opacity 0.3s',
        '&:hover': {
            opacity: 0.7,
        },
    },
};
export default PhotosDisplay;
