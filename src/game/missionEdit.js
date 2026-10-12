/**
 * Decides what player score adjustment, if any, results from editing a
 * mission's pointValue. Performs no I/O — the caller applies the result
 * via dbCalls.updatePointsForPlayer, which is additive (Firestore
 * increment()), so `delta` is added directly, once per name in `players`.
 *
 * Returns null when no adjustment is needed: nobody has completed the
 * mission yet, so there are no scores to adjust — fixing a mistyped
 * point value before anyone has played the mission is the common,
 * consequence-free case and must not prompt the GM to confirm an
 * adjustment affecting zero players — or the mission isn't (or didn't
 * stay) a 'Task' — a Revival Mission's completion revives a player
 * rather than awarding points, so its pointValue is never
 * score-relevant — or the pointValue didn't actually change.
 *
 * pointValue is compared with `-`, which coerces numerically, because
 * the field is stored as a string from the Chakra NumberInput
 * (docs/data-model.md) on both the create and the edit path.
 *
 * CommonJS require/exports, matching src/game/remapPlan.js and
 * targetGraph.js's convention in this directory.
 */
const planScoreAdjustment = (oldTask, newTask) => {
    if (oldTask.completedBy.length === 0) return null;
    if (newTask.taskType !== 'Task') return null;
    const delta = newTask.pointValue - oldTask.pointValue;
    if (delta === 0) return null;
    return { delta, players: oldTask.completedBy };
};

/**
 * The starting state for TaskEditModal's per-attempt write tracking: what
 * has already landed in Firestore for the current save attempt, so a
 * "Confirm" retry after a mid-loop failure can resume instead of
 * re-awarding a player who already succeeded (see TaskEditModal.js's
 * applyUpdate). A fresh object every call — TaskEditModal.js stores the
 * result in a useRef and replaces it wholesale at the start of every new
 * handleSave, so a shared/cached instance here would let one attempt's
 * progress bleed into the next.
 */
const createApplyProgress = () => ({ taskWritten: false, appliedPlayerIndexes: new Set() });

module.exports = { planScoreAdjustment, createApplyProgress };
