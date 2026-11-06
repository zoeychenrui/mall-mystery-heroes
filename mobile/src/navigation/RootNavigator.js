import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import JoinScreen from '../screens/JoinScreen';

// 'ReconnectPending' and 'Game' are registered here so JoinScreen can
// navigate to them by name, but their real screens are Tasks 7 and 6's
// jobs respectively — these placeholders exist only so the app doesn't
// crash on navigation before those tasks land, and get replaced wholesale
// (not merged) once the real screens exist.
function ReconnectPendingPlaceholder() {
    return (
        <View>
            <Text>Reconnect pending — real screen lands in Task 7.</Text>
        </View>
    );
}

function GamePlaceholder() {
    return (
        <View>
            <Text>Game screen — real screen lands in Task 6.</Text>
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
                    <Stack.Screen name="ReconnectPending" component={ReconnectPendingPlaceholder} />
                    <Stack.Screen name="Game" component={GamePlaceholder} />
                </Stack.Navigator>
            </NavigationContainer>
        </SafeAreaProvider>
    );
}
