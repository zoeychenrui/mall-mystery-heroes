import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import JoinScreen from '../screens/JoinScreen';
import ReconnectPendingScreen from '../screens/ReconnectPendingScreen';

// 'Game' is registered here so JoinScreen (and now ReconnectPendingScreen)
// can navigate to it by name, but its real screen is Task 7's job — this
// placeholder exists only so the app doesn't crash on navigation before
// that task lands, and gets replaced wholesale (not merged) once the real
// screen exists.
function GamePlaceholder() {
    return (
        <View>
            <Text>Game screen — real screen lands in Task 7.</Text>
        </View>
    );
}

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
                    <Stack.Screen name="Game" component={GamePlaceholder} />
                </Stack.Navigator>
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
