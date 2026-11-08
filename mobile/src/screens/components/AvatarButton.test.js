/**
 * Component test for AvatarButton — the RN port of
 * src/components/player_game/PlayerGameHeader.js's own-avatar IconButton
 * plus src/pages/PlayerGame.js's handleAvatarChange (Task 15), reworked so
 * tapping the small button opens a preview/edit modal (titled with the
 * player's own in-game name) first, rather than jumping straight into the
 * camera. From there, "Take New Photo" captures, then hands off to
 * AvatarCropModal's own circular pan/zoom crop screen (its own test file
 * covers the crop math directly) before anything is uploaded — hidden
 * once `canEdit` is false (the GM reviews every photo before the game
 * starts, so editing stops once it has).
 *
 * Firebase-touching imports are mocked, same pattern as ChatComposer.test.js:
 * 'firebase/firestore' (updateDoc), '../../firebase/firebaseConfig' (auth,
 * for the uploading uid), '../../firebase/dbCalls' (fetchPlayerReferenceForRoom),
 * and '../../firebase/storageCalls' (uploadPlayerAvatar). 'expo-image-picker'
 * and 'expo-image-manipulator' are also mocked for the same reason
 * ChatComposer.test.js mocks them — jest-expo's automatic mocks don't give
 * per-test control over the captured asset/manipulated result.
 *
 * @testing-library/react-native v14's render/fireEvent are async — every
 * call is awaited.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { updateDoc } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as dbCalls from '../../firebase/dbCalls';
import * as storageCalls from '../../firebase/storageCalls';
import AvatarButton, { getInitial } from './AvatarButton';

jest.mock('firebase/firestore', () => ({
    updateDoc: jest.fn(),
}));
jest.mock('../../firebase/firebaseConfig', () => ({
    auth: { currentUser: { uid: 'uid-alice' } },
}));
jest.mock('../../firebase/dbCalls', () => ({
    fetchPlayerReferenceForRoom: jest.fn(),
}));
jest.mock('../../firebase/storageCalls', () => ({
    uploadPlayerAvatar: jest.fn(),
}));
jest.mock('expo-image-picker', () => ({
    launchCameraAsync: jest.fn(),
    requestCameraPermissionsAsync: jest.fn(),
    CameraType: { front: 'front' },
}));
jest.mock('expo-image-manipulator', () => ({
    manipulateAsync: jest.fn(),
    SaveFormat: { JPEG: 'jpeg' },
}));

const CAPTURED_URI = 'file://selfie-original.jpg';
const MANIPULATED_URI = 'file://selfie-manipulated.jpg';
const PLAYER_REF = { path: 'rooms/room-a/players/alice' };
const fakeBlob = { __fake: 'blob' };
// The crop rect AvatarCropModal's computeCropRect produces for this
// 1200x900 asset at its untouched scale=1/translate={0,0} defaults (no
// gesture simulated here — that math has its own dedicated test file,
// AvatarCropModal.test.js) — the centered 900x900 square (hand-verified:
// coverWidth = 280*(1200/900) = 1120/3, pixelsPerPoint = 45/14, giving
// originX 150, size 900 exactly).
const DEFAULT_CROP_RECT = { originX: 150, originY: 0, width: 900, height: 900 };

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.fetchPlayerReferenceForRoom.mockReturnValue(PLAYER_REF);
    storageCalls.uploadPlayerAvatar.mockResolvedValue('https://example.com/avatar.jpg');
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ status: 'granted' });
    ImagePicker.launchCameraAsync.mockResolvedValue({
        canceled: false,
        assets: [{ uri: CAPTURED_URI, width: 1200, height: 900 }],
    });
    ImageManipulator.manipulateAsync.mockResolvedValue({ uri: MANIPULATED_URI });
    global.fetch = jest.fn(() => Promise.resolve({ blob: () => Promise.resolve(fakeBlob) }));
});

const mountButton = (props = {}) =>
    render(<AvatarButton playerName="Alice" roomID="room-a" {...props} />);

// Opens the preview modal and presses "Take New Photo" — capturing and
// landing on AvatarCropModal's own crop screen, one step short of
// actually uploading anything.
const openModalAndCapture = async (buttonLabel) => {
    await fireEvent.press(screen.getByLabelText(buttonLabel));
    await fireEvent.press(screen.getByLabelText('Take new photo'));
};

// The full three-step path every successful capture goes through:
// preview -> capture -> confirm the (untouched, default) crop.
const openModalCaptureAndUse = async (buttonLabel) => {
    await openModalAndCapture(buttonLabel);
    await fireEvent.press(screen.getByLabelText('Use photo'));
};

describe('getInitial', () => {
    it('returns the uppercased first letter of a name', () => {
        expect(getInitial('alice')).toBe('A');
    });

    it('falls back to a placeholder for an empty/missing name', () => {
        expect(getInitial('')).toBe('?');
        expect(getInitial(undefined)).toBe('?');
    });
});

describe('AvatarButton', () => {
    it('labels the button "Add my photo" when there is no avatar yet', async () => {
        await mountButton({ avatarUrl: undefined });

        expect(screen.getByLabelText('Add my photo')).toBeTruthy();
    });

    it('labels the button "Change my photo" and shows the photo when an avatar exists', async () => {
        await mountButton({ avatarUrl: 'https://example.com/existing.jpg' });

        expect(screen.getByLabelText('Change my photo')).toBeTruthy();
        expect(screen.getByLabelText("Alice's photo").props.source.uri).toBe(
            'https://example.com/existing.jpg'
        );
    });

    it('shows the initial letter in place of a photo when there is no avatar', async () => {
        await mountButton({ avatarUrl: undefined });

        expect(screen.getByText('A')).toBeTruthy();
    });

    it('opens a preview modal showing the current photo instead of launching the camera directly', async () => {
        await mountButton({ avatarUrl: 'https://example.com/existing.jpg' });

        await fireEvent.press(screen.getByLabelText('Change my photo'));

        expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
        expect(screen.getByText('Alice')).toBeTruthy();
        // Both the small header button and the modal's own big preview
        // render "Alice's photo" — this just confirms the modal's copy is
        // one of them, alongside the existing header one.
        expect(screen.getAllByLabelText("Alice's photo").length).toBeGreaterThanOrEqual(2);
        expect(screen.getByLabelText('Take new photo')).toBeTruthy();
    });

    it('shows the initials fallback in the preview modal when there is no avatar yet', async () => {
        await mountButton({ avatarUrl: undefined });

        await fireEvent.press(screen.getByLabelText('Add my photo'));

        expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(2);
    });

    it('closes the preview modal when its close button is pressed', async () => {
        await mountButton({ avatarUrl: undefined });

        await fireEvent.press(screen.getByLabelText('Add my photo'));
        expect(screen.getByText('Alice')).toBeTruthy();

        await fireEvent.press(screen.getByLabelText('Close your photo'));
        expect(screen.queryByText('Alice')).toBeNull();
    });

    it('captures without the native crop step, then opens the custom circular crop screen', async () => {
        await mountButton();

        await openModalAndCapture('Add my photo');

        // No allowsEditing/aspect/shape — AvatarCropModal's own circular
        // guide replaces expo-image-picker's native crop entirely, since
        // that one can only ever show a square on iOS.
        expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({ cameraType: 'front' });
        expect(screen.getByText('Adjust Photo')).toBeTruthy();
        expect(screen.getByTestId('crop-image').props.source.uri).toBe(CAPTURED_URI);
        // The preview modal closes while the crop screen is open — never
        // both at once (the same real-device Modal-stacking bug already
        // fixed once for the Mystery Box reveal).
        expect(screen.queryByText('Take New Photo')).toBeNull();
    });

    it('crops, uploads, and writes avatarUrl onto the player doc once the crop is confirmed', async () => {
        await mountButton();

        await openModalCaptureAndUse('Add my photo');

        expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
            CAPTURED_URI,
            [{ crop: DEFAULT_CROP_RECT }, { resize: { width: 900, height: 900 } }],
            { compress: 0.8, format: 'jpeg' }
        );
        await waitFor(() =>
            expect(storageCalls.uploadPlayerAvatar).toHaveBeenCalledWith(
                'room-a',
                'uid-alice',
                fakeBlob
            )
        );
        expect(global.fetch).toHaveBeenCalledWith(MANIPULATED_URI);
        expect(dbCalls.fetchPlayerReferenceForRoom).toHaveBeenCalledWith('Alice', 'room-a');
        await waitFor(() =>
            expect(updateDoc).toHaveBeenCalledWith(PLAYER_REF, {
                avatarUrl: 'https://example.com/avatar.jpg',
            })
        );
    });

    it('caps the resize at MAX_DIMENSION for a crop larger than that', async () => {
        // A bigger original photo, cropped to a bigger-than-1600 square.
        ImagePicker.launchCameraAsync.mockResolvedValue({
            canceled: false,
            assets: [{ uri: CAPTURED_URI, width: 2400, height: 1800 }],
        });
        await mountButton();

        await openModalCaptureAndUse('Add my photo');

        const [, actions] = ImageManipulator.manipulateAsync.mock.calls[0];
        const [cropAction, resizeAction] = actions;
        expect(cropAction.crop.width).toBe(cropAction.crop.height); // always square
        expect(resizeAction.resize).toEqual({ width: 1600, height: 1600 });
    });

    it('returns to the preview modal, without uploading, when the crop is canceled', async () => {
        await mountButton();

        await openModalAndCapture('Add my photo');
        await fireEvent.press(screen.getByLabelText('Cancel adjusting photo'));

        expect(screen.queryByText('Adjust Photo')).toBeNull();
        expect(screen.getByText('Alice')).toBeTruthy();
        expect(screen.getByLabelText('Take new photo')).toBeTruthy();
        expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
        expect(storageCalls.uploadPlayerAvatar).not.toHaveBeenCalled();
    });

    it('captures again when Retake is pressed from the crop screen', async () => {
        await mountButton();

        await openModalAndCapture('Add my photo');
        await fireEvent.press(screen.getByLabelText('Retake photo'));

        expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(2);
        // Still on (a fresh) crop screen, not bounced back to the preview.
        expect(screen.getByText('Adjust Photo')).toBeTruthy();
    });

    it('closes the preview modal once the new photo has saved successfully', async () => {
        await mountButton();

        await openModalCaptureAndUse('Add my photo');

        await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
    });

    it('requests camera permission before launching the camera', async () => {
        await mountButton();

        await openModalAndCapture('Add my photo');

        expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
        await waitFor(() => expect(ImagePicker.launchCameraAsync).toHaveBeenCalled());
    });

    it('alerts and never launches the camera when permission is denied', async () => {
        ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ status: 'denied' });
        const Alert = require('react-native').Alert;
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        await mountButton();

        await openModalAndCapture('Add my photo');

        expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            'Camera access needed',
            'Camera access is needed to take a photo. Enable it in Settings and try again.'
        );
        expect(storageCalls.uploadPlayerAvatar).not.toHaveBeenCalled();
        expect(updateDoc).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('does nothing when the camera capture is canceled, and leaves the preview modal open', async () => {
        ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
        await mountButton();

        await openModalAndCapture('Add my photo');

        expect(screen.queryByText('Adjust Photo')).toBeNull();
        expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
        expect(storageCalls.uploadPlayerAvatar).not.toHaveBeenCalled();
        expect(updateDoc).not.toHaveBeenCalled();
        expect(screen.getByText('Alice')).toBeTruthy();
    });

    it('alerts, does not write avatarUrl, and leaves the preview modal open when the upload fails', async () => {
        const Alert = require('react-native').Alert;
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        storageCalls.uploadPlayerAvatar.mockRejectedValue(new Error('network error'));
        await mountButton();

        await openModalCaptureAndUse('Add my photo');

        await waitFor(() =>
            expect(alertSpy).toHaveBeenCalledWith('Could not save your photo', 'network error')
        );
        expect(updateDoc).not.toHaveBeenCalled();
        expect(screen.getByText('Alice')).toBeTruthy();
        alertSpy.mockRestore();
    });

    it('disables Close and shows a spinner in the modal while the new photo is uploading', async () => {
        let resolveUpload;
        storageCalls.uploadPlayerAvatar.mockReturnValue(
            new Promise((resolve) => {
                resolveUpload = resolve;
            })
        );
        await mountButton();

        await openModalAndCapture('Add my photo');
        // Not awaited — uploadPlayerAvatar's promise never resolves until
        // resolveUpload() below, so awaiting this press would hang on the
        // same promise this test is trying to observe mid-flight.
        fireEvent.press(screen.getByLabelText('Use photo'));

        await waitFor(() => expect(screen.getByTestId('avatar-busy')).toBeTruthy());
        expect(screen.getByLabelText('Close your photo').props.accessibilityState.disabled).toBe(
            true
        );

        resolveUpload('https://example.com/avatar.jpg');
        await waitFor(() => expect(updateDoc).toHaveBeenCalled());
    });

    it('still opens a read-only preview when canEdit is false, but hides Take New Photo', async () => {
        await mountButton({ avatarUrl: 'https://example.com/existing.jpg', canEdit: false });

        await fireEvent.press(screen.getByLabelText('Change my photo'));

        expect(screen.getByText('Alice')).toBeTruthy();
        expect(screen.queryByLabelText('Take new photo')).toBeNull();
        expect(
            screen.getByText("Your photo can't be changed once the game has started.")
        ).toBeTruthy();
    });

    it('defaults to editable when canEdit is not passed', async () => {
        await mountButton();

        await fireEvent.press(screen.getByLabelText('Add my photo'));

        expect(screen.getByLabelText('Take new photo')).toBeTruthy();
    });
});
