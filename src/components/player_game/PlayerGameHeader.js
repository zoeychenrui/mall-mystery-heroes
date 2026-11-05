import React, { useState } from 'react';
import {
    Accordion,
    AccordionButton,
    AccordionIcon,
    AccordionItem,
    AccordionPanel,
    Avatar,
    Box,
    Button,
    Divider,
    Fade,
    Flex,
    Heading,
    HStack,
    IconButton,
    Image,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
    Text,
} from '@chakra-ui/react';
import { BookOpen } from 'lucide-react';
import { normalizePlayerName } from '../../game/playerNames';
import LeaderboardIcon from '../../assets/leaderboard-white.png';
import ExitIcon from '../../assets/exit.png';
import MissionIcon from '../../assets/mission-white.png';
import ShopIcon from '../../assets/shop-white.png';
import LocationIcon from '../../assets/location-white.png';

const PlayerGameHeader = ({
    roomID,
    playerName,
    isGameActive,
    gameStarted,
    playerData,
    players,
    gameBoundaryEnabled,
    canShop,
    avatarInputRef,
    avatarBusy,
    onAvatarChange,
    onLeaveClick,
    onRulesOpen,
    onShopOpen,
    onMissionsOpen,
    onLeaderboardOpen,
    onMapOpen,
}) => {
    const [isTargetsAccordionOpen, setIsTargetsAccordionOpen] = useState(false);
    const [selectedTarget, setSelectedTarget] = useState(null);
    const [isTargetPhotoOpen, setIsTargetPhotoOpen] = useState(false);

    return (
        <>
            <Flex
                as="header"
                direction="column"
                gap={3}
                px={{ base: 4, md: 6 }}
                pt={{ base: 3, md: 4 }}
                pb={4}
                bg="gray.900"
                borderBottom="1px solid"
                borderColor="whiteAlpha.200"
                flexShrink={0}
            >
                <HStack spacing={3} justifyContent="space-between" minW="0">
                    <Flex gap={4} align="center">
                        <Box minW="0">
                            <Text
                                fontSize="xs"
                                color="whiteAlpha.600"
                                textTransform="uppercase"
                                letterSpacing="0.14em"
                            >
                                Mall Mystery Heroes
                            </Text>
                            <Heading size="sm" noOfLines={1}>
                                {playerName || 'You'}{' '}
                                <Text as="span" color="whiteAlpha.600" fontWeight="normal">
                                    · Lobby {roomID}
                                </Text>
                            </Heading>
                        </Box>
                        <IconButton
                            aria-label="Game rules"
                            title="Game rules"
                            icon={<BookOpen size={28} />}
                            onClick={onRulesOpen}
                            variant="ghost"
                            color="white"
                        />
                    </Flex>
                    <IconButton
                        aria-label="Leave"
                        title="Leave Game"
                        icon={<Image src={ExitIcon} alt="" width={8} height={8} />}
                        onClick={onLeaveClick}
                        variant="ghost"
                        m={0}
                    />
                </HStack>
                {isGameActive && gameStarted && playerData?.isAlive && (
                    <Box
                        px={2}
                        py={1.5}
                        bg="purple.900"
                        border="1px solid"
                        borderColor="purple.700"
                        borderRadius="xl"
                    >
                        {(playerData.targets ?? []).length > 0 ? (
                            <Accordion
                                allowToggle
                                index={isTargetsAccordionOpen ? 0 : -1}
                                onChange={(index) => setIsTargetsAccordionOpen(index === 0)}
                            >
                                <AccordionItem border="none">
                                    <AccordionButton
                                        px={1}
                                        py={0}
                                        _hover={{ bg: 'whiteAlpha.100' }}
                                    >
                                        <Box
                                            display="flex"
                                            flexDirection="column"
                                            flex="1"
                                            textAlign="left"
                                        >
                                            <Text
                                                flex="1"
                                                textAlign="left"
                                                fontSize="sm"
                                                fontWeight="semibold"
                                            >
                                                Current target
                                                {playerData.targets.length === 1 ? '' : 's'}
                                                {playerData.targets.length > 1
                                                    ? ` (${playerData.targets.length})`
                                                    : ''}
                                            </Text>
                                            <Fade in={isTargetsAccordionOpen} unmountOnExit>
                                                <Text fontSize="xs" color="whiteAlpha.600">
                                                    Click on a target to view their photo
                                                </Text>
                                            </Fade>
                                        </Box>
                                        <AccordionIcon />
                                    </AccordionButton>
                                    <AccordionPanel px={1} pb={1} pt={2}>
                                        <HStack spacing={1} flexWrap="wrap" rowGap={0}>
                                            {(playerData.targets ?? []).map((targetName) => {
                                                const target = players.find(
                                                    (player) =>
                                                        normalizePlayerName(player.name) ===
                                                        normalizePlayerName(targetName)
                                                );
                                                return (
                                                    <Button
                                                        key={targetName}
                                                        variant="ghost"
                                                        color="white"
                                                        leftIcon={
                                                            <Avatar
                                                                size="xs"
                                                                name={targetName}
                                                                src={target?.avatarUrl}
                                                            />
                                                        }
                                                        size="sm"
                                                        minH={7}
                                                        px={2}
                                                        py={0}
                                                        fontSize="sm"
                                                        onClick={() => {
                                                            setSelectedTarget(
                                                                target || { name: targetName }
                                                            );
                                                            setIsTargetPhotoOpen(true);
                                                        }}
                                                    >
                                                        {targetName}
                                                    </Button>
                                                );
                                            })}
                                        </HStack>
                                    </AccordionPanel>
                                </AccordionItem>
                            </Accordion>
                        ) : (
                            <Text fontSize="sm" fontWeight="semibold">
                                Waiting for your target...
                            </Text>
                        )}
                    </Box>
                )}
                <HStack spacing={2} justifyContent="flex-start" width="100%" overflowX="auto">
                    {playerData && (
                        <>
                            <Box display="flex" flexDirection="column" alignItems="center">
                                <IconButton
                                    aria-label={
                                        playerData.avatarUrl ? 'Change my photo' : 'Add my photo'
                                    }
                                    title={
                                        playerData.avatarUrl ? 'Change my photo' : 'Add my photo'
                                    }
                                    icon={
                                        <Avatar
                                            size="sm"
                                            name={playerName}
                                            src={playerData.avatarUrl}
                                        />
                                    }
                                    onClick={() => avatarInputRef.current?.click()}
                                    isLoading={avatarBusy}
                                    variant="ghost"
                                    minW={10}
                                    p={0}
                                />
                                <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="user"
                                    onChange={onAvatarChange}
                                    aria-label="Take a selfie"
                                    style={{ display: 'none' }}
                                />
                            </Box>
                            <Divider orientation="vertical" mx={2} borderColor="whiteAlpha.400" />
                        </>
                    )}
                    {canShop && (
                        <>
                            <IconButton
                                aria-label="Shop"
                                icon={<Image src={ShopIcon} alt="" width={8} height={8} />}
                                onClick={onShopOpen}
                                variant="ghost"
                            />
                            <Divider orientation="vertical" mx={3} borderColor="whiteAlpha.400" />
                        </>
                    )}
                    <IconButton
                        aria-label="Missions"
                        icon={<Image src={MissionIcon} alt="" width={10} height={10} />}
                        onClick={onMissionsOpen}
                        variant="ghost"
                    />
                    <Divider orientation="vertical" mx={3} borderColor="whiteAlpha.400" />
                    <IconButton
                        aria-label="Leaderboard"
                        icon={<Image src={LeaderboardIcon} alt="" width={10} height={10} />}
                        onClick={onLeaderboardOpen}
                        variant="ghost"
                    />
                    {gameBoundaryEnabled && (
                        <>
                            <Divider
                                orientation="vertical"
                                mx={3}
                                mr={4}
                                borderColor="whiteAlpha.400"
                            />
                            <IconButton
                                aria-label="View Game Map"
                                icon={<Image src={LocationIcon} alt="" width={5} height={8} />}
                                onClick={onMapOpen}
                                variant="ghost"
                            />
                        </>
                    )}
                </HStack>
            </Flex>
            <Modal
                isOpen={isTargetPhotoOpen}
                onClose={() => setIsTargetPhotoOpen(false)}
                isCentered
            >
                <ModalOverlay />
                <ModalContent bg="gray.800" color="white">
                    <ModalHeader>{selectedTarget?.name}</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6} textAlign="center">
                        {selectedTarget?.avatarUrl ? (
                            <Image
                                src={selectedTarget.avatarUrl}
                                alt={`${selectedTarget.name}'s photo`}
                                maxH="65vh"
                                mx="auto"
                                borderRadius="lg"
                            />
                        ) : (
                            <Text>This player has not added a photo yet.</Text>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
};

export default PlayerGameHeader;
