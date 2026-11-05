import React from 'react';
import { Heading, Box, Flex } from '@chakra-ui/react';
import Auth from '../components/auth';
import bgimg from '../assets/logo-3.png'; // Ensure this path is correct
import logo from '../assets/mall-logo-white-2.png';
import { Image } from '@chakra-ui/react';

const LoginPage = () => {
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
                className="LoginPage"
                direction="column"
                align="center"
                justify="center"
                height="100vh"
                p={4}
            >
                <Image src={logo} maxWidth="250px" maxHeight="250px" alt="logo white" mb={4} />
                <Heading mb={8} color="brand.100" textAlign="center">
                    Log In
                </Heading>
                <Box display="flex" justifyContent="center" width="100%">
                    <Auth isLoginPage={true} />
                </Box>
            </Flex>
        </Box>
    );
};

export default LoginPage;
