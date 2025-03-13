import { Text } from "@chakra-ui/react";
import { useContext, useEffect, useState } from "react";
import { gameContext } from "../Contexts";
import {fetchPhotosQueryByAscendingTimestampForRoom } from "../firebase_calls/dbCalls";
import { onSnapshot } from "firebase/firestore";

export default function GamePhotos() {
    const [arrayOfPhotosURLs, setArrayOfPhotosURLs] = useState([]);
    const {roomID} = useContext(gameContext);

    // When the component mounts, subscribe to the query and update the state whenever it changes
    const photosQuery = fetchPhotosQueryByAscendingTimestampForRoom(roomID);
    useEffect(() => {

        // subscribe to changes in the query results
        const unsubscribe = onSnapshot(photosQuery, (snapshot) => {
            // get the last image reference within the array (should be the most recently added)
            if (!snapshot.empty) {
                const newPhoto = snapshot.docs[snapshot.docs.length - 1].data();
                console.log("photos: ", newPhoto);
    
            } else {
                console.error('no photos');
            }
        }, (error) => {
            console.error("Error fetching photos: ", error);
        });

        return () => unsubscribe();
        // disabled next line because playerAlivePlayersQuery should not be in dependency array
        // eslint-disable-next-line
    }, []);
    
    return (
        <>
            { arrayOfPhotosURLs.length == 0 ? 
                <Text>No photos have been uploaded!</Text> : 
                {

                }
            }
        </>
    )
}