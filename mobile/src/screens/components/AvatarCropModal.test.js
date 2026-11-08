/**
 * Component + pure-function test for AvatarCropModal — the custom
 * pan/zoom circular crop screen that stands in for expo-image-picker's
 * own native crop step (which can only ever show a square on iOS).
 *
 * clampScale/clampTranslate/computeCropRect are tested directly as pure
 * functions with hand-verified numbers (worked out on paper against
 * CONTAINER_SIZE = 280, kept in sync with the real constant via the
 * computeCropRect(scale=1, translate=0) identity case below) — simulating
 * real two-finger pinch gestures through PanResponder in a rendered
 * component is far more fragile than testing the math it feeds on its
 * own. The component tests below only cover wiring: the buttons call the
 * right callback with the right computed rect, given whatever scale/
 * translate state the component is holding (always the untouched
 * scale=1/translate=0 defaults here, since no gesture is simulated).
 *
 * @testing-library/react-native v14's render/fireEvent are async.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import AvatarCropModal, { clampScale, clampTranslate, computeCropRect } from './AvatarCropModal';

const SQUARE_ASSET = { uri: 'file://square.jpg', width: 1000, height: 1000 };
const WIDE_ASSET = { uri: 'file://wide.jpg', width: 2000, height: 1000 };

describe('clampScale', () => {
    it('clamps below the minimum up to 1', () => {
        expect(clampScale(0.5)).toBe(1);
    });

    it('clamps above the maximum down to 3', () => {
        expect(clampScale(5)).toBe(3);
    });

    it('leaves an in-range value untouched', () => {
        expect(clampScale(2)).toBe(2);
    });
});

describe('clampTranslate', () => {
    it('allows no pan at all at scale 1 for a square image (cover already fills the container exactly)', () => {
        expect(
            clampTranslate({
                assetWidth: 1000,
                assetHeight: 1000,
                scale: 1,
                translateX: 50,
                translateY: -30,
            })
        ).toEqual({ x: 0, y: 0 });
    });

    it('allows panning up to half the extra size once zoomed in', () => {
        // cover size 280x280 at scale 2 -> 560x560, 280 of slack split
        // evenly either side -> max offset 140.
        expect(
            clampTranslate({
                assetWidth: 1000,
                assetHeight: 1000,
                scale: 2,
                translateX: 50,
                translateY: -50,
            })
        ).toEqual({ x: 50, y: -50 });

        expect(
            clampTranslate({
                assetWidth: 1000,
                assetHeight: 1000,
                scale: 2,
                translateX: 200,
                translateY: -200,
            })
        ).toEqual({ x: 140, y: -140 });
    });

    it('only allows horizontal pan at scale 1 for a wide image, never vertical', () => {
        // cover size for a 2:1 image is 560x280 — 280 of horizontal
        // slack (max offset 140), zero vertical slack.
        expect(
            clampTranslate({
                assetWidth: 2000,
                assetHeight: 1000,
                scale: 1,
                translateX: 200,
                translateY: 50,
            })
        ).toEqual({ x: 140, y: 0 });
    });
});

describe('computeCropRect', () => {
    it('crops the whole square image at scale 1 with no pan', () => {
        expect(
            computeCropRect({
                assetWidth: 1000,
                assetHeight: 1000,
                scale: 1,
                translateX: 0,
                translateY: 0,
            })
        ).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
    });

    it('crops the centered half of the square image at 2x zoom with no pan', () => {
        expect(
            computeCropRect({
                assetWidth: 1000,
                assetHeight: 1000,
                scale: 2,
                translateX: 0,
                translateY: 0,
            })
        ).toEqual({ originX: 250, originY: 250, width: 500, height: 500 });
    });

    it('crops the centered square (using the limiting height) from a wide image at scale 1', () => {
        expect(
            computeCropRect({
                assetWidth: 2000,
                assetHeight: 1000,
                scale: 1,
                translateX: 0,
                translateY: 0,
            })
        ).toEqual({ originX: 500, originY: 0, width: 1000, height: 1000 });
    });

    it('crops the left edge of a wide image when panned fully to the max offset', () => {
        expect(
            computeCropRect({
                assetWidth: 2000,
                assetHeight: 1000,
                scale: 1,
                translateX: 140,
                translateY: 0,
            })
        ).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
    });

    it('crops the right edge of a wide image when panned fully the other way', () => {
        expect(
            computeCropRect({
                assetWidth: 2000,
                assetHeight: 1000,
                scale: 1,
                translateX: -140,
                translateY: 0,
            })
        ).toEqual({ originX: 1000, originY: 0, width: 1000, height: 1000 });
    });
});

describe('AvatarCropModal', () => {
    it('renders nothing when there is no pending asset', async () => {
        const { toJSON } = await render(
            <AvatarCropModal asset={null} onUsePhoto={jest.fn()} onRetake={jest.fn()} onCancel={jest.fn()} />
        );
        expect(toJSON()).toBeNull();
    });

    it('shows the captured photo and the Retake/Use Photo/Cancel controls', async () => {
        await render(
            <AvatarCropModal
                asset={SQUARE_ASSET}
                onUsePhoto={jest.fn()}
                onRetake={jest.fn()}
                onCancel={jest.fn()}
            />
        );

        expect(screen.getByTestId('crop-image').props.source.uri).toBe(SQUARE_ASSET.uri);
        expect(screen.getByLabelText('Retake photo')).toBeTruthy();
        expect(screen.getByLabelText('Use photo')).toBeTruthy();
        expect(screen.getByLabelText('Cancel adjusting photo')).toBeTruthy();
    });

    it('calls onUsePhoto with the full-image crop rect when nothing has been panned or zoomed', async () => {
        const onUsePhoto = jest.fn();
        await render(
            <AvatarCropModal
                asset={WIDE_ASSET}
                onUsePhoto={onUsePhoto}
                onRetake={jest.fn()}
                onCancel={jest.fn()}
            />
        );

        await fireEvent.press(screen.getByLabelText('Use photo'));

        expect(onUsePhoto).toHaveBeenCalledWith({
            originX: 500,
            originY: 0,
            width: 1000,
            height: 1000,
        });
    });

    it('calls onRetake when Retake is pressed', async () => {
        const onRetake = jest.fn();
        await render(
            <AvatarCropModal
                asset={SQUARE_ASSET}
                onUsePhoto={jest.fn()}
                onRetake={onRetake}
                onCancel={jest.fn()}
            />
        );

        await fireEvent.press(screen.getByLabelText('Retake photo'));

        expect(onRetake).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when Cancel is pressed', async () => {
        const onCancel = jest.fn();
        await render(
            <AvatarCropModal
                asset={SQUARE_ASSET}
                onUsePhoto={jest.fn()}
                onRetake={jest.fn()}
                onCancel={onCancel}
            />
        );

        await fireEvent.press(screen.getByLabelText('Cancel adjusting photo'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
