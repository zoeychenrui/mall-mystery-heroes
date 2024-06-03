// Homepage.js
import React from 'react';
import { Button, Center, Stack } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';

const Homepage = () => {
  const navigate = useNavigate();

  return (
    <Center height="100vh">
      <Stack direction="column" spacing={4}>
        <Button colorScheme="teal" variant="solid" onClick={() => navigate('/login')}>
          Log In
        </Button>
        <Button colorScheme="teal" variant="outline" onClick={() => navigate('/signup')}>
          Sign Up
        </Button>
      </Stack>
    </Center>
  ); 
};

export default Homepage;
