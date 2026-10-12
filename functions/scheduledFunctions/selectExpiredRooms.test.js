const { selectExpiredRooms } = require('./selectExpiredRooms');

describe('selectExpiredRooms', () => {
    const now = new Date('2026-08-10T00:00:00Z');

    it('selects a room ended more than retentionDays ago', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2026-08-05T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual(['room-a']);
    });

    it('does not select a room ended less than retentionDays ago', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2026-08-09T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual([]);
    });

    it('selects a room ended exactly retentionDays ago (boundary)', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2026-08-07T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual(['room-a']);
    });

    it('does not select a room that never ended (endedAt: null)', () => {
        const rooms = [{ id: 'room-a', endedAt: null }];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual([]);
    });

    it('selects nothing when retentionDays is null (feature off)', () => {
        const rooms = [{ id: 'room-a', endedAt: new Date('2020-01-01T00:00:00Z') }];
        expect(selectExpiredRooms(rooms, now, null)).toEqual([]);
    });

    it('handles a mix of qualifying and non-qualifying rooms', () => {
        const rooms = [
            { id: 'old-room', endedAt: new Date('2026-08-01T00:00:00Z') },
            { id: 'recent-room', endedAt: new Date('2026-08-09T12:00:00Z') },
            { id: 'never-ended-room', endedAt: null },
        ];
        expect(selectExpiredRooms(rooms, now, 3)).toEqual(['old-room']);
    });
});
