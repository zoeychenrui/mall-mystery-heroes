import React, { useState } from "react";
import { functions } from "../utils/firebase";
import { httpsCallable } from 'firebase/functions';
import { Flex, Button } from '@chakra-ui/react';
import { getAuth } from 'firebase/auth';

const CloudFunction = () => {
    const [message, setMessage] = useState("Default Message");
    const auth = getAuth();

    async function callTargetFunction() {
        const user = auth.currentUser;
    
        if (!user) {
            setMessage("User not authenticated");
            return;
        }
    
        const targetFunction = httpsCallable(functions, 'targetFunction');
        try {
            const data = { sampleKey: "sampleValue" }; // Your data object
            console.log("Sending data:", data);
            const result = await targetFunction(data);
            console.log("Result:", result); // Log the result
            if (result.data.success) {
                setMessage(result.data.message);
            } else {
                setMessage('Firebase function has an error');
            }
        } catch (error) {
            console.error("Error:", error);
            setMessage('Error calling Firebase function');
        }
    }    

    return (
        <Flex>
            <Button onClick={callTargetFunction}>
                {message}
            </Button>
        </Flex>
    );
};

export default CloudFunction;
