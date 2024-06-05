import React from 'react';
import { auth, db } from "../utils/firebase";
import { collection, addDoc } from 'firebase/firestore';
import { Button, ButtonGroup, Flex, Heading } from '@chakra-ui/react';
import Auth from '../components/auth';
import { useNavigate } from 'react-router-dom';
import {signOut} from 'firebase/auth';

const DashBoard = () => {

  const navigate = useNavigate();

  const handleHostRoom = async () => {
    try {
      const user = auth.currentUser;

      if (user) {
        const roomRef = await addDoc(collection(db, "rooms"), { 
          hostId: user.uid,
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