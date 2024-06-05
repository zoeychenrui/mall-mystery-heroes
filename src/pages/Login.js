import React, { useState } from 'react';
import { Heading, Box, Flex } from '@chakra-ui/react';
import Auth from '../components/auth';

const LoginPage = () => {
    const [isLoginPage, setIsLoginPage] = useState(true);

    return (
        <Flex 
            className="LoginPage"
            direction="column"
            align="center"
            justify="center"
            height="100vh"
            bg="gray.50"
            p={4}
        >
            <Heading mb={8}>Welcome Back</Heading>
            <Box 
                p={8} 
                bg="white" 
                borderRadius="md" 
                boxShadow="md"
                width="100%"
                maxWidth="400px"
            >
                <Auth isLoginPage={isLoginPage} />
            </Box>
        </Flex>
    );
};

export default LoginPage;
