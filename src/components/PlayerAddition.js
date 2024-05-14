import React from 'react';
import {Card, Text, Button} from '@chakra-ui/react';
import firebase from 'firebase/app';
import 'firebase/firestore';

const playerInputBox = () => {
    const[PlayerName, setPlayerName  ] = useState('');

    const handleInputChange = (event) => {
        setPlayerName(event.target.value);
    };
    
    const handleAddPlayer = () => {
        const db = firebase.firestore();
        const roomref = db.collection('rooms').doc(*****).collection('players'); //how do I retrieve doc's auto-ID?
        const playerQuery = roomref.where('name', '==', playerName)
        playerQuery.get()
            .then((querySnapshot) => {
                if (querySnapshot.empty) {
                    roomref.add({
                        name : PlayerName,
                        score : 0,
                        alive : true,
            
                    })

                    .then((docRef) => {
                        console.log("Player added with ID: ", docRef.id);
                    })
                    .catch((error) => {
                        console.error("Error adding player:", error);
                    });
                }
                
                else {
                    console.error("Cannot add duplicate player!");
                }
            })
        .catch((error) => {
            console.error("Error checking for player: ", error);
        });

    }
    
    return ( 
        <>
            <input
                placeholder = "Enter Player Name"
                value = {PlayerName}
                onChange = {handleInputChange}
                mb = "2"
             />
            
            <Button onClick={handleAddPlayer} colorScheme='blue'>
                Add
            </Button>
        </>
    );
}

const PlayerAdd = ({name, id, score, isAlive}) => {
    return (  
        <Card p ="4">
            <Text>{name}</Text>
            <Text>ID: {id}</Text>
            <Text>Score: {score}</Text>
            <Text colorScheme = {isAlive ? "green" : "red"}>
                {isAlive ? "Alive" : "Dead"}
            </Text>
            <Button onClick={*****************}>{isAlive ? "Kill" : "Revive"}</Button>
        </Card>
    );
}
 
export {playerInputBox, PlayerAdd};