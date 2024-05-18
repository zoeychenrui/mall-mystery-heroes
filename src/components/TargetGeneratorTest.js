import TargetGenerator from './TargetGenerator';
import { Button } from '@chakra-ui/react';

const TargetGeneratorTest = () => {
    const Test = () => {
        let users = ['David', 'Zoey', 'John', 'Min', 'Andy', 'Joey', 'YuRa', 'Robby', 'Ricardo', 'Diegs'];
        users.push('Matt', 'Will', 'Jordan H', 'Jordan M', 'Hadley', 'Nathan');
        const targetMap = TargetGenerator(users);
        console.log('Generated Target Map');
        
        targetMap.forEach((targets, user) => {
            console.log(`${user} has targets: ${targets}`);
            if (targets.length < 2 || targets.length > 3) {
            console.error(`Error: check ${user}'s # of targets`);
            }
        });
        
        const AssassinVal = new Map();
        for (let i = 0; i < users.length; i++) AssassinVal.set(users[i], 0);
        
        targetMap.forEach((targets, user) => {
            targets.forEach((player) => {
                AssassinVal.set(player, AssassinVal.get(player) + 1);
            });
        });

        AssassinVal.forEach((val, player) => {
            console.log(`${player} has ${val} hit(s) on them`);
        });
    }

    return (  
        <div>
            <Button
            onClick = {Test}
            >
                Generate Targets!
            </Button>
        </div>
    );
}
 
export default TargetGeneratorTest;

