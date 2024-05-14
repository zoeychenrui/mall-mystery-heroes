import React from 'react';
import { auth, db } from "../utils/firebase";
import { doc, collection, addDoc, setDoc } from 'firebase/firestore';
import { Button, Flex, Heading, Image } from '@chakra-ui/react';
import Auth from '../components/auth';
import { useNavigate } from 'react-router-dom';

const HostRoom = () => {

  const navigate = useNavigate();

  const handleHostRoom = async () => {
    try {
      const user = auth.currentUser;

      if (user) {
        const roomRef = await addDoc(collection(db, "rooms"), { 
          hostId: user.uid,
        });
        navigate(`/rooms/${roomRef.id}`);
      } else {
        console.error("No user is signed in.");
      }
    } catch (error) {
      console.error("Error hosting room:", error);
    }
  };

  return (
    <Flex direction="column" align="center" justify="center" h="100vh">
      <Heading as="h1" size="xl" mb={4}>
        Mall Mystery Heroes
      </Heading>
      <Auth />
      <Button colorScheme='teal' variant='outline' onClick={handleHostRoom}>
        Host Room
      </Button>
    </Flex>
    
  );
}

export default HostRoom;