import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

// RN port of src/components/player_game/PlayerGameHeader.js's
// isTargetPhotoOpen modal block — shown when the player taps one of their
// targets in GameScreen.js's target-list accordion. `target` is either
// `{ name, avatarUrl }` (avatarUrl may be absent) or null while closed.
// Presentational, no Firebase imports of its own.
const TargetPhotoModal = ({ isOpen, onClose, target }) => (
    <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
        <View style={styles.overlay}>
            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>{target?.name}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close target photo"
                        onPress={onClose}
                    >
                        <Text style={styles.close}>✕</Text>
                    </Pressable>
                </View>
                {target?.avatarUrl ? (
                    <Image
                        source={{ uri: target.avatarUrl }}
                        accessibilityLabel={`${target?.name}'s photo`}
                        style={styles.photo}
                    />
                ) : (
                    <Text style={styles.noPhoto}>This player has not added a photo yet.</Text>
                )}
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
        backgroundColor: '#1A202C', // gray.800
        borderRadius: 8,
        padding: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    close: {
        color: '#FFFFFF',
        fontSize: 18,
        paddingHorizontal: 8,
    },
    photo: {
        width: '100%',
        height: 320,
        borderRadius: 8,
        resizeMode: 'contain',
        alignSelf: 'center',
    },
    noPhoto: {
        color: '#FFFFFF',
        textAlign: 'center',
        paddingVertical: 24,
    },
});

export default TargetPhotoModal;
