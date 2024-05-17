import React, { useState, useEffect } from "react";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Flex, Button } from '@chakra-ui/react';

const cloudFunction = () => { 
    const [message, setMessage] = useState("Default Message");

    async function callTargetFunction() {
        const targetFunction = httpsCallable(getFunctions(), 'targetFunction')
        try {
            const data = {}
            const result = await targetFunction(data)
            if(result.data.success) {
                setMessage('Firebase function called successfully')
            } else {
                setMessage('Firebase function has an error')
            }
        } catch (error) {
            console.error("Error: ", error)
        }
    }
    
    return (
        <Flex>
           <Button onClick={() => {callTargetFunction}}>
                {message}
           </Button>
        </Flex>
    );
};

export default cloudFunction;
