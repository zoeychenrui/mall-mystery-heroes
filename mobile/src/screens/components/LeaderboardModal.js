import { FlatList, StyleSheet, Text, View } from 'react-native';

// RN port of src/components/game_end_components/LeaderboardModal.js —
// despite the filename, this is now one of GameScreen's five swipeable
// pages (the Clash-Royale-style redesign), not a popup: GameScreen renders
// it directly as a PagerView page, with no isOpen/onClose — there is
// nothing to close, since switching away is just swiping or tapping
// another bottom tab. Presentational: the caller hands in the standings
// array, already sorted by buildLeaderboardStandings. The standings-line
// rendering is exported so MessageBubble's 'gameEndedLeaderboard' branch
// shows the same copy.

// "1. Alice — 30", plus " (eliminated)" for dead players.
export const standingLabel = (entry, index) =>
    `${index + 1}. ${entry.name} — ${entry.score}${entry.isAlive ? '' : ' (eliminated)'}`;

export const StandingLine = ({ entry, index }) => (
    <Text style={[styles.line, !entry.isAlive && styles.lineEliminated]}>
        {standingLabel(entry, index)}
    </Text>
);

const LeaderboardModal = ({ standings }) => (
    <View style={styles.page}>
        <View style={styles.header}>
            <Text style={styles.title}>Leaderboard</Text>
        </View>
        <FlatList
            data={standings}
            keyExtractor={(entry) => entry.name}
            renderItem={({ item, index }) => <StandingLine entry={item} index={index} />}
            contentContainerStyle={styles.body}
            ListEmptyComponent={<Text style={styles.empty}>No standings yet.</Text>}
        />
    </View>
);

const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: '#202030',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: 'bold',
    },
    body: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    line: {
        color: '#FFFFFF',
        marginBottom: 6,
    },
    lineEliminated: {
        color: '#A0AEC0', // gray.400
    },
    empty: {
        color: '#A0AEC0', // gray.400
        textAlign: 'center',
        marginTop: 16,
    },
});

export default LeaderboardModal;
