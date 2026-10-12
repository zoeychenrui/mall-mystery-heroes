import React, { useState } from 'react';
import { Button, Input, Stack, Heading, Flex, Alert, AlertIcon } from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { joinRoom } from '../components/joinRoom';
import { requestReconnect } from '../components/requestReconnect';
import { writePlayerSession } from '../utils/playerSession';

const JoinGame = () => {
    const navigate = useNavigate();
    const [gameId, setGameId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmedGameId = gameId.trim();
        setErrorMessage('');
        setIsSubmitting(true);

        try {
            // signInAnonymously mints a new anonymous identity and replaces
            // auth.currentUser whenever the current user isn't already
            // anonymous — it does not layer a guest session on top of an
            // existing one. A GM who is still signed in (e.g. tapped Join
            // Game by mistake) must not lose their host session just by
            // submitting this form.
            if (!auth.currentUser) {
                await signInAnonymously(auth);
            }
            await joinRoom(trimmedGameId, playerName);
            writePlayerSession(trimmedGameId, playerName);
            navigate(`/rooms/${trimmedGameId}/waiting`);
        } catch (err) {
            if (err.message !== 'This game has already started.') {
                setErrorMessage(err.message);
                console.error('Error joining game:', err);
                return;
            }

            try {
                const { requestId } = await requestReconnect(trimmedGameId, playerName);
                navigate(`/rooms/${trimmedGameId}/reconnecting/${requestId}`);
            } catch (reconnectErr) {
                setErrorMessage(reconnectErr.message);
                console.error('Error requesting reconnect:', reconnectErr);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Flex height="100vh" alignItems="center" justifyContent="center" p={4}>
            <Stack as="form" onSubmit={handleSubmit} spacing={4} width="100%" maxWidth="320px">
                <Heading size="lg" textAlign="center">
                    Join Game
                </Heading>
                {errorMessage && (
                    <Alert borderRadius="2xl" status="error" bg="#FF5252">
                        <AlertIcon color="white" />
                        {errorMessage}
                    </Alert>
                )}
                <Input
                    placeholder="Game ID"
                    value={gameId}
                    // Uppercase as you type (Jackbox-style) rather than
                    // only at submit — room codes are stored/matched
                    // uppercase, so this also means it never matters
                    // which case a player actually typed.
                    onChange={(e) => setGameId(e.target.value.toUpperCase())}
                    borderWidth="3px"
                />
                <Input
                    placeholder="Your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    borderWidth="3px"
                    maxLength={40}
                />
                <Button type="submit" colorScheme="teal" isLoading={isSubmitting}>
                    Join
                </Button>
            </Stack>
        </Flex>
    );
};

export default JoinGame;
