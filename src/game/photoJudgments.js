/**
 * Pure logic for splitting a room's photo documents into "still needs a
 * judgment" and "already judged" buckets, and reconstructing what an undo
 * would need from each judged one.
 *
 * Extracted from PhotosDisplay.js's onSnapshot callback (docs/improvements.md
 * item 6): judgedPhotos used to live only in React state, built up as the GM
 * clicked through a session, so reloading the console lost every prior
 * judgment even though Firestore still had it — the undo button looked live
 * but had nothing to act on. Firestore is now the source of truth for both
 * buckets; this is the piece decidable from data alone.
 */

/**
 * @param {Array<{id: string, status: 'pending'|'approved'|'denied', originalPlayerData?: object}>} photos
 * @returns {{
 *   unjudged: typeof photos,
 *   judged: Array<{photo: typeof photos[number], action: 'pass'|'missionPass'|'deny', originalPlayerData: object|undefined}>
 * }}
 */
export const splitPhotosByStatus = (photos) => {
    const unjudged = photos.filter((photo) => photo.status === 'pending');

    const judged = photos
        .filter((photo) => photo.status === 'approved' || photo.status === 'denied')
        .map((photo) => ({
            photo,
            action:
                photo.status === 'denied' ? 'deny' : photo.mission != null ? 'missionPass' : 'pass',
            originalPlayerData: photo.originalPlayerData,
        }));

    return { unjudged, judged };
};
