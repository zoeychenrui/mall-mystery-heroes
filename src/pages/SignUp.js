import React, { useState } from 'react';
import { Heading, Box, Flex, Text } from '@chakra-ui/react';
import Auth from '../components/auth';
import { useNavigate, Link as RouterLink } from 'react-router-dom';

const LoginPage = () => {
    const [isLoginPage, setIsLoginPage] = useState(false);
    const navigate = useNavigate();


    return (
        <Flex 
            className="SignUpPage"
            direction="column"
            align="center"
            justify="center"
            height="100vh"
            bg="gray.50"
            p={4}
        >
            <Heading mb={8}>Create an Account </Heading>
            <Box 
                p={8} 
                bg="white" 
                borderRadius="md" 
                boxShadow="md"
                width="100%"
                maxWidth="400px"
            >
                <Auth isLoginPage={isLoginPage}/>
                
            </Box>
        </Flex>
    );
};

export default LoginPage;
