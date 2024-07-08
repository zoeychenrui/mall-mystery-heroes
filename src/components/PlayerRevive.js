import {db} from '../utils/firebase';
import {collection, 
        query,  
        where, 
        getDocs,
        updateDoc
    } from "firebase/firestore";
import CreateAlert from './CreateAlert';
import RemapPlayers from './RemapPlayers';

const PlayerRevive = (handleRemapping) => {
    const createAlert = CreateAlert();

    const handleRevivePlayer = async (player, roomID, arrayOfAlivePlayers) => {   
        if (player === '') {
            return createAlert('error', 'Error', 'Error: player undefined', 1500);
        }
        const playerCollectionRef = collection(db, 'rooms', roomID, 'players');
        const playerQuery = query(playerCollectionRef, where('name', '==', player));
        const playerSnapshot = await getDocs(playerQuery);
        const playerdoc = playerSnapshot.docs[0].ref;
        await updateDoc(playerdoc, { isAlive: true });
        const handleRegeneration = RemapPlayers(handleRemapping);
        await handleRegeneration(player, player, arrayOfAlivePlayers, roomID);
    }

    return handleRevivePlayer
}
 
export default PlayerRevive;