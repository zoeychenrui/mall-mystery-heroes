import React, { useState } from 'react';
import { Heading, Box, Flex, Image } from '@chakra-ui/react';
import Auth from '../components/auth';
import bgimg from '../assets/logo-3.png'; // Ensure this path is correct
import logo from '../assets/mall-logo-white.svg';

const LoginPage = () => {
    const [isLoginPage, setIsLoginPage] = useState(true);

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
                <Box 
                    maxW="100%"  // Set maximum width of the Box
                    maxH="100%"   // Set maximum height of the Box
                    display="flex"
                    flexDirection="column"
                    alignItems="center"  // Center align items horizontally
                    p={8} 
                    borderRadius="md"
                >
                    <Image 
                        src={logo} 
                        maxWidth="200px"
                        maxHeight="200px"
                        alt='logo white'
                        mb={4} // Adds margin bottom to the Image
                    />
                    <Heading mb={8} color="white">
                        Mall Mystery Heroes
                    </Heading>
                    <Auth isLoginPage={isLoginPage} />
                </Box>
            </Flex>
        </Box>
    );
};

export default LoginPage;
