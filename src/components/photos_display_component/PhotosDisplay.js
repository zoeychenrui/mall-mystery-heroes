import { Box, Heading, Image, Text } from "@chakra-ui/react";
import { useContext, useEffect, useState } from "react";
import { gameContext } from "../Contexts";
import { fetchPhotosQueryByAscendingTimestampForRoom, killPlayerForRoom, updatePhotoStatusForRoom, fetchPlayerForRoom, updatePointsForPlayer, updateTargetsForPlayer, updateAssassinsForPlayer, remapPlayerAsTarget } from "../firebase_calls/dbCalls";
import { onSnapshot } from "firebase/firestore";
import confirm from '../../assets/enter-green.png'
import deny from '../../assets/red-x.png'
import undo from '../../assets/arrow-left.png'
import GamePhotos from "./GamePhotos";
import { executionContext } from '../Contexts';

const PhotosDisplay = () => {
    const [unjudgedPhotos, setUnjudgedPhotos] = useState([]);
    const [judgedPhotos, setJudgedPhotos] = useState([]);
    const { roomID } = useContext(gameContext);
    const { 
        handlePlayerRevive,
        setArrayOfAlivePlayers,
        setArrayOfDeadPlayers,
        addLog
    } = useContext(executionContext);

    useEffect(() => {
        const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(photosQuery, (snapshot) => {
            if (!snapshot.empty) {
                const allPhotos = snapshot.docs
                    .map(doc => ({
                        id: doc.id, 
                        ...doc.data()
                    }))
                    .filter(photo => photo.status === "pending");
                setUnjudgedPhotos(allPhotos);
            } else {
                setUnjudgedPhotos([]);
            }
        }, (error) => {
            console.error("Error fetching photos: ", error);
        });

        return () => unsubscribe();
    }, [roomID]);  
    
    const handlePass = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto, ...rest] = unjudgedPhotos;

        const playerDoc = await fetchPlayerForRoom(currentPhoto.target, roomID);
        const originalPlayerData = playerDoc.data(); // contains score, targets, etc.

        await updatePhotoStatusForRoom(roomID, currentPhoto.id, "approved");
        await killPlayerForRoom(currentPhoto.target, roomID);
        await addLog(
            `${currentPhoto.target} was killed by ${currentPhoto.assassin}`,
            "red.400",
        );
        setJudgedPhotos(prev => [...prev, { photo: currentPhoto, action: 'pass', originalPlayerData }]);
    };
    
    const handleDeny = async () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto, ...rest] = unjudgedPhotos;
    
        await updatePhotoStatusForRoom(roomID, currentPhoto.id, "denied");
        await addLog(
            `${currentPhoto.assassin}'s attempt to kill ${currentPhoto.target} was denied`,
            "gray",
        );
        setJudgedPhotos(prev => [...prev, { photo: currentPhoto, action: 'deny' }]);
    };
    
    const handleUndo = async () => {
        if (judgedPhotos.length === 0) return;
    
        const last = judgedPhotos[judgedPhotos.length - 1];
        const { photo, action, originalPlayerData } = last;
    
        try {
            // Step 1: Revert status in Firestore
            await updatePhotoStatusForRoom(roomID, photo.id, "pending");
    
            // Step 2: Revert kill if it was approved
            if (action === 'pass') {
                await addLog(
                    `Undo: ${photo.target}'s death by ${photo.assassin} was reverted`,
                    "blue.200",
                );

                await handlePlayerRevive(photo.target);
                await updatePointsForPlayer(photo.target, originalPlayerData.score, roomID);
                await updateTargetsForPlayer(photo.target, originalPlayerData.targets, roomID);
                await updateAssassinsForPlayer(photo.target, originalPlayerData.assassins, roomID);
                await remapPlayerAsTarget(photo.target, roomID, originalPlayerData.assassins);
    
                // Mark target as alive again
                setArrayOfAlivePlayers(prev => [...prev, photo.target]);
                setArrayOfDeadPlayers(prev => prev.filter(name => name !== photo.target));
            }
    
            if (action === 'deny') {
                await addLog(
                    `Undo: denial of ${photo.assassin}'s claim on ${photo.target} was reverted.`,
                    "blue.200",
                );
            }
    
            // Step 3: Update UI state
            setJudgedPhotos(prev => prev.slice(0, -1));
            setUnjudgedPhotos(prev => [photo, ...prev]);
    
        } catch (error) {
            console.error("Error undoing photo judgment:", error);
        }
    };

    return (
        <>
            <Box sx = {styles.photosContainer}>
                <Heading size = 'lg' m = '4px'>Photos</Heading>
                <Box sx = {styles.photosBox}>
                    <GamePhotos photo = {unjudgedPhotos[0]}/>
                </Box>
                <Box sx = {styles.buttonsBox}>
                    <Image 
                        src = {deny}
                        sx = {styles.buttonImage}
                        onClick = {handleDeny}
                    />
                    <Image 
                        src = {undo}
                        sx = {styles.buttonImage}
                        onClick = {handleUndo}
                    />
                    <Image 
                        src = {confirm}
                        sx = {styles.buttonImage}
                        onClick = {handlePass}
                    />
                </Box>
            </Box>
        </>
    );
}

const styles = {
    photosContainer: {
        h: '100%',
        w: '100%',
        borderWidth: 2,
        borderRadius: '3xl',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start'
    },
    photosBox: {
        w: '94%',
        h: '75%',
        alignItems: 'center',
        textAlign: 'center',
        flexGrow: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginX: '2px',
        borderWidth: 1
    },
    buttonsBox: {
        display: 'flex',
        flexDirection: 'row',
        w: '100%',
        justifyContent: 'center',
        alignItems: 'center'
    },
    buttonImage: {
        w: '10%',
        m: '4px',
        marginX: '30px',
        transition: 'opacity 0.3s',
        '&:hover': {
            opacity: 0.7
        }
    }
};
export default PhotosDisplay;