const {
    shouldSendFix,
    isPollDue,
    MIN_SEND_INTERVAL_MS,
    MAX_FRESH_INTERVAL_MS,
} = require('./locationReportCadence');

describe('shouldSendFix', () => {
    it('is true with no prior send', () => {
        expect(shouldSendFix(null, 1000)).toBe(true);
    });

    it('is false just under the minimum interval', () => {
        expect(shouldSendFix(1000, 1000 + MIN_SEND_INTERVAL_MS - 1)).toBe(false);
    });

    it('is true at exactly the minimum interval', () => {
        expect(shouldSendFix(1000, 1000 + MIN_SEND_INTERVAL_MS)).toBe(true);
    });

    it('is true well past the minimum interval', () => {
        expect(shouldSendFix(1000, 1000 + MIN_SEND_INTERVAL_MS + 5000)).toBe(true);
    });
});

describe('isPollDue', () => {
    it('is true with no prior send', () => {
        expect(isPollDue(null, 1000)).toBe(true);
    });

    it('is false just under the max fresh interval', () => {
        expect(isPollDue(1000, 1000 + MAX_FRESH_INTERVAL_MS - 1)).toBe(false);
    });

    it('is true at exactly the max fresh interval', () => {
        expect(isPollDue(1000, 1000 + MAX_FRESH_INTERVAL_MS)).toBe(true);
    });

    it('the poll interval is never shorter than the send interval, or the backstop would be wasted motion', () => {
        expect(MAX_FRESH_INTERVAL_MS).toBeGreaterThanOrEqual(MIN_SEND_INTERVAL_MS);
    });
});
