import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import JoinScreen from '../screens/JoinScreen';
import ReconnectPendingScreen from '../screens/ReconnectPendingScreen';
import GameScreen from '../screens/GameScreen';

const Stack = createNativeStackNavigator();

// initialRouteName/initialParams let App.js's launch-time session check
// (Task 8) choose 'Game' (with {roomID}) instead of the 'Join' default, once
// it knows whether a stored session plus a signed-in user both exist.
export default function RootNavigator({ initialRouteName = 'Join', initialParams }) {
    return (
        <SafeAreaProvider>
            <NavigationContainer>
                <Stack.Navigator initialRouteName={initialRouteName}>
                    <Stack.Screen name="Join" component={JoinScreen} />
                    <Stack.Screen name="ReconnectPending" component={ReconnectPendingScreen} />
                    {/* GameScreen draws its own header (name, lobby, Rules,
                        Leave), like the web page, and handles its own safe
                        area — so no stack header on top of it.
                        gestureEnabled: false (Task 16 QA, real-device bug):
                        iOS's native swipe-back gesture used to pop this
                        screen straight back to Join without running any of
                        GameScreen's cleanup (no Leave flow, no
                        clearPlayerSession) — the player's uid stayed in the
                        room's joinedUids and their stored session stayed
                        intact, leaving them stuck when they tried to
                        rejoin. The only way off this screen now is the
                        explicit Leave button/confirmation below. This is
                        iOS-only (@react-navigation/native-stack@7's own
                        gestureEnabled doc: "Only supported on iOS"); see
                        GameScreen.js's BackHandler listener for why Android
                        needs its own, separate fix. */}
                    <Stack.Screen
                        name="Game"
                        component={GameScreen}
                        options={{ headerShown: false, gestureEnabled: false }}
                        initialParams={initialRouteName === 'Game' ? initialParams : undefined}
                    />
                </Stack.Navigator>
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
