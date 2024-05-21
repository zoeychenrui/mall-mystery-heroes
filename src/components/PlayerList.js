import React, { useEffect } from "react";
import { ListItem, OrderedList, Flex } from '@chakra-ui/react';

const PlayerList = ({ arrayOfPlayers }) => { 

    // Sort Names alphabetically and add to list
    const listOfNames = arrayOfPlayers.map(eachName => <ListItem key={eachName}>{eachName}</ListItem>);

    return (
        //displays player names
        <div className='parent'>
            <Flex justifyContent="center">
                <div className='displayNames'>
                    <OrderedList> 
                        {listOfNames}
                    </OrderedList>
                </div>
            </Flex>
        </div>
    );
};

export default PlayerList;