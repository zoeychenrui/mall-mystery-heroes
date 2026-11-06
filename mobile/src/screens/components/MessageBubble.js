import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizePlayerName } from '../../../../src/game/playerNames';
import { formatMessageTime } from '../../../../src/utils/formatMessageTime';

// RN port of src/components/player_messages_components/MessageBubble.js.
// One message's rendering, branching on `message.type` the same way the
// web version does. Not wrapped in React.memo's web-only perf trick here
// in the same way — ChatFeed.js still preserves object identity via
// applyMessageChanges, so a plain function component skips re-rendering
// an unchanged message the same way the web's React.memo does, as long
// as its parent (FlatList) doesn't force new element identities itself.
//
// "3:42 PM" for when a ping's position was captured.
const captureTime = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const MessageBubble = ({ message, playerName, onShowPings }) => {
    const [isPhotoOpen, setIsPhotoOpen] = useState(false);
    const mission = message.mission ?? {};
    // Only 'chat' messages have a sender to compare — every other type
    // (whisper/broadcast/leaderboard/mission) is GM-authored and has no
    // sender field at all, so this guards normalizePlayerName from being
    // called on null/undefined for those.
    const isMine =
        message.sender != null &&
        normalizePlayerName(message.sender) === normalizePlayerName(playerName);
    const time = formatMessageTime(message.timestamp);

    if (message.type === 'leaderboard') {
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Leaderboard</Text>
                {time && <Text style={styles.timeText}>{time}</Text>}
                {(message.standings ?? []).map((entry) => (
                    <Text key={entry.name} style={styles.cardText}>
                        {entry.name}: {entry.score}
                        {!entry.isAlive ? ' (eliminated)' : ''}
                    </Text>
                ))}
            </View>
        );
    }

    if (message.type === 'mission') {
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>New Mission!</Text>
                <Text style={styles.missionTitle}>{mission.title}</Text>
                <Text style={styles.cardText}>{mission.description}</Text>
                <Text style={styles.subtleText}>
                    {mission.taskType} · {mission.pointValue} points ·{' '}
                    {mission.maxCompletions
                        ? `Limited to ${mission.maxCompletions} players`
                        : 'Unlimited players'}
                </Text>
                {time && <Text style={styles.subtleText}>{time}</Text>}
            </View>
        );
    }

    if (message.type === 'gameEndedLeaderboard') {
        // Full final-standings view, GameEndedLeaderboardBubble.js on the
        // web — shares the leaderboard-standings shape with the regular
        // leaderboard modal. In scope for Task 13. Stubbed as plain text
        // until then.
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Final Standings</Text>
                <Text style={styles.cardText}>
                    Game ended — the full leaderboard view is coming soon.
                </Text>
                {time && <Text style={styles.subtleText}>{time}</Text>}
            </View>
        );
    }

    if (message.type === 'killPhoto') {
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>
                    {message.assassin}
                    {message.isFunPhoto ? '' : ' · Photo submission'}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        message.isFunPhoto ? 'View larger fun photo' : 'View larger kill photo'
                    }
                    onPress={() => setIsPhotoOpen(true)}
                >
                    <Image
                        source={{ uri: message.photoUrl }}
                        style={styles.photo}
                        accessibilityIgnoresInvertColors
                    />
                </Pressable>
                <Modal
                    visible={isPhotoOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setIsPhotoOpen(false)}
                >
                    <Pressable
                        style={styles.photoModalOverlay}
                        accessibilityRole="button"
                        accessibilityLabel="Close enlarged photo"
                        onPress={() => setIsPhotoOpen(false)}
                    >
                        <Image
                            source={{ uri: message.photoUrl }}
                            style={styles.enlargedPhoto}
                            resizeMode="contain"
                        />
                    </Pressable>
                </Modal>
                {time && <Text style={styles.subtleText}>{time}</Text>}
            </View>
        );
    }

    if (message.type === 'powerUpPing') {
        // A ping bought from the power-ups shop
        // (functions/callableFunctions/purchasePowerUp.js): a snapshot of
        // where each pinged player was at that moment, from the GPS
        // system's boundaryStatuses. Global pings name who was pinged,
        // never the buyer; personal pings reach only the buyer
        // (recipient-filtered in ChatFeed.js).
        const pings = message.pings ?? [];
        const canShowOnMap = !!onShowPings && pings.some((ping) => ping.lat != null);
        return (
            <View style={styles.pingCard}>
                <Text>
                    <Text style={styles.pingLabel}>
                        {message.source === 'boundaryExposure' ? 'Zone alert' : 'Ping'}
                    </Text>
                    <Text style={styles.pingBodyText}> {message.text}</Text>
                    {time && <Text style={styles.subtleInlineText}> {time}</Text>}
                </Text>
                {pings.map((ping) => (
                    <Text key={ping.name} style={styles.pingDetailText}>
                        {ping.name}:{' '}
                        {ping.lat == null
                            ? 'no location'
                            : `located at ${
                                  ping.capturedAtMs == null
                                      ? 'an unknown time'
                                      : captureTime(ping.capturedAtMs)
                              }${ping.isStale ? ' (old)' : ''}`}
                    </Text>
                ))}
                {canShowOnMap && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="View on map"
                        style={styles.viewOnMapButton}
                        onPress={() => onShowPings(pings)}
                    >
                        <Text style={styles.viewOnMapText}>View on map</Text>
                    </Pressable>
                )}
            </View>
        );
    }

    if (message.type === 'whisper' || message.type === 'broadcast') {
        return (
            <View style={message.type === 'whisper' ? styles.whisperCard : styles.broadcastCard}>
                <Text>
                    <Text style={styles.gmLabel}>GM:</Text>
                    <Text style={styles.gmBodyText}> {message.text}</Text>
                    {time && <Text style={styles.subtleInlineText}> {time}</Text>}
                </Text>
            </View>
        );
    }

    if (message.type === 'chat') {
        return (
            <View
                testID="chat-message"
                style={[styles.chatRow, isMine ? styles.chatRowMine : styles.chatRowTheirs]}
            >
                <View
                    style={[styles.chatBubble, isMine ? styles.chatBubbleMine : styles.chatBubbleTheirs]}
                >
                    <Text>
                        {!isMine && <Text style={styles.chatSender}>{message.sender}: </Text>}
                        <Text style={styles.chatText}>{message.text}</Text>
                    </Text>
                    {time && <Text style={styles.chatTime}>{time}</Text>}
                </View>
            </View>
        );
    }

    // Reached by 'killResult', and by the power-up notices 'horcruxSaved'
    // (killPlayer.js) and 'powerUpNotice' (purchasePowerUp.js) —
    // 'whisper'/'broadcast' have their own GM-labeled branch above.
    return (
        <View style={styles.fallbackCard}>
            <Text>
                <Text style={styles.fallbackText}>{message.text}</Text>
                {time && <Text style={styles.subtleInlineText}> {time}</Text>}
            </Text>
        </View>
    );
};

// Color tokens resolved from @chakra-ui/theme's default palette (the
// version this app actually depends on, @chakra-ui/theme@3.4.8 — see
// docs/superpowers/plans/2026-11-05-react-native-player-app.md's Global
// Constraints for the full named-token list this file draws from).
const TEAL_700 = '#285E61'; // chat bubble, mine
const BLUE_900 = '#1A365D'; // chat bubble, theirs
const GRAY_700 = '#2D3748'; // killPhoto/mission/leaderboard bubble bg
const GRAY_400 = '#A0AEC0'; // whisper border, timestamp text
const PURPLE_900 = '#322659'; // broadcast bubble bg
const PURPLE_400 = '#9F7AEA'; // broadcast bubble border
const WHITE_ALPHA_100 = 'rgba(255, 255, 255, 0.06)'; // whisper bubble bg
const YELLOW_300 = '#F6E05E'; // "GM:" label
const ORANGE_900 = '#652B19'; // powerUpPing bubble bg
const ORANGE_400 = '#ED8936'; // powerUpPing bubble border
const ORANGE_300 = '#F6AD55'; // "Zone alert"/"Ping" label

const styles = StyleSheet.create({
    card: {
        backgroundColor: GRAY_700,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
    },
    cardTitle: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        marginBottom: 4,
    },
    missionTitle: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    cardText: {
        color: '#FFFFFF',
        marginBottom: 4,
    },
    subtleText: {
        color: GRAY_400,
        fontSize: 12,
    },
    photo: {
        width: 220,
        height: 160,
        borderRadius: 6,
    },
    photoModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    enlargedPhoto: {
        width: '90%',
        height: '80%',
    },
    pingCard: {
        backgroundColor: ORANGE_900,
        borderWidth: 1,
        borderColor: ORANGE_400,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    pingLabel: {
        fontWeight: 'bold',
        color: ORANGE_300,
    },
    pingBodyText: {
        color: '#FFFFFF',
    },
    pingDetailText: {
        color: '#E2E8F0',
        fontSize: 13,
    },
    subtleInlineText: {
        color: GRAY_400,
        fontSize: 12,
    },
    viewOnMapButton: {
        marginTop: 4,
        backgroundColor: ORANGE_400,
        borderRadius: 4,
        paddingVertical: 4,
        paddingHorizontal: 8,
        alignSelf: 'flex-start',
    },
    viewOnMapText: {
        color: '#1A202C',
        fontWeight: 'bold',
        fontSize: 12,
    },
    whisperCard: {
        backgroundColor: WHITE_ALPHA_100,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: GRAY_400,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    broadcastCard: {
        backgroundColor: PURPLE_900,
        borderWidth: 1,
        borderColor: PURPLE_400,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    gmLabel: {
        fontWeight: 'bold',
        color: YELLOW_300,
    },
    gmBodyText: {
        color: '#FFFFFF',
    },
    chatRow: {
        flexDirection: 'row',
        marginBottom: 8,
    },
    chatRowMine: {
        justifyContent: 'flex-end',
    },
    chatRowTheirs: {
        justifyContent: 'flex-start',
    },
    chatBubble: {
        borderRadius: 6,
        padding: 8,
        maxWidth: '75%',
    },
    chatBubbleMine: {
        backgroundColor: TEAL_700,
    },
    chatBubbleTheirs: {
        backgroundColor: BLUE_900,
    },
    chatSender: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    chatText: {
        color: '#FFFFFF',
    },
    chatTime: {
        color: GRAY_400,
        fontSize: 12,
        marginTop: 4,
    },
    fallbackCard: {
        backgroundColor: GRAY_700,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    fallbackText: {
        color: '#FFFFFF',
    },
});

export default MessageBubble;
