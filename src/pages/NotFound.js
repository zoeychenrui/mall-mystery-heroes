import { Box, Flex, Heading, Text, Link as ChakraLink } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';

const NotFound = () => (
    <Flex direction="column" align="center" justify="center" h="100vh" p={4}>
        <Box textAlign="center">
            <Heading as="h1" size="2xl" mb={4}>
                404
            </Heading>
            <Text mb={4}>This page doesn&apos;t exist.</Text>
            <ChakraLink as={RouterLink} to="/" color="blue.400">
                Back to home
            </ChakraLink>
        </Box>
    </Flex>
);

export default NotFound;
