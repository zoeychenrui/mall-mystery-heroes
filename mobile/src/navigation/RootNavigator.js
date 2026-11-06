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
                        area — so no stack header on top of it. */}
                    <Stack.Screen
                        name="Game"
                        component={GameScreen}
                        options={{ headerShown: false }}
                        initialParams={initialRouteName === 'Game' ? initialParams : undefined}
                    />
                </Stack.Navigator>
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
