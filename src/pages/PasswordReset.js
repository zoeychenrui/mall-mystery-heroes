import { useState } from 'react';
import { Heading, Stack, Input, Flex, Box, useToast } from '@chakra-ui/react';
import { getAuth, sendPasswordResetEmail } from "firebase/auth";
import bgimg from '../assets/logo-3.png'; // Ensure this path is correct
import FilledEnterButton from '../components/FilledEnterButton';


const PasswordReset = () => {
    const [email, setEmail] = useState("");
    const toast = useToast();

    const handleReset = async () => {
        const auth = getAuth();
        try {
            await sendPasswordResetEmail(auth, email);
            console.log("Password reset email sent to:", email);
            toast({
                title: "Password reset",
                description: "A link to reset the password has been sent to your email",
                status: "success",
                duration: 9000,
                isClosable: true,
            });
        } catch (error) {
            console.error("Error sending password reset email:", error.code, error.message);
            toast({
                title: "Failed to send password reset email",
                description: "Please try again.",
                status: "error",
                duration: 9000,
                isClosable: true,
            });
        }
    };

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
                direction="column"
                align="center"
                justify="center"
                height="100vh"
                p={4}
            >
                <Box
                    p={8}
                    borderRadius="md"
                    width="100%"
                    maxWidth="400px"
                >
                    <Heading as="h1" size="xl" mb={4}>Password Reset</Heading>
                    <Stack spacing={4}>
                        <Input
                            placeholder="Email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            borderWidth= "3px" //until theme is fixed
                        />
                        <Box position="relative" bottom="60px" left="100%"  width="50px" height="50px" >
                            <FilledEnterButton send={handleReset} />
                        </Box>
                    </Stack>
                    
                    {/* I need to link this back to the login maybe or let them go to the email and then come back */}
                </Box>
            </Flex>
        </Box>
    );
};

export default PasswordReset;
