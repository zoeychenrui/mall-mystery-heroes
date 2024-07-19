import React from 'react';
import { Image,
         Heading,
         HStack   
    } from '@chakra-ui/react';
import whiteLogo from '../assets/mall-logo-white-2.png';
const HeaderExecution = ({ roomID }) => {
    return (  
        <HStack justifyContent = 'left'
                p = '5px'
                ml = '16px'
                size = ''
        >
            <Image objectFit = 'cover'
                   src = {whiteLogo}
                   alt = 'Logo'
                   boxSize = '36px'
            />
            <Heading>Lobby #: {roomID}</Heading>
        </HStack>
    );
}
 
export default HeaderExecution;