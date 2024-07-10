import React from 'react';
import { Image,
         Heading,
         Flex,
         HStack   
    } from '@chakra-ui/react';
import whiteLogo from '../assets/mall-logo-white-2.png';
import RegenerateTargets from './RegenerateTargets';
const HeaderExecution = ({ roomID, arrayOfAlivePlayers, handleRemapping}) => {
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
            <Flex>
                <RegenerateTargets
                    arrayOfAlivePlayers={arrayOfAlivePlayers}
                    roomID = {roomID}
                    handleRemapping = {handleRemapping}
                />
            </Flex>
        </HStack>
    );
}
 
export default HeaderExecution;