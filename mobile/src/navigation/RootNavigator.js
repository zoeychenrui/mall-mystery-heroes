import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import JoinScreen from '../screens/JoinScreen';
import ReconnectPendingScreen from '../screens/ReconnectPendingScreen';
import GameScreen from '../screens/GameScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
    return (
        <SafeAreaProvider>
            <NavigationContainer>
                {/* 'Join' is the initial route for now; Task 8 replaces this
                    with a conditional decision based on a stored player
                    session (auto-resume). */}
                <Stack.Navigator initialRouteName="Join">
                    <Stack.Screen name="Join" component={JoinScreen} />
                    <Stack.Screen name="ReconnectPending" component={ReconnectPendingScreen} />
                    {/* GameScreen draws its own header (name, lobby, Rules,
                        Leave), like the web page, and handles its own safe
                        area — so no stack header on top of it. */}
                    <Stack.Screen
                        name="Game"
                        component={GameScreen}
                        options={{ headerShown: false }}
                    />
                </Stack.Navigator>
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
