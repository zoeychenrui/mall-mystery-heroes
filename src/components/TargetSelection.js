import React from 'react';
import { Box, Select } from '@chakra-ui/react';

const TargetSelection = (props) => {
    const { possibleTargets, getSelectedTarget, selectedTarget } = props;

    const handleChange = async (event) => {
        getSelectedTarget(event.target.value);
    };

    return (
        <Box>
            <Select 
                id='killTarget'
                placeholder='Select Target'
                value={selectedTarget}
                onChange={handleChange}
            >
                {possibleTargets.map((player, index) => (
                    <option key={index} value={player}>
                        {player}
                    </option>
                ))}
            </Select>
        </Box>
    );
};

export default TargetSelection;