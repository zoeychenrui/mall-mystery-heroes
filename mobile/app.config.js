// Dynamic Expo config. EXPO_PUBLIC_-prefixed env vars (see .env / .env.example)
// are inlined by Expo automatically at build/runtime via process.env — no
// plugin or `extra` passthrough is required for firebaseConfig.js to read
// them, but the keys are also surfaced under `extra` here so any other
// consumer (e.g. `expo-constants`) can reach them without re-deriving the list.
export default {
    expo: {
        name: 'Mall Mystery Heroes',
        slug: 'mall-mystery-heroes-player',
        version: '1.0.0',
        orientation: 'portrait',
        icon: './assets/icon.png',
        userInterfaceStyle: 'light',
        ios: {
            supportsTablet: true,
        },
        android: {
            adaptiveIcon: {
                backgroundColor: '#E6F4FE',
                foregroundImage: './assets/android-icon-foreground.png',
                backgroundImage: './assets/android-icon-background.png',
                monochromeImage: './assets/android-icon-monochrome.png',
            },
        },
        web: {
            favicon: './assets/favicon.png',
        },
        extra: {
            firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
            firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
            firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
            firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
            firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
            firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
        },
    },
};
