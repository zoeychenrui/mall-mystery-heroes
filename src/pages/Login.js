import React, { useState } from 'react';
import { Heading, Box, Flex, Image } from '@chakra-ui/react';
import Auth from '../components/auth';
import bgimg from '../assets/logo-3.png'; // Ensure this path is correct
import logo from '../assets/mall-logo-white-2.png';

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
                    display="flex"
                    flexDirection="column"
                    alignItems="center"  // Center align items horizontally
                >
                    <Image 
                        src={logo} 
                        maxWidth="300px"
                        maxHeight="300px"
                        alt='logo white'
                        mb={5} // Adds margin bottom to the Image
                    />
                    <Heading mb={8} color="brand.100" textAlign="center" marginLeft="10px">
                        Mall Mystery Heroes
                    </Heading>
                    <Box display="flex" justifyContent="center" width="100%">
                        <Auth isLoginPage={isLoginPage} />
                    </Box>
                </Box>
            </Flex>
        </Box>
    );
};

export default LoginPage;
