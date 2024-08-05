import React from 'react';
import { auth, db } from "../utils/firebase";
import { setDoc, doc } from 'firebase/firestore';
import { Button, ButtonGroup, Flex, Heading } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import {signOut} from 'firebase/auth';
import { adjectives, uniqueNamesGenerator } from 'unique-names-generator';
import { checkForRoomIDDupes } from '../components/dbCalls';
import CreateAlert from '../components/CreateAlert';

const DashBoard = () => {
  const navigate = useNavigate();
  const createAlert = CreateAlert();

  const handleHostRoom = async () => {
    try {
      const user = auth.currentUser;

      if (user) {
        let randomRoomNumber;
        let roomID;
        let check = false;
        let runningTime = 0;

        while(!check) {
          runningTime++;
          if (runningTime > 300) {
            console.log('timed out');
            return createAlert('error', 'Timed Out', 'No Available Room Found', 1500);
          }
          randomRoomNumber = Math.floor(Math.random() * 90000) + 10000;
          console.log('running');
          roomID = uniqueNamesGenerator({ 
            dictionaries: [adjectives, [randomRoomNumber.toString()]],
            separator: '',
            style: 'capital'
          });
          check = await checkForRoomIDDupes(roomID);
        }

        const roomRef = doc(db, "rooms", roomID);
        await setDoc(roomRef, {
          hostId: user.uid,
          isGameActive : true,
          logs: [],
        });
        navigate(`/rooms/${roomRef.id}/lobby`);
      } else {
        console.error("No user is signed in.");
      }
    } catch (error) {
      console.error("Error hosting room:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      console.log("User successfully logged out");
      navigate('/');

    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Flex direction="column" align="center" justify="center" h="100vh">
      <Heading as="h1" size="xl" mb={4}>
        Mall Mystery Heroes DashBoard
      </Heading>
      <div>OLD LOBBY DATA maybe?</div>
      <ButtonGroup mt={4}>
        <Button colorScheme='teal' 
                variant='outline' 
                onClick={handleHostRoom}>
              Host Room
        </Button>
        <Button colorScheme='teal' 
                variant='solid' 
                onClick={logout}>
              Log Out
        </Button>
      </ButtonGroup>
    </Flex>
    
  );
}

export default DashBoard;