import { useState } from 'react';
import { Heading, Button, Stack, Input, Flex, Box, useToast } from '@chakra-ui/react';
import { getAuth, sendPasswordResetEmail } from "firebase/auth";

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
        <Flex
            direction="column"
            align="center"
            justify="center"
            height="100vh"
            bg="gray.50"
            p={4}
        >
            <Box
                p={8}
                bg="white"
                borderRadius="md"
                boxShadow="md"
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
                    />
                    <Button colorScheme='teal' variant='outline' onClick={handleReset}>
                        Submit
                    </Button>
                </Stack>
            </Box>
        </Flex>
    );
};

export default PasswordReset;
