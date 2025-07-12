import {
    Flex,
    Button,
    AlertDialog,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay, 
    AlertDialogContent,
    useDisclosure,

} from '@chakra-ui/react';
import React, { useContext } from 'react';
import { endGame } from '../firebase_calls/dbCalls';
import { useNavigate } from 'react-router-dom';
import { gameContext } from '../Contexts';



const Endgamebutton = () => {
    const { roomID } = useContext(gameContext);
    const cancelRef = React.useRef();
    const navigate = useNavigate();

    const { isOpen, onOpen, onClose } = useDisclosure();

    
    const onYesEnd = async () => {
        onClose();
        endGame(roomID);
        navigate('/dashboard');
    }

    const handleClick = () => {
        onOpen();
    }

    return (
        <Flex>
            <Button bg = 'red.500'
                    color = 'white'
                    variant = 'solid'
                    size = 'md'
                    borderRadius = '3xl'
                    _hover = {{bg: 'white', color: 'black'}}
                    onClick = {handleClick}
                    mr = '12px'
            >End Game
            </Button>
            <AlertDialog
                isOpen={isOpen}
                leastDestructiveRef={cancelRef}
                onClose = {onClose}
                size = '3xl'
            >

                <AlertDialogOverlay  alignItems='center'
                                            justifyContent='center'/>
                    <AlertDialogContent 
                        bg = '#202030'
                    >

                        <AlertDialogHeader alignItems='center'
                                            justifyContent='center'
                                            textAlign='center'>
                            Are you sure you want to end the Game?
                        </AlertDialogHeader>

                        <AlertDialogFooter>
                            <Button ref={cancelRef} onClick={onClose} colorScheme='red'>
                                Go Back
                            </Button>
                            <Button colorScheme='green' onClick= {onYesEnd}>
                                Confirm End Game
                            </Button>
                        </AlertDialogFooter>

                    </AlertDialogContent>
            </AlertDialog>
        </Flex>
    )
}
export default Endgamebutton;
 
