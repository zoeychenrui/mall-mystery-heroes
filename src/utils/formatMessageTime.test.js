import { formatMessageTime } from './formatMessageTime';

describe('formatMessageTime', () => {
    it('formats a Firestore-shaped timestamp as a clock time', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };

        const result = formatMessageTime(timestamp);

        expect(result).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
    });

    it('returns null for a falsy timestamp (pending server ack)', () => {
        expect(formatMessageTime(null)).toBeNull();
        expect(formatMessageTime(undefined)).toBeNull();
    });
});
