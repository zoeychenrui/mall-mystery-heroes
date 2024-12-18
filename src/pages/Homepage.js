import React from 'react';
import { Button, Stack, Image, Box, Flex, Divider } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/mall-logo-white-2.png';

const Homepage = () => {
  const navigate = useNavigate();

  return (
    <Flex
      height="100vh"
      alignItems="center"
      justifyContent="center"
    >
      <Flex direction="row" alignItems="center" justifyContent="center">
        <Stack direction="column" alignItems="center" textAlign="center">
          <Image 
            src={logo} 
            maxWidth="300px"
            maxHeight="300px"
            alt='logo white'
            mb={5} // Adds margin bottom to the Image
          />
        </Stack>
        <Divider orientation='vertical' height='440px' mx={8} />
        <Box textAlign="center">
          <Stack direction="column" spacing={4}>
            <Button colorScheme="teal" variant="solid" onClick={() => navigate('/login')}>
              Log In
            </Button>
            <Button colorScheme="teal" variant="outline" onClick={() => navigate('/signup')}>
              Sign Up
            </Button>
          </Stack>
        </Box>
      </Flex>
    </Flex>
  );
};

export default Homepage;
