import React from "react";
import { useParams } from "react-router-dom";
import { Button, Flex, Heading } from '@chakra-ui/react';
import PlayerAddition from '../components/PlayerAddition';
import PlayerList from '../components/PlayerList';

const PlayerListPage = () => {

    const { roomID } = useParams();

    return (
        <Flex>
        <Heading as="h2" size="xl" mb={4}>
            Room ID: {roomID}
        </Heading>
        <PlayerAddition />
        <PlayerList />
        </Flex>
    )
}

export default PlayerListPage;