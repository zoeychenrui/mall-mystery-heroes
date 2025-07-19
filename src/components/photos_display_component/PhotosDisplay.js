import { Box, Heading, Image, Text } from "@chakra-ui/react";
import { useContext, useEffect, useState } from "react";
import { gameContext } from "../Contexts";
import { fetchPhotosQueryByAscendingTimestampForRoom } from "../firebase_calls/dbCalls";
import { onSnapshot } from "firebase/firestore";
import confirm from '../../assets/enter-green.png'
import deny from '../../assets/red-x.png'
import undo from '../../assets/arrow-left.png'
import GamePhotos from "./GamePhotos";

const PhotosDisplay = () => {
    const [unjudgedPhotos, setUnjudgedPhotos] = useState([]);
    const [judgedPhotos, setJudgedPhotos] = useState([]);
    const { roomID } = useContext(gameContext);

    useEffect(() => {
        const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
        const unsubscribe = onSnapshot(photosQuery, (snapshot) => {
            if (!snapshot.empty) {
                const allPhotos = snapshot.docs.map(doc => doc.data());
                const judgedUrls = new Set(judgedPhotos.map(p => p.photo.url));
                const newUnjudged = allPhotos.filter(photo => !judgedUrls.has(photo.url));
                setUnjudgedPhotos(newUnjudged);
            } else {
                setUnjudgedPhotos([]);
            }
        }, (error) => {
            console.error("Error fetching photos: ", error);
        });

        return () => unsubscribe();
    }, [roomID, judgedPhotos]);

    //short array of photos to test process of going through photos
    /*useEffect(() => {
        setUnjudgedPhotos([
          { url: "https://imgs.search.brave.com/lO_tDmXLcu6gAEwh9yYMgXOmI3Vf4gr04wz_S3_JyFc/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pbWFn/ZXMuc3F1YXJlc3Bh/Y2UtY2RuLmNvbS9j/b250ZW50L3YxLzYx/MTJhMGYwMTJmZTQy/NDQyMmYyMzY5YS84/NTQ3NDRkYi04YTA2/LTQ2MGItOTQ4Yi03/NTMxOGFhNmIwYzUv/Z3JhY2Vwb2ludCtj/aHVyY2graHlkZStw/YXJsK2NoaWNhZ28r/bWFrZW5ldysuanBl/Zw" },
          { url: "https://imgs.search.brave.com/nafa3kk2X95R8LD2iW7vceVdIIw9p4bsnttZbpRkAPg/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zMy1t/ZWRpYTAuZmwueWVs/cGNkbi5jb20vYnBo/b3RvL1p5U0tnYlpP/cktLaTVzczE0UWtR/blEvMzQ4cy5qcGc" },
          { url: "https://imgs.search.brave.com/u6LJrM0vQqElBCJDBJcji4iF5PiLeXbBS2NWPZ2n-e0/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zMy1t/ZWRpYTAuZmwueWVs/cGNkbi5jb20vYnBo/b3RvL1ZJUGdjTTBF/Sm9penZoR1FfZTdS/NEEvbC5qcGc" },
          { url: "https://imgs.search.brave.com/WHX0AZeQw0rXexzbkrQxnkRm9E0ccfyfUrStOtACOBA/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zMy1t/ZWRpYTAuZmwueWVs/cGNkbi5jb20vYnBo/b3RvL05XU2FJNVNW/cFVILURza3owaWxr/eVEvbC5qcGc" }
        ]);
      }, []);*/     

    const handlePass = () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto, ...rest] = unjudgedPhotos;
        setJudgedPhotos(prev => [...prev, { photo: currentPhoto, action: 'pass' }]);
        setUnjudgedPhotos(rest);
    };
    
    const handleDeny = () => {
        if (unjudgedPhotos.length === 0) return;
        const [currentPhoto, ...rest] = unjudgedPhotos;
        setJudgedPhotos(prev => [...prev, { photo: currentPhoto, action: 'deny' }]);
        setUnjudgedPhotos(rest);
    };
    
    const handleUndo = () => {
        if (judgedPhotos.length === 0) return;
        const last = judgedPhotos[judgedPhotos.length - 1];
        setJudgedPhotos(prev => prev.slice(0, -1));
        setUnjudgedPhotos(prev => [last.photo, ...prev]);
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