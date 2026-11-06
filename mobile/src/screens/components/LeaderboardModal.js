import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

// RN port of src/components/game_end_components/LeaderboardModal.js.
// Presentational: the caller hands in the standings array, already sorted
// by buildLeaderboardStandings. The standings-line rendering is exported
// so MessageBubble's 'gameEndedLeaderboard' branch shows the same copy.

// "1. Alice — 30", plus " (eliminated)" for dead players.
export const standingLabel = (entry, index) =>
    `${index + 1}. ${entry.name} — ${entry.score}${entry.isAlive ? '' : ' (eliminated)'}`;

export const StandingLine = ({ entry, index }) => (
    <Text style={[styles.line, !entry.isAlive && styles.lineEliminated]}>
        {standingLabel(entry, index)}
    </Text>
);

const LeaderboardModal = ({ isOpen, onClose, standings }) => (
    <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
        <View style={styles.overlay}>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>Leaderboard</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close leaderboard"
                        onPress={onClose}
                    >
                        <Text style={styles.close}>✕</Text>
                    </Pressable>
                </View>
                <FlatList
                    data={standings}
                    keyExtractor={(entry) => entry.name}
                    renderItem={({ item, index }) => <StandingLine entry={item} index={index} />}
                    contentContainerStyle={styles.body}
                />
            </View>
        </View>
    </Modal>
);

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        padding: 16,
    },
    content: {
        backgroundColor: '#202030',
        borderRadius: 8,
        maxHeight: '85%',
        overflow: 'hidden',
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
    close: {
        color: '#FFFFFF',
        fontSize: 18,
        paddingHorizontal: 8,
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
});

export default LeaderboardModal;
