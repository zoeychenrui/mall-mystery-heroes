import { Button } from '@chakra-ui/react';
import React from 'react';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../utils/firebase';

// GameMasterView's own log-out affordance. Needed because DashBoard.js no
// longer has one (it's a redirect resolver with no UI now,
// docs/superpowers/specs/2026-08-08-dashboard-removal-design.md), and a GM
// whose game has already started is redirected straight into
// GameMasterView, bypassing Lobby.js's separate Log Out button entirely.
const LogoutButton = () => {
    const navigate = useNavigate();

    const logout = async () => {
        try {
            await signOut(auth);
            navigate('/');
        } catch (err) {
            console.error('Error signing out:', err);
        }
    };

    return (
        <Button colorScheme="teal" variant="outline" size="md" onClick={logout}>
            Log Out
        </Button>
    );
};

export default LogoutButton;
