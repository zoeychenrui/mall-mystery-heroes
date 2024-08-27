import { Box, List, ListItem } from '@chakra-ui/react';
import React from 'react';

const Log = ({ logList }) => {
    const logs = logList.map((log, index) => (
        <ListItem key = {index} 
                  mb = '4px'
                  color = {log.color}
        >
            [{log.time}]: {log.log}
        </ListItem>
    ));

    return (
        <Box flex = '1'
             ml = '12px'
             mr = '16px'
             mt = '10px'
             fontSize = '20px'
             overflow = 'auto'
        >
            <List styleType = 'none' textColor = 'gray.400'>
                <ListItem>Game has begun!</ListItem>
                {logs}
            </List>
        </Box> 
    );
}
 
export default Log;