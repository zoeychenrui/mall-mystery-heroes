import React, { useState } from 'react';
import { Heading, Box, Flex, Text } from '@chakra-ui/react';
import Auth from '../components/auth';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import bgimg from '../assets/logo-3.png'; // Ensure this path is correct


const LoginPage = () => {
    const [isLoginPage, setIsLoginPage] = useState(false);
    const navigate = useNavigate();


    return (
        <Box 
            w="100vw"
            h="100vh"
            bgImage={`url(${bgimg})`}
            backgroundPosition="center"
            backgroundRepeat="no-repeat"
            backgroundSize="cover"
        >
            <Flex 
                className="SignUpPage"
                direction="column"
                align="center"
                justify="center"
                height="100vh"
                p={4}
                
            >
                <Heading mb={1}>Create an Account </Heading>
                <Box 
                    p={8} 
                    borderRadius="md" 
                    width="100%"
                    maxWidth="400px"
                    mb={3}
                >
                    <Auth isLoginPage={isLoginPage}/>
                </Box>
            </Flex>
        </Box>
    );
};

export default LoginPage;
