const functions = require('firebase-functions');
const admin = require('firebase-admin');
// Vendored copies, not '../../src/game/...' — Cloud Functions deploy
// uploads only the functions/ directory in isolation, so a require()
// reaching outside it cannot resolve in the deployed bundle even though it
// works locally and under the emulator. Kept in sync by
// functions/scripts/sync-shared-game-logic.js (predeploy hook + local test
// setup) — src/game/ remains the single source of truth.
const { planRemap } = require('../vendor/game/remapPlan');
const { normalizePlayerName } = require('../vendor/game/playerNames');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * The atomic replacement for the client-side kill flow
 * (docs/improvements.md item 4): score transfer, unmapping the victim from
 * every neighbor, the victim's own reset, and the remap that follows, all
 * inside one Firestore transaction. Previously this was ~9-15 separate,
 * unbatched writes from the browser — a dropped connection partway through
 * could leave the game in a state nothing detected or repaired.
 *
 * Runs under the Admin SDK, which bypasses firestore.rules entirely — the
 * host check below is what enforces authorization here; rules aren't
 * consulted for anything this function does.
 */
exports.killPlayer = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'The function must be called while authenticated.'
        );
    }

    const { target, assassin, roomId } = data;
    if (!target || !assassin || !roomId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'target, assassin, and roomId are all required.'
        );
    }

    return db.runTransaction(async (transaction) => {
        const roomRef = db.collection('rooms').doc(roomId);
        const playersRef = roomRef.collection('players');

        // --- read phase: Firestore transactions require every read to
        // finish before any write starts, so everything the write phase
        // needs is gathered here first. ---

        const roomSnapshot = await transaction.get(roomRef);
        if (!roomSnapshot.exists) {
            throw new functions.https.HttpsError('not-found', `Room not found: ${roomId}`);
        }
        if (roomSnapshot.data().hostId !== context.auth.uid) {
            // Re-implements firestore.rules' isHostOfExistingRoom check —
            // rules don't apply to the Admin SDK, so this is the actual
            // enforcement for this function.
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the room host can kill a player.'
            );
        }

        const assassinSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(assassin))
        );
        if (assassinSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${assassin}`);
        }
        const assassinDoc = assassinSnapshot.docs[0];
        const assassinData = assassinDoc.data();

        const preWriteDataByName = new Map();
        const captureSnapshot = (name, data) => {
            const key = normalizePlayerName(name);
            if (!preWriteDataByName.has(key)) {
                preWriteDataByName.set(key, {
                    score: data.score ?? 0,
                    targets: data.targets || [],
                    assassins: data.assassins || [],
                    isAlive: data.isAlive,
                    openSeason: data.openSeason ?? false,
                });
            }
        };
        captureSnapshot(assassin, assassinData);

        const targetSnapshot = await transaction.get(
            playersRef.where('trimmedNameLowerCase', '==', normalizePlayerName(target))
        );
        if (targetSnapshot.empty) {
            throw new functions.https.HttpsError('not-found', `Player not found: ${target}`);
        }
        const targetDoc = targetSnapshot.docs[0];
        const targetData = targetDoc.data();

        captureSnapshot(target, targetData);

        const targetKey = normalizePlayerName(target);

        // A kill is valid if any of three things is true: the target is on
        // the assassin's own list; the target has open season on
        // themselves (anyone may kill an open-season player, not just
        // their assigned hunter); or the assassin has open season (blanket
        // kill rights on anyone). This is the same three-way rule the
        // now-deleted dbCalls.fetchTargetsForPlayer + checkOpenSzn
        // combination enforced — fetchTargetsForPlayer used to run a
        // separate query merging every open-season player's name into the
        // assassin's own target list before this comparison; that's no
        // longer needed here since targetData was already read above.
        const assassinTargets = (assassinData.targets || []).map((name) =>
            normalizePlayerName(name)
        );
        const isValidTarget =
            assassinTargets.includes(targetKey) || targetData.openSeason || assassinData.openSeason;
        if (!isValidTarget) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${target} is not a valid target for ${assassin}`
            );
        }

        // The target's former hunters and prey — these need unmapping.
        // Deduped by normalized name: a player could in principle appear in
        // both arrays. A name that doesn't resolve to a document is a
        // stale reference (shouldn't happen — item 36's pre-fix bug caused
        // exactly this for months — but an unrelated data anomaly
        // shouldn't block a kill, so it's skipped, not thrown).
        const neighborNames = [...(targetData.assassins || []), ...(targetData.targets || [])];
        const neighborDocsByName = new Map();
        for (const name of neighborNames) {
            const key = normalizePlayerName(name);
            if (neighborDocsByName.has(key)) continue;
            const neighborSnapshot = await transaction.get(
                playersRef.where('trimmedNameLowerCase', '==', key)
            );
            if (neighborSnapshot.empty) {
                console.warn(`killPlayer: neighbor not found, skipping unmap: ${name}`);
                continue;
            }
            neighborDocsByName.set(key, neighborSnapshot.docs[0]);
            captureSnapshot(name, neighborSnapshot.docs[0].data());
        }

        // The alive roster for the remap step, as planRemap expects it:
        // the target excluded (their isAlive:false write hasn't landed
        // yet within this transaction, so the query would otherwise still
        // include them) and the target's name scrubbed from every
        // neighbor's own targets/assassins arrays (their unmap write
        // hasn't landed yet either — planRemap needs to reason about the
        // post-unmap state, the same state it would see if this were the
        // separate, later read the client's old sequential version used).
        const rosterSnapshot = await transaction.get(playersRef.where('isAlive', '==', true));
        const rosterDocsByName = new Map();
        const roster = [];
        for (const doc of rosterSnapshot.docs) {
            const docData = doc.data();
            if (docData.trimmedNameLowerCase === targetKey) continue;
            rosterDocsByName.set(normalizePlayerName(docData.name), doc);
            captureSnapshot(docData.name, docData);
            roster.push({
                name: docData.name,
                targets: (docData.targets || []).filter(
                    (name) => normalizePlayerName(name) !== targetKey
                ),
                assassins: (docData.assassins || []).filter(
                    (name) => normalizePlayerName(name) !== targetKey
                ),
            });
        }

        const plan = planRemap(roster, {
            needTargets: targetData.assassins || [],
            needAssassins: targetData.targets || [],
        });

        // --- write phase ---

        // Firestore rejects more than one write to the same document
        // within a transaction, and it's normal for one to be needed here:
        // the assassin, for instance, gets both a score update and (very
        // likely) a new-target assignment from the remap, since their old
        // target is the player who's dying. Every field update for a given
        // player is accumulated here and applied as a single
        // transaction.update() per document. Unmap writes are queued
        // before remap writes on purpose: a remap write's targets/assassins
        // values are always the complete post-remap state (computed from
        // the already-scrubbed roster above), so where both touch the same
        // field, the remap value is the correct one to keep — later queued
        // values win.
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

        const currTargetPoints = targetData.score >= 0 ? targetData.score : 0;
        queueUpdate(assassin, assassinDoc.ref, {
            score: (assassinData.score || 0) + currTargetPoints,
        });

        queueUpdate(target, targetDoc.ref, {
            score: 0,
            isAlive: false,
            openSeason: false,
            targets: [],
            assassins: [],
        });

        for (const name of targetData.assassins || []) {
            const neighborDoc = neighborDocsByName.get(normalizePlayerName(name));
            if (!neighborDoc) continue;
            const newTargets = (neighborDoc.data().targets || []).filter(
                (n) => normalizePlayerName(n) !== targetKey
            );
            queueUpdate(name, neighborDoc.ref, { targets: newTargets });
        }
        for (const name of targetData.targets || []) {
            const neighborDoc = neighborDocsByName.get(normalizePlayerName(name));
            if (!neighborDoc) continue;
            const newAssassins = (neighborDoc.data().assassins || []).filter(
                (n) => normalizePlayerName(n) !== targetKey
            );
            queueUpdate(name, neighborDoc.ref, { assassins: newAssassins });
        }

        for (const write of plan.writes) {
            const doc = rosterDocsByName.get(normalizePlayerName(write.player));
            if (!doc) continue; // defensive; every plan.writes entry came from `roster`
            queueUpdate(write.player, doc.ref, {
                targets: write.targets,
                assassins: write.assassins,
            });
        }

        const preKillSnapshot = {};
        for (const key of pendingUpdates.keys()) {
            const snapshot = preWriteDataByName.get(key);
            if (snapshot) preKillSnapshot[key] = snapshot;
        }

        for (const { ref, fields } of pendingUpdates.values()) {
            transaction.update(ref, fields);
        }

        return {
            targetWasOpenSzn: targetData.openSeason,
            preKillSnapshot,
            addedTargets: plan.added.targets,
            addedAssassins: plan.added.assassins,
            remapLogs: plan.logs,
        };
    });
});
