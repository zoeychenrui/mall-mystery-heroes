import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => { 

    //  Takes arrayofPlayers and makes it a list
    const listOfNames = arrayOfPlayers.map(eachName => 
        <ListItem
            key = {eachName}
            mb = '4px'
            fontSize = '2xl'
            overflow = 'hidden'
            textOverflow = 'ellipsis'
            whiteSpace = 'nowrap'
        >
            {eachName}
        </ListItem>
    );

    let firstHalf = [];
    let secondHalf = [];
    for (let i = 0; i < listOfNames.length; i++) {
        if (i % 2 === 0) {
            firstHalf.push(listOfNames[i]);
        } else {
            secondHalf.push(listOfNames[i]);
        }
    }
    
    return (
        <Flex 
            direction = 'row'
            h = '100%'
            w = '90%'
            overflowY = 'auto'
            overflowX = 'hidden'
            justify = 'center'
            align = 'top'
            textAlign = 'center'
        >
            <Flex
                w = '50%'
                maxW = '50%'
                justify = 'center'
            >
                <OrderedList
                    listStyleType = 'none'
                > 
                    {firstHalf}
                </OrderedList>
            </Flex>

            <Flex
                w = '50%'
                justify = 'center'
                maxW = '50%'
                overflowX = 'hidden'
            >
                <OrderedList
                    listStyleType = 'none'
                    overflow = 'hidden'
                >
                    {secondHalf}
                </OrderedList>
            </Flex>
        </Flex>
    );
};

export default PlayerList;
