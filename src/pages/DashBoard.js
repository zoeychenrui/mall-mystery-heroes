import React, { useEffect } from 'react';
import { auth, db } from '../utils/firebase';
import { setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Center, Spinner } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { checkForRoomIDDupes, fetchActiveRoomForHost } from '../components/firebase_calls/dbCalls';
import { generateRoomCode, isBlockedRoomCode } from '../game/roomId';
import CreateAlert from '../components/CreateAlert';

// No visible UI: resolves where a logged-in GM belongs and redirects there
// immediately, rather than making them click "Host Room" on a static page
// every time (docs/superpowers/specs/2026-08-08-dashboard-removal-design.md).
// Wrapped in RequireAuth (see App.js), so auth.currentUser is already
// resolved by the time this mounts — no onAuthStateChanged subscription
// needed here, unlike Homepage.js, which isn't behind that guard.
const DashBoard = () => {
    const navigate = useNavigate();
    const createAlert = CreateAlert();

    useEffect(() => {
        const resolveDestination = async () => {
            try {
                const user = auth.currentUser;
                if (!user) {
                    console.error('No user is signed in.');
                    return;
                }

                const existingRoom = await fetchActiveRoomForHost(user.uid);
                if (existingRoom) {
                    const destination = existingRoom.gameStarted ? 'GameMasterView' : 'lobby';
                    navigate(`/rooms/${existingRoom.id}/${destination}`, { replace: true });
                    return;
                }

                let roomID;
                let check = false;
                let runningTime = 0;

                while (!check) {
                    runningTime++;
                    if (runningTime > 300) {
                        createAlert('error', 'Timed Out', 'No Available Room Found', 1500);
                        return;
                    }
                    roomID = generateRoomCode();
                    check = !isBlockedRoomCode(roomID) && (await checkForRoomIDDupes(roomID));
                }

                const roomRef = doc(db, 'rooms', roomID);
                await setDoc(roomRef, {
                    hostId: user.uid,
                    isGameActive: true,
                    gameStarted: false,
                    joinedUids: [],
                    taskIndex: 1,
                    storageReference: [],
                    createdAt: serverTimestamp(),
                });
                navigate(`/rooms/${roomRef.id}/lobby`, { replace: true });
            } catch (error) {
                console.error('Error resolving dashboard destination:', error);
            }
        };

        resolveDestination();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Center h="100vh">
            <Spinner size="xl" />
        </Center>
    );
};

export default DashBoard;
