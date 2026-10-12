const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Imported from the firestore subpath, not admin.firestore.FieldValue — see
// joinRoom.js's identical comment for why (the Functions emulator strips
// static properties off the top-level admin.firestore binding).
const { FieldValue } = require('firebase-admin/firestore');
// Vendored copies, not '../../src/game/...' — Cloud Functions deploy
// uploads only the functions/ directory in isolation. Kept in sync by
// functions/scripts/sync-shared-game-logic.js — src/game/ remains the
// single source of truth.
const { planRemap } = require('../vendor/game/remapPlan');
const { normalizePlayerName } = require('../vendor/game/playerNames');
const { playersNeedingConnections } = require('../vendor/game/targetGraph');
const { planMissionCompletion } = require('../vendor/game/missionCompletion');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The atomic, server-side replacement for the client-side completeMission
 * orchestration this session's mission-completion-via-photo feature
 * originally shipped — records a mission completion (award points, or
 * revive-and-regenerate-targets) and returns a snapshot of everything it
 * touched, mirroring killPlayer.js's own preKillSnapshot pattern, so a
 * caller can persist that snapshot for later undo
 * (docs/superpowers/specs/2026-08-29-mission-undo-design.md).
 *
 * Unlike killPlayer.js (which derives the assassin from context.auth.uid),
 * `playerName` here is caller-supplied for both callers of this function —
 * ChatInput.js's /mission done and PhotosDisplay.js's photo-approval flow —
 * since in both cases it is the GM/host deciding who completed the
 * mission, not the completing player submitting their own claim.
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here.
 */
exports.completeMission = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { missionIndex, playerName, roomId } = data;
    if (missionIndex === undefined || missionIndex === null || !playerName || !roomId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'missionIndex, playerName, and roomId are all required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');
        const tasksRef = roomRef.collection('tasks');

        // --- read phase: every read finishes before any write starts ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can complete a mission.'
            );
        }

        const normalizedPlayerName = normalizePlayerName(playerName);

        const taskSnapshot = await transaction.get(tasksRef.where('taskIndex', '==', missionIndex));
        const taskDoc = taskSnapshot.empty ? null : taskSnapshot.docs[0];
        const task = taskDoc ? taskDoc.data() : null;

        let isPlayerDead = false;
        if (task && task.taskType === 'Revival Mission') {
            const deadSnapshot = await transaction.get(playersRef.where('isAlive', '==', false));
            isPlayerDead = deadSnapshot.docs.some(
                (doc) => doc.data().trimmedNameLowerCase === normalizedPlayerName
            );
        }

        const plan = planMissionCompletion(task, normalizedPlayerName, { isPlayerDead });
        if (plan.error) {
            throw new functions.https.HttpsError('failed-precondition', plan.error);
        }

        const playerSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizedPlayerName)
        );
        if (playerSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${playerName}`);
        }
        const playerDoc = playerSnapshot.docs[0];
        const playerData = playerDoc.data();

        // The alive roster (for target regeneration) is only needed for a
        // revival — reading it unconditionally would be wasted work and an
        // unnecessary transaction dependency for the common Task case.
        let rosterSnapshot = null;
        if (plan.revivesPlayer) {
            rosterSnapshot = await transaction.get(playersRef.where('isAlive', '==', true));
        }

        // --- decide, in memory — no more reads below this point ---

        const preWriteDataByName = new Map();
        const captureSnapshot = (name, snapshotData) => {
            const key = normalizePlayerName(name);
            if (!preWriteDataByName.has(key)) {
                preWriteDataByName.set(key, {
                    score: snapshotData.score ?? 0,
                    targets: snapshotData.targets || [],
                    assassins: snapshotData.assassins || [],
                    isAlive: snapshotData.isAlive,
                    openSeason: snapshotData.openSeason ?? false,
                });
            }
        };
        captureSnapshot(normalizedPlayerName, playerData);

        const pendingUpdates = new Map();
        const queueUpdate = (name, ref, fields) => {
            const key = normalizePlayerName(name);
            const existing = pendingUpdates.get(key);
            if (existing) {
                Object.assign(existing.fields, fields);
            } else {
                pendingUpdates.set(key, { ref, fields: { ...fields } });
            }
        };

        let addedTargets = {};
        let addedAssassins = {};
        let remapLogs = [];

        if (plan.awardsPoints !== null) {
            queueUpdate(normalizedPlayerName, playerDoc.ref, {
                score: (playerData.score || 0) + plan.awardsPoints,
            });
        }

        if (plan.revivesPlayer) {
            queueUpdate(normalizedPlayerName, playerDoc.ref, { isAlive: true });

            const rosterDocsByName = new Map();
            const roster = [];
            for (const doc of rosterSnapshot.docs) {
                const docData = doc.data();
                rosterDocsByName.set(normalizePlayerName(docData.name), doc);
                captureSnapshot(docData.name, docData);
                roster.push({
                    name: docData.name,
                    targets: docData.targets || [],
                    assassins: docData.assassins || [],
                });
            }
            // The revived player isn't in rosterSnapshot yet — their
            // isAlive:true write above hasn't landed within this
            // transaction — so they're added manually, with no
            // targets/assassins yet, matching the state planRemap needs
            // to see to correctly treat them as needing both.
            rosterDocsByName.set(normalizedPlayerName, playerDoc);
            roster.push({ name: playerData.name, targets: [], assassins: [] });

            const { needTargets, needAssassins } = playersNeedingConnections(roster);
            const remapPlanResult = planRemap(roster, { needTargets, needAssassins });

            for (const write of remapPlanResult.writes) {
                const doc = rosterDocsByName.get(normalizePlayerName(write.player));
                if (!doc) continue; // defensive; every write came from `roster`
                queueUpdate(write.player, doc.ref, {
                    targets: write.targets,
                    assassins: write.assassins,
                });
            }
            addedTargets = remapPlanResult.added.targets;
            addedAssassins = remapPlanResult.added.assassins;
            remapLogs = remapPlanResult.logs;
        }

        const reversalSnapshotPlayers = {};
        for (const key of pendingUpdates.keys()) {
            const snapshot = preWriteDataByName.get(key);
            if (snapshot) reversalSnapshotPlayers[key] = snapshot;
        }

        // --- write phase ---

        const taskUpdates = { completedBy: FieldValue.arrayUnion(normalizedPlayerName) };
        if (plan.autoEnds) {
            taskUpdates.isComplete = true;
        }
        transaction.update(taskDoc.ref, taskUpdates);

        for (const { ref, fields } of pendingUpdates.values()) {
            transaction.update(ref, fields);
        }

        return {
            reversalSnapshot: {
                missionIndex,
                playerName: normalizedPlayerName,
                wasAutoEnded: plan.autoEnds,
                players: reversalSnapshotPlayers,
            },
            addedTargets,
            addedAssassins,
            remapLogs,
            taskTitle: task.title,
            maxCompletions: task.maxCompletions,
            revivesPlayer: plan.revivesPlayer,
        };
    });
});
