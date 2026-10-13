import React, { useEffect, useState } from 'react';
import {
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
    Select,
    SimpleGrid,
    Text,
} from '@chakra-ui/react';
import ShopItemCard from './ShopItemCard';
import CreateAlert from '../CreateAlert';
import { purchasePowerUp } from '../purchasePowerUp';
// require(), not a named `import` — powerUps.js is CommonJS (module.exports)
// so a future Cloud Function can reuse it, and CRA's production build can't
// statically analyze a named ES `import` of a CommonJS file. Same reason as
// PlayerGame.js's require of gameBoundary.js.
const { POWER_UPS, cooldownRemaining, purchaseBlockReason } = require('../../game/powerUps');

// A cooldown end as stored on the player doc is a Firestore Timestamp;
// tests pass plain milliseconds. Accept either.
const toMs = (value) =>
    typeof value?.toMillis === 'function' ? value.toMillis() : (value ?? null);

/**
 * The player's power-ups shop (POWER_UPS_SPEC.md). Buying calls the
 * purchasePowerUp Cloud Function, which deducts the points and stores the
 * cooldown on the player doc. This component holds neither: `score` and
 * `cooldowns` both arrive from PlayerGame's live player-doc subscription,
 * so they update on their own after a purchase and survive a reload.
 * Item effects are not implemented yet.
 */
const PowerUpShopModal = ({
    isOpen,
    onClose,
    roomID,
    score,
    cooldowns = {}, // { horcrux: Timestamp, ... } — the player doc's powerUpCooldowns
    players = [],
    playerName = '',
}) => {
    const [nowMs, setNowMs] = useState(Date.now());
    const [targets, setTargets] = useState({}); // { 'block-camera': 'Alice', ... }
    // The item whose purchase is in flight, so a second tap can't fire a
    // second request before the first one's cooldown has arrived.
    const [buyingItemId, setBuyingItemId] = useState(null);
    const createAlert = CreateAlert();

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

    const handleBuy = async (item) => {
        setBuyingItemId(item.id);
        try {
            await purchasePowerUp({
                roomId: roomID,
                itemId: item.id,
                targetName: targets[item.id],
            });
            setNowMs(Date.now()); // keep the clock in step, or the timer can briefly show 6:01
        } catch (err) {
            createAlert('error', 'Purchase failed', err.message, 1500);
        } finally {
            setBuyingItemId(null);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
            <ModalOverlay />
            <ModalContent bg="#202030" color="white">
                <ModalHeader>
                    Shop
                    <Text fontSize="md" fontWeight="normal" color="yellow.300">
                        Your points: {Number(score) || 0}
                    </Text>
                </ModalHeader>
                <ModalCloseButton aria-label="Close shop" />
                <ModalBody pb={6}>
                    <SimpleGrid columns={2} spacing={3}>
                        {POWER_UPS.map((item) => {
                            const cooldownEndsAtMs = toMs(cooldowns[item.id]);
                            const { secondsLeft, fractionLeft } = cooldownRemaining({
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
                                      });

                            return (
                                <ShopItemCard
                                    key={item.id}
                                    item={item}
                                    secondsLeft={secondsLeft}
                                    fractionLeft={fractionLeft}
                                    disabledReason={disabledReason}
                                    onBuy={() => handleBuy(item)}
                                >
                                    {item.needsTarget && (
                                        <Select
                                            size="sm"
                                            bg="white"
                                            placeholder="Pick a player"
                                            aria-label={`Player for ${item.name}`}
                                            value={targets[item.id] ?? ''}
                                            onChange={(e) =>
                                                setTargets((prev) => ({
                                                    ...prev,
                                                    [item.id]: e.target.value,
                                                }))
                                            }
                                        >
                                            {pickablePlayers.map((player) => (
                                                <option key={player.name} value={player.name}>
                                                    {player.name}
                                                </option>
                                            ))}
                                        </Select>
                                    )}
                                </ShopItemCard>
                            );
                        })}
                    </SimpleGrid>
                </ModalBody>
            </ModalContent>
        </Modal>
    );
};

export default PowerUpShopModal;
