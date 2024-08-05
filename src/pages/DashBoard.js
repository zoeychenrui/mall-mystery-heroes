import React from 'react';
import { auth, db } from "../utils/firebase";
import { collection, addDoc, setDoc, doc } from 'firebase/firestore';
import { Button, ButtonGroup, Flex, Heading } from '@chakra-ui/react';
import Auth from '../components/auth';
import { useNavigate } from 'react-router-dom';
import {signOut} from 'firebase/auth';
import { NumberDictionary, adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';

const DashBoard = () => {

  const navigate = useNavigate();

  const handleHostRoom = async () => {
    try {
      const user = auth.currentUser;

      if (user) {
        let randomRoomNumber = Math.floor(Math.random() * 90000) + 10000;
        const roomID = uniqueNamesGenerator({ 
          dictionaries: [adjectives, [randomRoomNumber.toString()]],
          separator: '',
          style: 'capital'
        });
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