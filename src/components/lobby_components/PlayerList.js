import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => {
    // Takes arrayOfPlayers and renders it as a single centered column
    // (docs/superpowers/specs/2026-08-14-simplified-lobby-design.md) — was
    // previously split into two side-by-side columns for the old
    // split-screen Lobby layout, which no longer exists.
    const listOfNames = arrayOfPlayers.map((eachName) => (
        <ListItem
            key={eachName}
            mb="4px"
            fontSize="2xl"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
        >
            {eachName}
        </ListItem>
    ));

    return (
        <Flex
            direction="column"
            h="100%"
            w="90%"
            overflowY="auto"
            overflowX="hidden"
            justify="flex-start"
            align="center"
            textAlign="center"
        >
            <OrderedList listStyleType="none">{listOfNames}</OrderedList>
        </Flex>
    );
};

export default PlayerList;
