import { useEffect, useState } from 'react';
import RootNavigator from './src/navigation/RootNavigator';
import { readPlayerSession } from './src/utils/playerSession';
import { auth } from './src/firebase/firebaseConfig';

// Decides, once, which screen the app should land on: a stored session plus
// a still-signed-in user resumes straight into the game; anything else (no
// stored session, or a session with nobody signed in) starts at Join, same
// as a fresh install. GameScreen's own subscription-error handling (Task 7)
// covers a resumed room/player that no longer exists — this only decides
// which screen to show first, nothing more.
export default function App() {
    const [initialRoute, setInitialRoute] = useState(null);

    useEffect(() => {
        let cancelled = false;
        readPlayerSession().then((session) => {
            if (cancelled) return;
            if (session && auth.currentUser) {
                setInitialRoute({ name: 'Game', params: { roomID: session.roomID } });
            } else {
                setInitialRoute({ name: 'Join', params: undefined });
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Render nothing while the session read is in flight, rather than
    // mounting RootNavigator with a default route and then swapping it out
    // from under the user.
    if (initialRoute === null) return null;

    return (
        <RootNavigator initialRouteName={initialRoute.name} initialParams={initialRoute.params} />
    );
}
