import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => { 

    //  Takes arrayofPlayers and makes it a list
    const listOfNames = arrayOfPlayers.map(eachName => <ListItem key={eachName}>{eachName}</ListItem>);

    return (
        <Flex justifyContent="center">
            <OrderedList> 
                {listOfNames}
            </OrderedList>
        </Flex>
    );
};

export default PlayerList;
