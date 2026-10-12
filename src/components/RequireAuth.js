import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { Center, Spinner } from '@chakra-ui/react';
import { auth } from '../utils/firebase';

// Route guard for the authenticated pages (docs/improvements.md item 3).
// Defense-in-depth only — it stops a signed-out visitor from seeing the
// page render, but the actual data access control is firestore.rules
// (item 2). A route guard alone cannot enforce anything server-side.
const RequireAuth = ({ children }) => {
    const [status, setStatus] = useState('loading');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setStatus(user ? 'authenticated' : 'unauthenticated');
        });
        return unsubscribe;
    }, []);

    if (status === 'loading') {
        return (
            <Center h="100vh">
                <Spinner size="xl" />
            </Center>
        );
    }

    if (status === 'unauthenticated') {
        return <Navigate to="/" replace />;
    }

    return children;
};

export default RequireAuth;
