/**
 * Component test for LocationStatusPanel — the RN port of the web's
 * src/components/player_game/PlayerBoundaryPanel.js status block, plus the
 * display derivation (UNAVAILABLE_REASON_TEXT and friends) that the web
 * keeps in src/pages/PlayerGame.js and this port keeps beside the panel as
 * `deriveBoundaryDisplay`. Each case renders the panel with the derived
 * props spread in, exactly the way GameScreen wires it.
 *
 * No Firebase in this import graph — the panel and its derivation are pure.
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import LocationStatusPanel, { deriveBoundaryDisplay } from './LocationStatusPanel';

const NOW_MS = 1_000_000;

// A Firestore-Timestamp-shaped stub: the derivation only calls toMillis()
// and (via formatMessageTime) toDate().
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

const renderPanel = async ({
    liveBoundaryStatus,
    boundaryStatusDoc = null,
    permissionState = 'granted',
    requestPermission = jest.fn(),
    enabled = true,
    isAlive = true,
    nowMs = NOW_MS,
} = {}) => {
    const display = deriveBoundaryDisplay({ liveBoundaryStatus, boundaryStatusDoc, nowMs });
    const utils = await render(
        <LocationStatusPanel
            enabled={enabled}
            isAlive={isAlive}
            permissionState={permissionState}
            requestPermission={requestPermission}
            liveBoundaryStatus={liveBoundaryStatus}
            {...display}
        />
    );
    return { ...utils, display, requestPermission };
};

const backgroundOf = (element) => {
    // Walk up from the Text to the nearest ancestor that sets a background.
    let node = element;
    while (node) {
        const style = StyleSheet.flatten(node.props?.style);
        if (style?.backgroundColor) return style.backgroundColor;
        node = node.parent;
    }
    return undefined;
};

describe('LocationStatusPanel', () => {
    it('renders nothing when the boundary is disabled', async () => {
        await renderPanel({
            enabled: false,
            liveBoundaryStatus: { status: 'inside', reason: null },
        });
        expect(screen.queryByText('In game area.')).toBeNull();
        expect(screen.toJSON()).toBeNull();
    });

    it('renders nothing for an eliminated player', async () => {
        await renderPanel({
            isAlive: false,
            liveBoundaryStatus: { status: 'inside', reason: null },
        });
        expect(screen.toJSON()).toBeNull();
    });

    it('prompts to enable location while permission is unknown, and the button requests it', async () => {
        const { requestPermission } = await renderPanel({
            permissionState: 'unknown',
            liveBoundaryStatus: { status: 'unavailable', reason: 'no_fix' },
        });
        const prompt = screen.getByText(
            'Turn on location so we can check that you are inside the game area. The moderator sees your boundary status. Other players cannot see your location unless you leave the game area. Keep the game open for location updates.'
        );
        expect(backgroundOf(prompt)).toBe('#1A365D'); // blue.900
        // The unavailable box is suppressed while permission is still unknown.
        expect(screen.queryByText(/Location unavailable:/)).toBeNull();

        await fireEvent.press(screen.getByRole('button', { name: 'Enable Location' }));
        expect(requestPermission).toHaveBeenCalledTimes(1);
    });

    it('shows the denied box with a Retry that requests permission again', async () => {
        const { requestPermission } = await renderPanel({
            permissionState: 'denied',
            liveBoundaryStatus: { status: 'unavailable', reason: 'stale' },
            boundaryStatusDoc: { reason: 'permission_denied' },
        });
        const denied = screen.getByText(
            'Location permission was denied. Enable it in your browser or device settings, then retry.'
        );
        expect(backgroundOf(denied)).toBe('#7B341E'); // orange.800
        // permission_denied is not a retry reason — only the denied box's
        // own Retry shows, never a second one in the unavailable box.
        expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
        await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
        expect(requestPermission).toHaveBeenCalledTimes(1);
    });

    it('shows the unavailable-device box when location services are missing', async () => {
        await renderPanel({
            permissionState: 'unavailable',
            liveBoundaryStatus: { status: 'unavailable', reason: 'no_fix' },
        });
        const box = screen.getByText('Location services are unavailable on this device.');
        expect(backgroundOf(box)).toBe('#7B341E'); // orange.800
    });

    describe('inside', () => {
        it('shows a dismissible green banner', async () => {
            await renderPanel({ liveBoundaryStatus: { status: 'inside', reason: null } });
            const banner = screen.getByText('In game area.');
            expect(backgroundOf(banner)).toBe('#22543D'); // green.800

            await fireEvent.press(screen.getByRole('button', { name: 'Dismiss location status' }));
            expect(screen.queryByText('In game area.')).toBeNull();
        });

        it('stays dismissed while still inside, and comes back after leaving inside and returning', async () => {
            const inside = { status: 'inside', reason: null };
            const near = { status: 'near', reason: null };
            const { rerender } = await renderPanel({ liveBoundaryStatus: inside });
            await fireEvent.press(screen.getByRole('button', { name: 'Dismiss location status' }));

            const props = (liveBoundaryStatus) => ({
                enabled: true,
                isAlive: true,
                permissionState: 'granted',
                requestPermission: jest.fn(),
                liveBoundaryStatus,
                ...deriveBoundaryDisplay({
                    liveBoundaryStatus,
                    boundaryStatusDoc: null,
                    nowMs: NOW_MS,
                }),
            });

            // A fresh snapshot that is still `inside` must not bring it back.
            await rerender(<LocationStatusPanel {...props({ status: 'inside', reason: null })} />);
            expect(screen.queryByText('In game area.')).toBeNull();

            await rerender(<LocationStatusPanel {...props(near)} />);
            await rerender(<LocationStatusPanel {...props(inside)} />);
            expect(screen.getByText('In game area.')).toBeTruthy();
        });
    });

    it('shows the near-edge text (not dismissible) when near with no outside run yet', async () => {
        await renderPanel({ liveBoundaryStatus: { status: 'near', reason: null } });
        const text = screen.getByText('You are near the edge of the game area; check the map.');
        expect(backgroundOf(text)).toBe('#22543D'); // green.800
        expect(screen.queryByRole('button', { name: 'Dismiss location status' })).toBeNull();
    });

    it('shows the exposure countdown instead of the near text once an outside run has started', async () => {
        // confirmMinSpanMs is 20 s; outside since 7.5 s ago -> 13 s left (ceil).
        await renderPanel({
            liveBoundaryStatus: { status: 'near', reason: null },
            boundaryStatusDoc: { outsideSince: ts(NOW_MS - 7500) },
        });
        const countdown = screen.getByText(
            'Return to the game area — your location will be revealed to everyone in 13s.'
        );
        expect(backgroundOf(countdown)).toBe('#9C4221'); // orange.700
        expect(
            screen.queryByText('You are near the edge of the game area; check the map.')
        ).toBeNull();
    });

    it('never counts the exposure countdown below zero', async () => {
        const display = deriveBoundaryDisplay({
            liveBoundaryStatus: { status: 'near', reason: null },
            boundaryStatusDoc: { outsideSince: ts(NOW_MS - 60000) },
            nowMs: NOW_MS,
        });
        expect(display.secondsUntilExposed).toBe(0);
    });

    it('shows the exposed notice when outside', async () => {
        await renderPanel({ liveBoundaryStatus: { status: 'outside', reason: null } });
        const notice = screen.getByText(
            'You are outside the game area — your location is visible to everyone until you return.'
        );
        expect(backgroundOf(notice)).toBe('#63171B'); // red.900
    });

    describe('unavailable', () => {
        const REASON_TEXT = [
            ['stale', 'No recent location reading.'],
            ['no_fix', 'No location reading yet.'],
            ['wrong_revision', 'Still checking against the updated game area.'],
            ['wrong_uid', 'Still checking against the updated game area.'],
            ['permission_denied', 'Location permission was denied.'],
            ['timeout', 'Could not get a location fix in time.'],
            ['unavailable', 'Location services are unavailable on this device.'],
            ['invalid_fix', 'Location services are unavailable on this device.'],
            ['poor_accuracy', 'Location accuracy is too low right now.'],
            ['clock_skew', "This device's clock looks out of sync — check it and retry."],
            ['something_new', 'Checking your location status.'],
        ];

        it.each(REASON_TEXT)('reason %s reads "%s"', async (reason, text) => {
            await renderPanel({ liveBoundaryStatus: { status: 'unavailable', reason } });
            const box = screen.getByText(`Location unavailable: ${text}`);
            expect(backgroundOf(box)).toBe('#7B341E'); // orange.800
        });

        it('defaults a missing reason to no_fix', async () => {
            await renderPanel({ liveBoundaryStatus: { status: 'unavailable', reason: null } });
            screen.getByText('Location unavailable: No location reading yet.');
        });

        it("prefers the stored doc's specific reason over a generic staleness", async () => {
            await renderPanel({
                liveBoundaryStatus: { status: 'unavailable', reason: 'stale' },
                boundaryStatusDoc: { reason: 'timeout' },
            });
            screen.getByText('Location unavailable: Could not get a location fix in time.');
        });

        it.each([['timeout'], ['unavailable']])(
            'offers Retry for the retryable reason %s, which requests permission',
            async (reason) => {
                const { requestPermission } = await renderPanel({
                    liveBoundaryStatus: { status: 'unavailable', reason },
                });
                await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
                expect(requestPermission).toHaveBeenCalledTimes(1);
            }
        );

        it('offers no Retry for a non-retryable reason', async () => {
            await renderPanel({ liveBoundaryStatus: { status: 'unavailable', reason: 'stale' } });
            expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
        });

        it('appends the last confirmed time when there has been one', async () => {
            const lastMs = NOW_MS - 45000;
            const { display } = await renderPanel({
                liveBoundaryStatus: { status: 'unavailable', reason: 'stale' },
                boundaryStatusDoc: { lastUsableReceivedAt: ts(lastMs) },
            });
            expect(display.lastCheckTime).toBeTruthy();
            screen.getByText(
                `Location unavailable: No recent location reading. Last confirmed at ${display.lastCheckTime}.`
            );
        });
    });

    describe('mapStatusText', () => {
        it('is the plain status text for a non-unavailable status', () => {
            expect(
                deriveBoundaryDisplay({
                    liveBoundaryStatus: { status: 'inside', reason: null },
                    boundaryStatusDoc: null,
                    nowMs: NOW_MS,
                }).mapStatusText
            ).toBe('In game area.');
        });

        it('carries the unavailable explanation, independent of permission state', () => {
            expect(
                deriveBoundaryDisplay({
                    liveBoundaryStatus: { status: 'unavailable', reason: 'poor_accuracy' },
                    boundaryStatusDoc: null,
                    nowMs: NOW_MS,
                }).mapStatusText
            ).toBe('Location unavailable: Location accuracy is too low right now.');
        });
    });
});
