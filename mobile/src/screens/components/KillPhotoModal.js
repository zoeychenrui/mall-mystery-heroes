import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { buildPhotoClaimOptions } from '../../../../src/game/photoClaimOptions';

// A player submits a kill-photo or mission-photo claim. RN port of
// src/components/player_messages_components/KillPhotoModal.js — same
// `buildPhotoClaimOptions` call, grouped the same way (Kill Target /
// Mission / Socials), plus the always-present `{value: 'fun'}` option the
// web component adds directly (buildPhotoClaimOptions only ever returns
// real target/mission options). Presentational: ChatComposer.js owns
// capturing, compressing, and uploading/writing the photo, and hands this
// modal whatever it has so far (previewUrl/error), reading back the
// player's resolved claim via onSubmit.
const FUN_OPTION = { value: 'fun', label: 'Just for fun', group: 'Socials' };

const KillPhotoModal = ({
    isOpen,
    onClose,
    previewUrl,
    error,
    onSubmit,
    players,
    missions,
    playerName,
}) => {
    const [selectedOption, setSelectedOption] = useState('');

    // A pick made before the modal was last opened must never carry over
    // into the next photo's default.
    useEffect(() => {
        if (isOpen) setSelectedOption('');
    }, [isOpen]);

    const realOptions = buildPhotoClaimOptions(players, missions, playerName);
    const killTargetOptions = realOptions.filter((option) => option.group === 'Kill Target');
    const missionOptions = realOptions.filter((option) => option.group === 'Mission');
    const hasRealOptions = realOptions.length > 0;

    // Prefer a real kill or mission claim whenever one is available. The
    // player can explicitly switch to a fun photo in the same picker. 'fun'
    // is always a valid fallback, so a selection always exists now.
    const effectiveSelection =
        selectedOption === 'fun' || realOptions.some((option) => option.value === selectedOption)
            ? selectedOption
            : (realOptions[0]?.value ?? 'fun');

    const renderOption = (option) => {
        const isSelected = effectiveSelection === option.value;
        return (
            <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedOption(option.value)}
                style={styles.optionRow}
            >
                <Text style={styles.optionMark}>{isSelected ? '●' : '○'}</Text>
                <Text style={styles.optionLabel}>{option.label}</Text>
            </Pressable>
        );
    };

    return (
        <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
            <View style={styles.overlay}>
                <View style={styles.content}>
                    <Text style={styles.title}>Submit a Photo</Text>
                    {previewUrl && (
                        <Image
                            source={{ uri: previewUrl }}
                            accessibilityLabel="Kill photo preview"
                            style={styles.preview}
                        />
                    )}
                    {error && <Text style={styles.error}>{error}</Text>}
                    {!previewUrl && !error && (
                        <Text style={styles.processing}>Processing photo…</Text>
                    )}
                    {hasRealOptions ? (
                        <View accessibilityRole="radiogroup" accessibilityLabel="Photo type">
                            {killTargetOptions.length > 0 && (
                                <View style={styles.group}>
                                    <Text style={styles.groupLabel}>Kill Target</Text>
                                    {killTargetOptions.map(renderOption)}
                                </View>
                            )}
                            {missionOptions.length > 0 && (
                                <View style={styles.group}>
                                    <Text style={styles.groupLabel}>Mission</Text>
                                    {missionOptions.map(renderOption)}
                                </View>
                            )}
                            <View style={styles.group}>
                                <Text style={styles.groupLabel}>Socials</Text>
                                {renderOption(FUN_OPTION)}
                            </View>
                        </View>
                    ) : (
                        <Text style={styles.noOptions}>
                            No open targets or missions; this will be a fun photo.
                        </Text>
                    )}
                    <View style={styles.footer}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Close"
                            onPress={onClose}
                            style={styles.closeButton}
                        >
                            <Text style={styles.closeButtonText}>Close</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Submit"
                            accessibilityState={{ disabled: !previewUrl }}
                            disabled={!previewUrl}
                            onPress={() => onSubmit(effectiveSelection)}
                            style={[styles.submitButton, !previewUrl && styles.submitButtonDisabled]}
                        >
                            <Text style={styles.submitButtonText}>Submit</Text>
                        </Pressable>
                    </View>
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
        padding: 16,
        maxHeight: '85%',
    },
    title: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    preview: {
        width: '100%',
        height: 200,
        borderRadius: 4,
        marginBottom: 16,
        resizeMode: 'contain',
    },
    error: {
        color: '#FEB2B2', // red.200
        marginBottom: 16,
    },
    processing: {
        color: '#FFFFFF',
        marginBottom: 16,
    },
    noOptions: {
        color: '#A0AEC0', // gray.400
        marginBottom: 16,
    },
    group: {
        marginBottom: 12,
    },
    groupLabel: {
        color: '#A0AEC0', // gray.400
        fontSize: 12,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
        gap: 8,
    },
    optionMark: {
        color: '#FFFFFF',
        width: 16,
    },
    optionLabel: {
        color: '#FFFFFF',
        flexShrink: 1,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 8,
        gap: 8,
    },
    closeButton: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 6,
    },
    closeButtonText: {
        color: '#FFFFFF',
    },
    submitButton: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 6,
        backgroundColor: '#285E61', // teal.700
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
});

export default KillPhotoModal;
