const { nextRateLimitWindow } = require('./rateLimit');

describe('nextRateLimitWindow', () => {
    it('starts a fresh window when there is no current window', () => {
        const result = nextRateLimitWindow(null, 1000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 1000, count: 1 });
    });

    it('increments count when still within the window and under the cap', () => {
        const current = { windowStartMs: 1000, count: 3 };
        const result = nextRateLimitWindow(current, 5000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 1000, count: 4 });
    });

    it('rejects (returns null) once the cap is reached within the window', () => {
        const current = { windowStartMs: 1000, count: 10 };
        const result = nextRateLimitWindow(current, 5000, { max: 10, windowMs: 60000 });
        expect(result).toBeNull();
    });

    it('resets to a fresh window once the window has elapsed, even if the cap was reached', () => {
        const current = { windowStartMs: 1000, count: 10 };
        const result = nextRateLimitWindow(current, 61000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 61000, count: 1 });
    });

    it('treats exactly windowMs elapsed as expired, not still-current', () => {
        const current = { windowStartMs: 1000, count: 1 };
        const result = nextRateLimitWindow(current, 61000, { max: 10, windowMs: 60000 });
        expect(result).toEqual({ windowStartMs: 61000, count: 1 });
    });
});
