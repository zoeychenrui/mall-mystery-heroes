//randomizes order of array
function randomizeArray(array) {
    for (let i = 0; i < array.length - 1; i++) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

//store player's data for three things: 
//1. number of assassins (hits on a person)
//2. index of last target
//3. array of previous targets
//can be used later for assigning new targets
let playerData = {};

//creates adjacency list 
function TargetGenerator(users) {     
    playerData = {};
    const targetList = randomizeArray([...users]);
    console.log("targetList created: ", targetList)
    const playerList = randomizeArray([...users]);
    console.log("playerList created: ", playerList);
    
    //delcares max num of targets
    const MAXTARGETS = users.length > 15 ? 3 : 2;
    
    for (let i = 0; i < users.length; i++) {
        const data =  {
            numOfAssassins: 0, 
            lastTargetIndex: i - 1, 
            prevTargets: []}; 
        playerData[users[i]] = data;
    }
    console.log("playerData initiated: ", playerData);
    const targetMap = new Map();
    
    for (let playerDex = 0; playerDex < users.length; playerDex++) {
        const currPlayer = playerList[playerDex];
        targetMap.set(currPlayer, []);

        for (let targetCount = 0; targetCount < MAXTARGETS; targetCount++) {
            let targetIndex = (playerData[currPlayer].lastTargetIndex + 1) % users.length;
            const target = targetList[targetIndex];
            const originalDex = targetIndex;
            while (playerData[target].numOfAssassins == MAXTARGETS 
                   || target === currPlayer) {
                targetIndex = (targetIndex + 1) % users.length;
                if (targetIndex == originalDex) {
                    console.log(`had to break for ${currPlayer}`)
                    break;
                }
            }
            targetMap.get(currPlayer).push(target);
            playerData[currPlayer].lastTargetIndex = targetIndex;
            playerData[currPlayer].prevTargets.push(target);
            playerData[target].numOfAssassins += 1;
        }
    }

    console.log("targetMap created: ", targetMap);
    console.log("playerData finalized: ", playerData);
    return targetMap;
};

export {TargetGenerator, playerData};