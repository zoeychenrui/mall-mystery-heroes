import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

// RN port of src/components/task_components/PlayerTaskListModal.js, with
// PlayerTaskList.js's Active/Completed split and PlayerTaskAccordion.js's
// per-task details (taskIndex, completions counter, completed-by or
// "Incomplete"). Read-only. Takes the room's missions as a prop —
// GameScreen already subscribes to them — and splits them client-side by
// isComplete, the same two buckets the web's two Firestore queries return.
// The copy line matches MessageBubble's 'mission' branch exactly.

// Web's PlayerTaskAccordion: "Incomplete" unless the task is complete, then
// "Completed By: <names>" (or "None" if nobody is recorded).
export const completedByText = (mission) => {
    if (!mission.isComplete) return 'Incomplete';
    const completedBy = mission.completedBy ?? [];
    return `Completed By: ${completedBy.length ? completedBy.join(', ') : 'None'}`;
};

// "Completions: 1 / 2", or just "Completions: 3" when there is no limit.
export const completionsText = (mission) => {
    const count = (mission.completedBy ?? []).length;
    return `Completions: ${count}${mission.maxCompletions ? ` / ${mission.maxCompletions}` : ''}`;
};

const TABS = [
    { key: 'active', label: 'Active', emptyText: 'No active missions.' },
    { key: 'completed', label: 'Completed', emptyText: 'No completed missions.' },
];

const MissionsModal = ({ isOpen, onClose, missions }) => {
    const [tab, setTab] = useState('active');
    const activeMissions = missions.filter((mission) => !mission.isComplete);
    const completedMissions = missions.filter((mission) => mission.isComplete);
    const shownMissions = tab === 'active' ? activeMissions : completedMissions;
    const counts = { active: activeMissions.length, completed: completedMissions.length };
    const activeTab = TABS.find((item) => item.key === tab);

    return (
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
                    <View style={styles.tabRow}>
                        {TABS.map((item) => {
                            const isSelected = tab === item.key;
                            return (
                                <Pressable
                                    key={item.key}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: isSelected }}
                                    onPress={() => setTab(item.key)}
                                    style={[styles.tab, isSelected && styles.tabSelected]}
                                >
                                    <Text
                                        style={[
                                            styles.tabText,
                                            isSelected && styles.tabTextSelected,
                                        ]}
                                    >
                                        {`${item.label} (${counts[item.key]})`}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <FlatList
                        data={shownMissions}
                        keyExtractor={(mission, index) => `${index}-${mission.title}`}
                        contentContainerStyle={styles.body}
                        ListEmptyComponent={<Text style={styles.empty}>{activeTab.emptyText}</Text>}
                        renderItem={({ item: mission }) => (
                            <View style={styles.card}>
                                {mission.taskIndex != null && (
                                    <Text style={styles.taskIndex}>#{mission.taskIndex}</Text>
                                )}
                                <Text style={styles.missionTitle}>{mission.title}</Text>
                                <Text style={styles.missionText}>{mission.description}</Text>
                                <Text style={styles.subtleText}>
                                    {mission.taskType} · {mission.pointValue} points ·{' '}
                                    {mission.maxCompletions
                                        ? `Limited to ${mission.maxCompletions} players`
                                        : 'Unlimited players'}
                                </Text>
                                <Text style={styles.subtleText}>{completionsText(mission)}</Text>
                                <Text style={styles.missionText}>{completedByText(mission)}</Text>
                            </View>
                        )}
                    />
                </View>
            </View>
        </Modal>
    );
};

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
    tabRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 8,
        marginBottom: 8,
    },
    tab: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: '#2D3748', // gray.700
    },
    tabSelected: {
        backgroundColor: '#285E61', // teal.700
    },
    tabText: {
        color: '#A0AEC0', // gray.400
        fontWeight: 'bold',
        fontSize: 13,
    },
    tabTextSelected: {
        color: '#FFFFFF',
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
    taskIndex: {
        color: '#A0AEC0', // gray.400
        fontSize: 12,
        marginBottom: 2,
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
