import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

// The Clash-Royale-style bottom bar: five fixed icons, always in the same
// order (Shop, Missions, Chat, Leaderboard, Map) — tapping one jumps
// GameScreen's PagerView straight to that page; swiping between pages
// (GameScreen's own PagerView) keeps this in sync the other way, via
// `activePage`. There is no hiding/disabling any of the five — the item
// shop and the map both already explain themselves when they can't be
// used right now (purchaseBlockReason's per-item reasons; an empty map
// when zones aren't enabled), so a tab disappearing or going gray here
// would just be one more thing to keep in sync for no real benefit.
export const TABS = [
    { label: 'Shop', icon: require('../../../assets/icons/shop-white.png') },
    { label: 'Missions', icon: require('../../../assets/icons/mission-white.png') },
    { label: 'Chat', emoji: '💬' },
    { label: 'Leaderboard', icon: require('../../../assets/icons/leaderboard-white.png') },
    { label: 'Map', icon: require('../../../assets/icons/location-white.png') },
];

const BottomTabBar = ({ activePage, onSelect }) => (
    <View style={styles.bar}>
        {TABS.map((tab, index) => {
            const isActive = index === activePage;
            return (
                <Pressable
                    key={tab.label}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: isActive }}
                    onPress={() => onSelect(index)}
                    style={styles.tab}
                >
                    {tab.icon ? (
                        <Image
                            source={tab.icon}
                            style={[styles.icon, isActive && styles.iconActive]}
                        />
                    ) : (
                        <Text style={[styles.emoji, isActive && styles.iconActive]}>
                            {tab.emoji}
                        </Text>
                    )}
                    <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
                </Pressable>
            );
        })}
    </View>
);

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        backgroundColor: '#171923', // gray.900, matches GameScreen's header
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.16)', // whiteAlpha.200
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        gap: 2,
    },
    icon: {
        width: 22,
        height: 22,
        resizeMode: 'contain',
        opacity: 0.6,
    },
    emoji: {
        fontSize: 18,
        opacity: 0.6,
    },
    iconActive: {
        opacity: 1,
    },
    label: {
        fontSize: 11,
        color: 'rgba(255, 255, 255, 0.6)', // whiteAlpha.600
    },
    labelActive: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
});

export default BottomTabBar;
