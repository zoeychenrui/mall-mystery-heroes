import { Button, 
         Modal, 
         ModalBody, 
         ModalCloseButton, 
         ModalContent, 
         ModalFooter, 
         ModalHeader, 
         ModalOverlay, 
         Table,
         Tbody,
         Td,
         Th,
         Thead,
         Tr
    } from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';

const RemapPlayerModal = ({ newTargets, newAssassins, showRemapModal, onClose }) => {
    const [playerList, setPlayerList] = useState({});

    useEffect (() => {
        const updatedList = {};
        //Adds newTargets to playerList
        for (const [player, newTargetArray] of Object.entries(newTargets)) {
            if (!updatedList[player]) {
                updatedList[player] = [];
            }
            updatedList[player] = [...(updatedList[player] || []), ...newTargetArray];
        }
        //For each new assassin, the player is assined as a target
        for (const [player, newAssassinArray] of Object.entries(newAssassins)) {
            for (const newAssassin of newAssassinArray) {
                if(!updatedList[newAssassin]) {
                    updatedList[newAssassin] = [];
                }
                updatedList[newAssassin] = [...(updatedList[newAssassin] || []), player];
            }
        }
        setPlayerList(updatedList);
    }, [newTargets, newAssassins]);

    useEffect (() => {
        console.log('playerList: ', playerList);
    }, [playerList]);

    const mappedPlayers = Object.entries(playerList).map(([player, targetList]) => (
        <Tr key = {player}>
            <Td>{player}</Td>
            <Td>{targetList.join(', ') || 'None'}</Td>
        </Tr>
    ));

    

    return ( 
        <Modal isOpen = {showRemapModal} 
                onClose = {onClose}
        >
            <ModalOverlay />
            <ModalContent bg = '#202030'>
                <ModalHeader fontcolor = '#ffffff'>
                    {mappedPlayers.length > 0 ? ('Ne Targets For Players') 
                        : ('No New Targets For Players')
                    }
                </ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    {mappedPlayers.length > 0? (
                        <Table>
                            <Thead>
                                <Tr>
                                    <Th color = '#ffffff'>Player</Th>
                                    <Th color = '#ffffff'>New Target(s)</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {mappedPlayers}
                            </Tbody>
                        </Table> )
                        : ('')
                    }
                </ModalBody>
                <ModalFooter>
                    <Button onClick = {onClose}> 
                        Close
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
 
export default RemapPlayerModal;