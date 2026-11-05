import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => {
    // A two-column row-major grid places names left to right, then continues
    // on the next row (Alice, Bob / Carol, Dave).
    const listOfNames = arrayOfPlayers.map((eachName) => (
        <ListItem
            key={eachName}
            mt="12px"
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
            <OrderedList
                listStyleType="none"
                display="grid"
                gridTemplateColumns="repeat(2, minmax(0, 1fr))"
                columnGap={6}
                rowGap={1}
                w="100%"
            >
                {listOfNames}
            </OrderedList>
        </Flex>
    );
};

export default PlayerList;
