import { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
// powerUps.js is CommonJS (module.exports) — the web's shop_components use
// `require()` for it because CRA's production build can't statically
// analyze a named ES `import` of a CommonJS file. Metro has no such
// restriction, so this follows the rest of the mobile app's convention
// (e.g. KillPhotoModal.js's import of src/game/photoClaimOptions.js) and
// uses a normal named import.
import {
    POWER_UPS,
    cooldownRemaining,
    purchaseBlockReason,
    formatSeconds,
} from '../../../../src/game/powerUps';

// RN port of src/components/shop_components/{PowerUpShopModal.js,
// ShopItemCard.js, MysteryBoxReveal.js}. Presentational: `score`, `cooldowns`,
// `horcruxActive`, and `pendingMysteryItem` all come from GameScreen's live
// player-doc subscription (and its own isHorcruxActive derivation), and
// `purchasePowerUp`/`claimMysteryReward` are injected rather than imported
// directly, so this file needs no Firebase mocking of its own — GameScreen
// wires them to callables.purchasePowerUp/claimMysteryReward.
//
// A mystery box opens the reveal with what it rolled. A rolled item that
// needs a player picked waits server-side (`pendingMysteryItem`) until it's
// claimed from the reveal — the shop offers it again if the reveal was
// closed first.

// A cooldown end as stored on the player doc is a Firestore Timestamp;
// tests pass plain milliseconds. Accept either.
const toMs = (value) =>
    typeof value?.toMillis === 'function' ? value.toMillis() : (value ?? null);

// Chakra tokens the web version uses for ShopItemCard's background, resolved
// to hex (same approach as GameScreen.js's own `styles`).
const RARITY_COLORS = {
    common: '#EDF2F7', // gray.100
    rare: '#BEE3F8', // blue.100
    mythic: '#F6E05E', // yellow.300
    na: '#FEEBC8', // orange.100
};

// A plain Pressable list standing in for the web's native <Select> — same
// filtering (alive, not self) is done by the caller before this renders.
const PlayerPicker = ({ players, selected, onSelect, groupLabel }) => (
    <View accessibilityRole="radiogroup" accessibilityLabel={groupLabel} style={styles.pickerRow}>
        {players.map((player) => {
            const isSelected = selected === player.name;
            return (
                <Pressable
                    key={player.name}
                    accessibilityRole="radio"
                    accessibilityLabel={player.name}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onSelect(player.name)}
                    style={[styles.playerChip, isSelected && styles.playerChipSelected]}
                >
                    <Text style={styles.playerChipText}>{player.name}</Text>
                </Pressable>
            );
        })}
    </View>
);

// One power-up card (ShopItemCard.js): name, cost/cooldown, description,
// the player picker when the item needs one, Buy, and the disabled reason
// beneath it. While on cooldown the countdown replaces the normal body.
const ShopItemCard = ({
    item,
    secondsLeft,
    disabledReason,
    targetName,
    pickablePlayers,
    onPickTarget,
    onBuy,
}) => {
    const isCoolingDown = secondsLeft > 0;

    return (
        <View
            testID={`shop-item-${item.id}`}
            style={[styles.card, { backgroundColor: RARITY_COLORS[item.rarity] }]}
        >
            {isCoolingDown ? (
                <View style={styles.cooldownOverlay}>
                    <Text style={styles.cooldownText}>{formatSeconds(secondsLeft)}</Text>
                </View>
            ) : (
                <>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <View style={styles.itemMetaRow}>
                        <Text style={styles.itemMetaText}>{item.cost} pts</Text>
                        <Text style={styles.itemMetaText}>
                            {formatSeconds(item.cooldownSeconds)} CD
                        </Text>
                    </View>
                    {item.description && (
                        <Text style={styles.itemDescription}>{item.description}</Text>
                    )}
                    {item.needsTarget && (
                        <>
                            <PlayerPicker
                                players={pickablePlayers}
                                selected={targetName}
                                onSelect={(name) => onPickTarget(item.id, name)}
                                groupLabel={`Player for ${item.name}`}
                            />
                        </>
                    )}
                </>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Buy ${item.name}`}
                accessibilityState={{ disabled: Boolean(disabledReason) }}
                disabled={Boolean(disabledReason)}
                onPress={onBuy}
                style={[styles.buyButton, Boolean(disabledReason) && styles.buyButtonDisabled]}
            >
                <Text style={styles.buyButtonText}>Buy</Text>
            </Pressable>
            {disabledReason && <Text style={styles.disabledReasonText}>{disabledReason}</Text>}
        </View>
    );
};

// The mystery box's result (MysteryBoxReveal.js): a full-screen display
// with the reward centered and Close beneath it. When the box rolled an
// item that needs a player picked, it also asks for one and uses the item
// on them via `onClaim`. Closing without picking leaves that reward
// waiting server-side (`pendingMysteryItem`); the shop offers it again.
const MysteryBoxReveal = ({
    isOpen,
    label,
    needsTarget,
    pickablePlayers,
    unavailableMessage,
    onClaim,
    onClose,
}) => {
    const [targetName, setTargetName] = useState('');
    const [isClaiming, setIsClaiming] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setTargetName('');
            setIsClaiming(false);
            setError(null);
        }
    }, [isOpen]);

    const handleUse = async () => {
        setIsClaiming(true);
        setError(null);
        try {
            await onClaim(targetName);
            setTargetName('');
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsClaiming(false);
        }
    };

    return (
        <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
            <View style={styles.revealOverlay}>
                <View testID="mystery-reveal" style={styles.revealContent}>
                    <Text style={styles.revealKicker}>Mystery box</Text>
                    <Text style={styles.revealLabel}>{label}</Text>
                    {needsTarget && (
                        <>
                            <PlayerPicker
                                players={pickablePlayers}
                                selected={targetName}
                                onSelect={setTargetName}
                                groupLabel="Pick a player for your reward"
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Use"
                                accessibilityState={{
                                    disabled:
                                        !targetName || isClaiming || Boolean(unavailableMessage),
                                }}
                                disabled={!targetName || isClaiming || Boolean(unavailableMessage)}
                                onPress={handleUse}
                                style={[
                                    styles.useButton,
                                    (!targetName || isClaiming || Boolean(unavailableMessage)) &&
                                        styles.useButtonDisabled,
                                ]}
                            >
                                <Text style={styles.useButtonText}>Use</Text>
                            </Pressable>
                        </>
                    )}
                    {unavailableMessage && (
                        <Text style={styles.revealWarning}>{unavailableMessage}</Text>
                    )}
                    {error && <Text style={styles.revealError}>{error}</Text>}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        onPress={onClose}
                        style={styles.revealClose}
                    >
                        <Text style={styles.revealCloseText}>Close</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
};

const PowerUpShopModal = ({
    isOpen,
    onClose,
    roomID,
    playerName = '',
    score,
    cooldowns = {}, // { horcrux: Timestamp, ... } — the player doc's powerUpCooldowns
    players = [],
    horcruxActive = false,
    zonesEnabled = true,
    pendingMysteryItem = null, // an item id, from the player doc
    purchasePowerUp,
    claimMysteryReward,
}) => {
    // What the last mystery box rolled, while its reveal is showing.
    const [reveal, setReveal] = useState(null);
    const [nowMs, setNowMs] = useState(Date.now());
    const [targets, setTargets] = useState({}); // { 'block-camera': 'Alice', ... }
    // The item whose purchase is in flight, so a second tap can't fire a
    // second request before the first one's cooldown has arrived.
    const [buyingItemId, setBuyingItemId] = useState(null);

    // Re-render once a second so cooldown covers sweep and countdowns tick.
    // Only while open — a closed shop has nothing to animate.
    useEffect(() => {
        if (!isOpen) return undefined;
        setNowMs(Date.now()); // catch up on time that passed while closed
        const id = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [isOpen]);

    // Anyone else still in the game. Names are compared case-insensitively,
    // the same way the rest of the app matches player names.
    const pickablePlayers = players.filter(
        (player) => player.isAlive && player.name.toLowerCase() !== playerName.toLowerCase()
    );
    const pendingItem = POWER_UPS.find((item) => item.id === pendingMysteryItem);
    const pendingRewardUnavailable = pendingItem?.requiresGameBoundary === true && !zonesEnabled;

    const handlePickTarget = (itemId, name) => {
        setTargets((prev) => ({ ...prev, [itemId]: name }));
    };

    const handleBuy = async (item) => {
        setBuyingItemId(item.id);
        try {
            const result = await purchasePowerUp({
                roomId: roomID,
                itemId: item.id,
                targetName: targets[item.id],
            });
            if (result?.mysteryBox) {
                setReveal({
                    label: result.mysteryBox.label,
                    needsTarget: result.mysteryBox.needsTarget,
                    itemId: result.mysteryBox.resolution?.itemId ?? null,
                });
            }
            setNowMs(Date.now()); // keep the clock in step, or the timer can briefly show a stale value
        } catch (err) {
            Alert.alert('Purchase failed', err.message);
        } finally {
            setBuyingItemId(null);
        }
    };

    const openPendingReveal = () => {
        setReveal({ label: pendingItem?.name, needsTarget: true, itemId: pendingMysteryItem });
    };

    const revealUnavailableMessage =
        POWER_UPS.find((item) => item.id === reveal?.itemId)?.requiresGameBoundary === true &&
        !zonesEnabled
            ? 'This location reward is unavailable while zones are off.'
            : '';

    return (
        <>
            <Modal visible={isOpen} onRequestClose={onClose} transparent animationType="fade">
                <View style={styles.overlay}>
                    <View style={styles.content}>
                        <View style={styles.header}>
                            <View style={styles.headerTitleRow}>
                                <Text style={styles.title}>Shop</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Close shop"
                                    onPress={onClose}
                                >
                                    <Text style={styles.close}>✕</Text>
                                </Pressable>
                            </View>
                            <View style={styles.headerInfoRow}>
                                <Text style={styles.pointsText}>
                                    Your points: {Number(score) || 0}
                                </Text>
                                <Text style={styles.cdLegendText}>CD = cooldown</Text>
                            </View>
                            {horcruxActive && (
                                <Text style={styles.horcruxBadge}>🛡️ Horcrux active</Text>
                            )}
                        </View>

                        {pendingMysteryItem && !reveal && (
                            <View style={styles.pendingBanner}>
                                <Text style={styles.pendingBannerText}>
                                    Your mystery box reward is waiting: {pendingItem?.name}
                                </Text>
                                {pendingRewardUnavailable && (
                                    <Text style={styles.pendingBannerWarning}>
                                        This location reward is unavailable while zones are off.
                                    </Text>
                                )}
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Pick a player for your mystery reward"
                                    accessibilityState={{ disabled: pendingRewardUnavailable }}
                                    disabled={pendingRewardUnavailable}
                                    onPress={openPendingReveal}
                                    style={[
                                        styles.pendingButton,
                                        pendingRewardUnavailable && styles.pendingButtonDisabled,
                                    ]}
                                >
                                    <Text style={styles.pendingButtonText}>Pick a player</Text>
                                </Pressable>
                            </View>
                        )}

                        <FlatList
                            data={POWER_UPS}
                            keyExtractor={(item) => item.id}
                            numColumns={2}
                            columnWrapperStyle={styles.gridRow}
                            contentContainerStyle={styles.gridBody}
                            renderItem={({ item }) => {
                                const cooldownEndsAtMs = toMs(cooldowns[item.id]);
                                const { secondsLeft } = cooldownRemaining({
                                    cooldownEndsAtMs,
                                    nowMs,
                                    cooldownSeconds: item.cooldownSeconds,
                                });
                                const disabledReason =
                                    buyingItemId === item.id
                                        ? 'Buying…'
                                        : purchaseBlockReason({
                                              item,
                                              score,
                                              cooldownEndsAtMs,
                                              nowMs,
                                              targetName: targets[item.id],
                                              horcruxActive,
                                              boundaryEnabled: zonesEnabled,
                                          });

                                return (
                                    <View style={styles.gridCell}>
                                        <ShopItemCard
                                            item={item}
                                            secondsLeft={secondsLeft}
                                            disabledReason={disabledReason}
                                            targetName={targets[item.id]}
                                            pickablePlayers={pickablePlayers}
                                            onPickTarget={handlePickTarget}
                                            onBuy={() => handleBuy(item)}
                                        />
                                    </View>
                                );
                            }}
                        />
                    </View>
                </View>
            </Modal>
            <MysteryBoxReveal
                isOpen={reveal !== null}
                label={reveal?.label}
                needsTarget={reveal?.needsTarget}
                unavailableMessage={revealUnavailableMessage}
                pickablePlayers={pickablePlayers}
                onClaim={(targetName) => claimMysteryReward({ roomId: roomID, targetName })}
                onClose={() => setReveal(null)}
            />
        </>
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
        padding: 16,
        paddingBottom: 8,
        gap: 4,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
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
    headerInfoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    pointsText: {
        color: '#F6E05E', // yellow.300
        fontSize: 14,
    },
    cdLegendText: {
        color: '#A0AEC0', // gray.400
        fontSize: 14,
    },
    horcruxBadge: {
        color: '#D6BCFA', // purple.300
        fontSize: 13,
    },
    pendingBanner: {
        backgroundColor: '#7B341E', // orange.900
        borderRadius: 6,
        padding: 8,
        marginHorizontal: 16,
        marginBottom: 8,
        gap: 8,
    },
    pendingBannerText: {
        color: '#FFFFFF',
    },
    pendingBannerWarning: {
        color: '#FBD38D', // orange.200
        fontSize: 13,
    },
    pendingButton: {
        backgroundColor: '#DD6B20', // orange.500
        borderRadius: 6,
        paddingVertical: 8,
        alignItems: 'center',
    },
    pendingButtonDisabled: {
        opacity: 0.5,
    },
    pendingButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    gridBody: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    gridRow: {
        gap: 12,
    },
    gridCell: {
        flex: 1,
        marginBottom: 12,
    },
    card: {
        borderRadius: 8,
        padding: 10,
        minHeight: 160,
        gap: 6,
    },
    cooldownOverlay: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 90,
    },
    cooldownText: {
        color: '#1A202C', // gray.800
        fontSize: 24,
        fontWeight: 'bold',
    },
    itemName: {
        color: '#1A202C', // gray.800
        fontWeight: 'bold',
    },
    itemMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    itemMetaText: {
        color: '#1A202C', // gray.800
        fontSize: 13,
    },
    itemDescription: {
        color: '#4A5568', // gray.600
        fontSize: 12,
    },
    pickerRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
    },
    playerChip: {
        borderRadius: 4,
        paddingVertical: 4,
        paddingHorizontal: 8,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#CBD5E0', // gray.300
    },
    playerChipSelected: {
        backgroundColor: '#285E61', // teal.700
        borderColor: '#285E61',
    },
    playerChipText: {
        color: '#1A202C',
        fontSize: 12,
    },
    buyButton: {
        backgroundColor: '#38A169', // green.500
        borderRadius: 6,
        paddingVertical: 8,
        alignItems: 'center',
        marginTop: 'auto',
    },
    buyButtonDisabled: {
        opacity: 0.5,
    },
    buyButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    disabledReasonText: {
        color: '#FEB2B2', // red.200
        fontSize: 12,
        textAlign: 'center',
    },
    revealOverlay: {
        flex: 1,
        backgroundColor: '#4A5568', // gray.700
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    revealContent: {
        alignItems: 'center',
        gap: 16,
        maxWidth: 320,
        width: '100%',
    },
    revealKicker: {
        color: '#CBD5E0', // gray.300
        fontSize: 16,
    },
    revealLabel: {
        color: '#FFFFFF',
        fontSize: 28,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    revealWarning: {
        color: '#FBD38D', // orange.200
        textAlign: 'center',
    },
    revealError: {
        color: '#FEB2B2', // red.300
        textAlign: 'center',
    },
    useButton: {
        backgroundColor: '#DD6B20', // orange.500
        borderRadius: 6,
        paddingVertical: 10,
        paddingHorizontal: 24,
        width: '100%',
        alignItems: 'center',
    },
    useButtonDisabled: {
        opacity: 0.5,
    },
    useButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
    revealClose: {
        borderWidth: 1,
        borderColor: '#FFFFFF',
        borderRadius: 6,
        paddingVertical: 10,
        paddingHorizontal: 24,
        width: '100%',
        alignItems: 'center',
    },
    revealCloseText: {
        color: '#FFFFFF',
    },
});

export default PowerUpShopModal;
