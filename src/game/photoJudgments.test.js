import { splitPhotosByStatus } from './photoJudgments';

describe('splitPhotosByStatus', () => {
    it('puts pending photos in unjudged and nowhere else', () => {
        const photos = [{ id: '1', status: 'pending' }];

        const { unjudged, judged } = splitPhotosByStatus(photos);

        expect(unjudged).toEqual(photos);
        expect(judged).toEqual([]);
    });

    it('maps an approved photo to action "pass"', () => {
        const photo = { id: '1', status: 'approved', originalPlayerData: { score: 10 } };

        const { judged } = splitPhotosByStatus([photo]);

        expect(judged).toEqual([{ photo, action: 'pass', originalPlayerData: { score: 10 } }]);
    });

    it('maps an approved photo with a resolved mission to action "missionPass"', () => {
        const photo = { id: '1', status: 'approved', mission: 2, originalPlayerData: null };

        const { judged } = splitPhotosByStatus([photo]);

        expect(judged).toEqual([{ photo, action: 'missionPass', originalPlayerData: null }]);
    });

    it('maps a denied photo to action "deny"', () => {
        const photo = { id: '1', status: 'denied' };

        const { judged } = splitPhotosByStatus([photo]);

        expect(judged).toEqual([{ photo, action: 'deny', originalPlayerData: undefined }]);
    });

    it('splits a mixed list correctly and preserves order within each bucket', () => {
        const pending1 = { id: '1', status: 'pending' };
        const approved = { id: '2', status: 'approved' };
        const pending2 = { id: '3', status: 'pending' };
        const denied = { id: '4', status: 'denied' };

        const { unjudged, judged } = splitPhotosByStatus([pending1, approved, pending2, denied]);

        expect(unjudged).toEqual([pending1, pending2]);
        expect(judged.map((j) => j.photo.id)).toEqual(['2', '4']);
    });

    it('returns empty buckets for an empty list', () => {
        expect(splitPhotosByStatus([])).toEqual({ unjudged: [], judged: [] });
    });
});
