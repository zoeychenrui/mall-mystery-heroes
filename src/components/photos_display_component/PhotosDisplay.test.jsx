/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 6 end to end: judgedPhotos is now derived
 * from Firestore on every snapshot (via src/game/photoJudgments.js), not
 * accumulated in local state. This proves the actual bug scenario — undo
 * works for a photo judged in an *earlier* session, reconstructed purely
 * from what onSnapshot reports on mount, never clicked through here.
 *
 * `executeKill` is a thin wrapper around a Cloud Function call now
 * (docs/improvements.md item 4) — validation, scoring, unmapping, and
 * remapping all happen server-side, so this mocks `executeKill` itself
 * rather than the individual Firestore calls it used to make.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import PhotosDisplay from './PhotosDisplay';
import { gameContext, executionContext } from '../Contexts';
import * as dbCalls from '../firebase_calls/dbCalls';
import { executeKill } from '../executeKill';
import { undoKill } from '../undoKill';
import { completeMission } from '../completeMission';
import { undoMissionPhotoApproval } from '../undoMissionPhotoApproval';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../firebase_calls/dbCalls', () => ({
    addPlayerMessageForRoom: jest.fn(),
    approvePhotoAsMissionForRoom: jest.fn(),
    approvePhotoForRoom: jest.fn(),
    fetchPhotosQueryByAscendingTimestampForRoom: jest.fn(() => 'photos-query'),
    fetchTasksQueryForRoom: jest.fn(() => 'missions-query'),
    updatePhotoStatusForRoom: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));
jest.mock('../undoKill', () => ({ undoKill: jest.fn() }));
jest.mock('../completeMission', () => ({ completeMission: jest.fn() }));
jest.mock('../undoMissionPhotoApproval', () => ({ undoMissionPhotoApproval: jest.fn() }));

const executionHandlers = {
    addLog: jest.fn(),
    handleRemapping: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
    handlePlayerRevive: jest.fn(),
    handleOpenSznended: jest.fn(),
};

// Only used for display-name resolution (resolvePlayerDisplayName) in the
// mission-completion announcement tests below — the claim itself now comes
// straight off the photo doc's own target/mission fields, not from this
// roster.
const defaultPlayers = [
    { name: 'alice', targets: ['bob'] },
    { name: 'bob', targets: ['alice'] },
    { name: 'carol', targets: ['dave'] },
    { name: 'dave', targets: [] },
];

/**
 * Simulates the given photo docs as what onSnapshot reports immediately on
 * mount. Returns a function that delivers a later snapshot update (photo IDs
 * are reassigned by array index each call, so keeping a photo at the same
 * index across calls keeps its ID stable).
 */
const mountWithSnapshot = (photoDocs, players = defaultPlayers, missions = []) => {
    let deliverPhotoUpdate;
    onSnapshot.mockImplementation((query, onNext) => {
        if (query === 'photos-query') {
            deliverPhotoUpdate = onNext;
            onNext({
                docs: photoDocs.map((data, i) => ({ id: `photo-${i}`, data: () => data })),
            });
        } else {
            onNext({ docs: missions.map((data) => ({ data: () => data })) });
        }
        return () => {};
    });

    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <PhotosDisplay players={players} />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );

    return (nextPhotoDocs) =>
        act(async () => {
            deliverPhotoUpdate({
                docs: nextPhotoDocs.map((data, i) => ({ id: `photo-${i}`, data: () => data })),
            });
        });
};

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.updatePhotoStatusForRoom.mockResolvedValue(undefined);
    dbCalls.addPlayerMessageForRoom.mockResolvedValue(undefined);
    dbCalls.approvePhotoAsMissionForRoom.mockResolvedValue(undefined);
    undoKill.mockResolvedValue(undefined);
    completeMission.mockResolvedValue({
        reversalSnapshot: { missionIndex: 1, playerName: 'bob', wasAutoEnded: false, players: {} },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
        taskTitle: 'Find the clue',
        maxCompletions: null,
        revivesPlayer: false,
    });
    undoMissionPhotoApproval.mockResolvedValue(undefined);
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        preKillSnapshot: {
            alice: { score: 0, targets: [], assassins: [], isAlive: true, openSeason: false },
        },
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});

describe('reconstructing judged photos from Firestore (improvements item 6)', () => {
    it('can undo a photo approved in an earlier session, using its persisted snapshot', async () => {
        // Nothing was clicked in this render — this photo's approval and its
        // originalPlayerData snapshot both come purely from what Firestore
        // reports, simulating a reload after the approval happened earlier.
        mountWithSnapshot([
            {
                status: 'approved',
                target: 'alice',
                assassin: 'bob',
                originalPlayerData: {
                    alice: { score: 7, targets: ['carol'], assassins: ['dave'], isAlive: true },
                },
            },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        // The reversal (score/targets/assassins/isAlive, for every player
        // killPlayer.js's transaction touched) now happens entirely inside
        // the atomic undoKillPlayer Cloud Function — the client only needs
        // to trigger it and log the result
        // (docs/superpowers/specs/2026-08-16-full-kill-undo-design.md).
        await waitFor(() => expect(undoKill).toHaveBeenCalledWith('room-a', 'photo-0'));
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            "Undo: alice's death by bob was reverted",
            'blue.200'
        );
        // updatePhotoStatusForRoom is only for the deny-undo path now —
        // undoKillPlayer's own transaction already resets status to
        // 'pending' for an approval-undo.
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });

    it('does nothing when there is no judged photo to undo', async () => {
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Undo'));

        expect(undoKill).not.toHaveBeenCalled();
        expect(dbCalls.updatePhotoStatusForRoom).not.toHaveBeenCalled();
    });

    it('reverts a denied judgment by resetting status to pending, without calling undoKill', async () => {
        mountWithSnapshot([
            { status: 'denied', target: null, assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        await waitFor(() =>
            expect(dbCalls.updatePhotoStatusForRoom).toHaveBeenCalledWith(
                'room-a',
                'photo-0',
                'pending'
            )
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            "Undo: denial of bob's kill attempt was reverted.",
            'blue.200'
        );
        expect(undoKill).not.toHaveBeenCalled();
    });

    it('posts a chat message when undoing an approved kill', async () => {
        mountWithSnapshot([
            {
                status: 'approved',
                target: 'alice',
                assassin: 'bob',
                originalPlayerData: {
                    alice: { score: 7, targets: ['carol'], assassins: ['dave'], isAlive: true },
                },
            },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'killResult',
                    recipient: null,
                    text: "Undo: alice's death by bob was reverted",
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: 'bob',
                    target: 'alice',
                    outcome: 'undoneApproval',
                },
                'room-a'
            )
        );
    });

    it('posts a chat message when undoing a denial', async () => {
        mountWithSnapshot([
            { status: 'denied', target: null, assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'killResult',
                    recipient: null,
                    text: "Undo: denial of bob's kill attempt was reverted.",
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: 'bob',
                    target: null,
                    outcome: 'undoneDenial',
                },
                'room-a'
            )
        );
    });
});

describe('approving a photo persists the undo snapshot (improvements item 6)', () => {
    it('calls executeKill and persists its preKillSnapshot', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {
                bob: {
                    score: 12,
                    targets: ['x'],
                    assassins: ['y'],
                    isAlive: true,
                    openSeason: false,
                },
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
        expect(dbCalls.approvePhotoForRoom).toHaveBeenCalledWith('room-a', 'photo-0', 'alice', {
            bob: { score: 12, targets: ['x'], assassins: ['y'], isAlive: true, openSeason: false },
        });
    });

    it('passes remapLogs, addedTargets, and addedAssassins through to their handlers', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: { score: 0, targets: [], assassins: [] },
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
    });
});

describe('kill outcomes are announced in the room chat', () => {
    it('posts a killResult chat message when a photo is approved', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'killResult',
                    recipient: null,
                    text: 'alice was killed by bob',
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: 'bob',
                    target: 'alice',
                    outcome: 'approved',
                },
                'room-a'
            )
        );
    });

    it('posts a killResult chat message when a photo is denied', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Deny'));

        await waitFor(() =>
            expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
                {
                    type: 'killResult',
                    recipient: null,
                    text: "bob's photo submission was denied",
                    standings: null,
                    mission: null,
                    sender: null,
                    assassin: 'bob',
                    target: null,
                    outcome: 'denied',
                },
                'room-a'
            )
        );
    });
});

describe('a photo approval executeKill rejects is not applied (improvements item 5)', () => {
    it('leaves the photo pending and shows an alert instead of killing anyway', async () => {
        // The bug this item fixes: photo approval used to kill
        // unconditionally, with no check that the assassin was actually
        // hunting the target.
        executeKill.mockRejectedValue(new Error('alice is not a valid target for bob'));
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        expect(await screen.findByText(/alice is not a valid target for bob/i)).toBeInTheDocument();
        expect(dbCalls.approvePhotoForRoom).not.toHaveBeenCalled();
    });
});

describe('GM pending-photo count in heading', () => {
    it('shows the pending count in the heading when photos are awaiting review', () => {
        mountWithSnapshot([
            { assassin: 'alice', target: 'bob', status: 'pending' },
            { assassin: 'carol', target: 'dave', status: 'pending' },
        ]);

        expect(screen.getByText('Photos (2 pending)')).toBeInTheDocument();
    });

    it('shows a plain heading when no photos are awaiting review', () => {
        mountWithSnapshot([]);

        expect(screen.getByText('Photos')).toBeInTheDocument();
        expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
    });
});

describe('optimistic queue advance while a judgment is in flight (making Approve/Deny feel instant)', () => {
    it('advances to the next pending photo immediately when Approve is clicked, without waiting for executeKill', async () => {
        let resolveKill;
        executeKill.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveKill = resolve;
                })
        );
        mountWithSnapshot([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'pending',
                url: 'https://example.com/1.jpg',
            },
            {
                assassin: 'carol',
                target: 'dave',
                status: 'pending',
                url: 'https://example.com/2.jpg',
            },
        ]);

        await userEvent.click(screen.getByAltText('Approve'));

        expect(screen.getByText('Photos (1 pending)')).toBeInTheDocument();
        expect(screen.getByAltText('Unjudged photo')).toHaveAttribute(
            'src',
            'https://example.com/2.jpg'
        );

        resolveKill({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        await waitFor(() => expect(dbCalls.approvePhotoForRoom).toHaveBeenCalled());
    });

    it('advances to the next pending photo immediately when Deny is clicked, without waiting for the write', async () => {
        let resolveDeny;
        dbCalls.updatePhotoStatusForRoom.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveDeny = resolve;
                })
        );
        mountWithSnapshot([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'pending',
                url: 'https://example.com/1.jpg',
            },
            {
                assassin: 'carol',
                target: 'dave',
                status: 'pending',
                url: 'https://example.com/2.jpg',
            },
        ]);

        await userEvent.click(screen.getByAltText('Deny'));

        expect(screen.getByText('Photos (1 pending)')).toBeInTheDocument();
        expect(screen.getByAltText('Unjudged photo')).toHaveAttribute(
            'src',
            'https://example.com/2.jpg'
        );

        resolveDeny();
        await waitFor(() => expect(executionHandlers.addLog).toHaveBeenCalled());
    });

    it('shows "no photos" immediately when the only pending photo is approved, before executeKill resolves', async () => {
        let resolveKill;
        executeKill.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveKill = resolve;
                })
        );
        mountWithSnapshot([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'pending',
                url: 'https://example.com/1.jpg',
            },
        ]);

        await userEvent.click(screen.getByAltText('Approve'));

        expect(screen.getByText('No photos have been uploaded!')).toBeInTheDocument();
        expect(screen.getByText('Photos')).toBeInTheDocument();
        expect(screen.queryByText(/pending/)).not.toBeInTheDocument();

        resolveKill({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        await waitFor(() => expect(dbCalls.approvePhotoForRoom).toHaveBeenCalled());
    });

    it('puts the photo back in the queue if the approval ultimately fails', async () => {
        executeKill.mockRejectedValue(new Error('alice is not a valid target for bob'));
        mountWithSnapshot([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'pending',
                url: 'https://example.com/1.jpg',
            },
        ]);

        await userEvent.click(screen.getByAltText('Approve'));

        expect(await screen.findByText(/alice is not a valid target for bob/i)).toBeInTheDocument();
        expect(await screen.findByText('Photos (1 pending)')).toBeInTheDocument();
        expect(screen.getByAltText('Unjudged photo')).toHaveAttribute(
            'src',
            'https://example.com/1.jpg'
        );
    });

    it('puts the photo back in the queue if the denial ultimately fails', async () => {
        dbCalls.updatePhotoStatusForRoom.mockRejectedValue(new Error('network error'));
        mountWithSnapshot([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'pending',
                url: 'https://example.com/1.jpg',
            },
        ]);

        await userEvent.click(screen.getByAltText('Deny'));

        expect(await screen.findByText(/network error/i)).toBeInTheDocument();
        expect(await screen.findByText('Photos (1 pending)')).toBeInTheDocument();
    });

    it('drops the optimistic suppression once Firestore confirms the photo is no longer pending', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        const deliverUpdate = mountWithSnapshot([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'pending',
                url: 'https://example.com/1.jpg',
            },
        ]);

        await userEvent.click(screen.getByAltText('Approve'));
        await waitFor(() => expect(dbCalls.approvePhotoForRoom).toHaveBeenCalled());

        // The real update: this photo is no longer pending, and a new one
        // has arrived.
        await deliverUpdate([
            {
                assassin: 'alice',
                target: 'bob',
                status: 'approved',
                url: 'https://example.com/1.jpg',
            },
            {
                assassin: 'eve',
                target: 'frank',
                status: 'pending',
                url: 'https://example.com/3.jpg',
            },
        ]);

        expect(screen.getByText('Photos (1 pending)')).toBeInTheDocument();
        expect(screen.getByAltText('Unjudged photo')).toHaveAttribute(
            'src',
            'https://example.com/3.jpg'
        );
    });
});

describe('the player’s own claim, not a moderator pick', () => {
    it('shows the kill-attempt wording and lets Approve proceed', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', mission: null, assassin: 'bob' }]);

        expect(screen.getByText("bob's kill attempt on alice")).toBeInTheDocument();
        expect(screen.queryByLabelText('Select target or mission')).not.toBeInTheDocument();

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
    });

    it('shows the mission-attempt wording using the claimed mission’s title', async () => {
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            defaultPlayers,
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        expect(screen.getByText("bob's mission attempt: Find the clue")).toBeInTheDocument();
    });

    it('does nothing when Approve is clicked on a photo with no claim at all', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, mission: null, assassin: 'bob' }]);

        expect(screen.getByText('No target selected.')).toBeInTheDocument();

        await userEvent.click(screen.getByAltText('Approve'));

        expect(executeKill).not.toHaveBeenCalled();
        expect(completeMission).not.toHaveBeenCalled();
        expect(dbCalls.approvePhotoForRoom).not.toHaveBeenCalled();
        expect(dbCalls.approvePhotoAsMissionForRoom).not.toHaveBeenCalled();
    });

    it('Deny does not require a claim to be present', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, mission: null, assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Deny'));

        await waitFor(() => expect(dbCalls.updatePhotoStatusForRoom).toHaveBeenCalled());
    });
});

describe("an open-season target is a valid kill even off the assassin's own list", () => {
    it('announces open season ending when the approved kill was on an open-season target', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: true,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot(
            [{ status: 'pending', target: 'carol', mission: null, assassin: 'bob' }],
            [
                { name: 'bob', targets: [] },
                { name: 'carol', targets: [], openSeason: true, isAlive: true },
            ]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.handleOpenSznended).toHaveBeenCalledWith('carol')
        );
    });

    it('does not announce open season ending for an ordinary kill', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            preKillSnapshot: {},
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });
        mountWithSnapshot([{ status: 'pending', target: 'alice', assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(dbCalls.approvePhotoForRoom).toHaveBeenCalled());
        expect(executionHandlers.handleOpenSznended).not.toHaveBeenCalled();
    });
});

describe('approving a photo as a mission completion', () => {
    it('completes a Task mission and marks the photo approved with the resolved mission index and reversal snapshot', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {
                    bob: {
                        score: 10,
                        targets: [],
                        assassins: [],
                        isAlive: true,
                        openSeason: false,
                    },
                },
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: null,
            revivesPlayer: false,
        });
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(completeMission).toHaveBeenCalledWith(1, 'bob', 'room-a'));
        expect(dbCalls.approvePhotoAsMissionForRoom).toHaveBeenCalledWith('room-a', 'photo-0', 1, {
            missionIndex: 1,
            playerName: 'bob',
            wasAutoEnded: false,
            players: {
                bob: { score: 10, targets: [], assassins: [], isAlive: true, openSeason: false },
            },
        });
    });

    it('announces the completion in the GM log and player chat', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: null,
            revivesPlayer: false,
        });
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'bob completed mission: Find the clue',
                'green.400'
            )
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'bob completed mission: Find the clue',
                standings: null,
            },
            'room-a'
        );
    });

    it('additionally announces an auto-end when the completion reaches maxCompletions', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: true,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: 1,
            revivesPlayer: false,
        });
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'Mission "Find the clue" auto-ended — reached its 1-completion cap',
                'purple.400'
            )
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Mission Find the clue has been completed!',
                standings: null,
            },
            'room-a'
        );
    });

    it('calls handlePlayerRevive when the completion revives the player', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 2,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Revival Mission',
            maxCompletions: null,
            revivesPlayer: true,
        });
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 2, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 2, title: 'Revival Mission', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.handlePlayerRevive).toHaveBeenCalledWith('bob')
        );
    });

    it('passes remapLogs, addedTargets, and addedAssassins from a revival mission completion through to their handlers', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
            taskTitle: 'Revival Mission',
            maxCompletions: null,
            revivesPlayer: true,
        });
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 1, title: 'Revival Mission', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
        expect(executionHandlers.handleSetShowMessageToTrue).toHaveBeenCalled();
    });

    it('does not fire any remap handlers for a plain Task completion', async () => {
        completeMission.mockResolvedValue({
            reversalSnapshot: {
                missionIndex: 1,
                playerName: 'bob',
                wasAutoEnded: false,
                players: {},
            },
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
            taskTitle: 'Find the clue',
            maxCompletions: null,
            revivesPlayer: false,
        });
        mountWithSnapshot(
            [{ status: 'pending', target: null, mission: 1, assassin: 'bob' }],
            [{ name: 'bob', targets: [] }],
            [{ taskIndex: 1, title: 'Find the clue', isComplete: false, completedBy: [] }]
        );

        await userEvent.click(screen.getByAltText('Approve'));

        await waitFor(() => expect(completeMission).toHaveBeenCalled());
        expect(executionHandlers.handleAddNewAssassins).not.toHaveBeenCalled();
        expect(executionHandlers.handleAddNewTargets).not.toHaveBeenCalled();
        expect(executionHandlers.handleSetShowMessageToTrue).not.toHaveBeenCalled();
        expect(executionHandlers.handlePlayerRevive).not.toHaveBeenCalled();
    });

    it('denies a photo with generic wording regardless of category', async () => {
        mountWithSnapshot([{ status: 'pending', target: null, assassin: 'bob' }]);

        await userEvent.click(screen.getByAltText('Deny'));

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                "bob's photo submission was denied",
                'gray'
            )
        );
    });

    it('undoes a mission-approved photo for real, instead of showing the placeholder', async () => {
        mountWithSnapshot([
            { status: 'approved', mission: 1, assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        await waitFor(() =>
            expect(undoMissionPhotoApproval).toHaveBeenCalledWith('room-a', 'photo-0')
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Undo: the last mission completion was reverted',
            'blue.200'
        );
        expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
            {
                type: 'broadcast',
                recipient: null,
                text: 'Undo: the last mission completion was reverted',
                standings: null,
            },
            'room-a'
        );
    });

    it('shows an error alert when undoing a mission-approved photo fails', async () => {
        undoMissionPhotoApproval.mockRejectedValueOnce(new Error('nothing to undo'));
        mountWithSnapshot([
            { status: 'approved', mission: 1, assassin: 'bob', originalPlayerData: null },
        ]);

        await userEvent.click(screen.getByAltText('Undo'));

        expect(await screen.findByText(/nothing to undo/i)).toBeInTheDocument();
    });
});
