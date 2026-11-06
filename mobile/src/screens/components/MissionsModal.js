import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

// RN port of src/components/task_components/PlayerTaskListModal.js (and the
// PlayerTaskList/PlayerTaskAccordion it wraps), read-only. Takes the room's
// missions as a prop — GameScreen already subscribes to them. The copy
// line matches MessageBubble's 'mission' branch exactly.
const MissionsModal = ({ isOpen, onClose, missions }) => (
    <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
        <View style={styles.overlay}>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>Missions</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close missions"
                        onPress={onClose}
                    >
                        <Text style={styles.close}>✕</Text>
                    </Pressable>
                </View>
                <FlatList
                    data={missions}
                    keyExtractor={(mission, index) => `${index}-${mission.title}`}
                    contentContainerStyle={styles.body}
                    ListEmptyComponent={<Text style={styles.empty}>No missions yet.</Text>}
                    renderItem={({ item: mission }) => (
                        <View style={styles.card}>
                            <Text style={styles.missionTitle}>{mission.title}</Text>
                            <Text style={styles.missionText}>{mission.description}</Text>
                            <Text style={styles.subtleText}>
                                {mission.taskType} · {mission.pointValue} points ·{' '}
                                {mission.maxCompletions
                                    ? `Limited to ${mission.maxCompletions} players`
                                    : 'Unlimited players'}
                            </Text>
                        </View>
                    )}
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
    card: {
        backgroundColor: '#2D3748', // gray.700
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
    },
    missionTitle: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        marginBottom: 4,
    },
    missionText: {
        color: '#FFFFFF',
        marginBottom: 4,
    },
    subtleText: {
        color: '#A0AEC0', // gray.400
        fontSize: 12,
    },
    empty: {
        color: '#A0AEC0',
        textAlign: 'center',
        marginTop: 16,
    },
});

export default MissionsModal;
