/**
 * Component test for AvatarButton — the RN port of
 * src/components/player_game/PlayerGameHeader.js's own-avatar IconButton
 * plus src/pages/PlayerGame.js's handleAvatarChange (Task 15), reworked so
 * tapping the small button opens a preview/edit modal (titled with the
 * player's own in-game name) first, rather than jumping straight into the
 * camera. The modal's own "Take New Photo" button is what actually drives
 * the capture flow now — hidden once `canEdit` is false (the GM reviews
 * every photo before the game starts, so editing stops once it has).
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

// Opens the preview modal and presses its own "Take New Photo" button —
// the two-step path every capture now goes through.
const openModalAndTakePhoto = async (buttonLabel) => {
    await fireEvent.press(screen.getByLabelText(buttonLabel));
    await fireEvent.press(screen.getByLabelText('Take new photo'));
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

    it('uploads a captured selfie and writes avatarUrl onto the player doc', async () => {
        await mountButton();

        await openModalAndTakePhoto('Add my photo');

        expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({
            cameraType: 'front',
            allowsEditing: true,
            aspect: [1, 1],
            shape: 'oval',
        });
        expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
            CAPTURED_URI,
            [{ resize: { width: 1200, height: 900 } }],
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

    it('closes the preview modal once the new photo has saved successfully', async () => {
        await mountButton();

        await openModalAndTakePhoto('Add my photo');

        await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
    });

    it('requests camera permission before launching the camera', async () => {
        await mountButton();

        await openModalAndTakePhoto('Add my photo');

        expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
        await waitFor(() => expect(ImagePicker.launchCameraAsync).toHaveBeenCalled());
    });

    it('alerts and never launches the camera when permission is denied', async () => {
        ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ status: 'denied' });
        const Alert = require('react-native').Alert;
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        await mountButton();

        await openModalAndTakePhoto('Add my photo');

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

        await openModalAndTakePhoto('Add my photo');

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

        await openModalAndTakePhoto('Add my photo');

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

        await fireEvent.press(screen.getByLabelText('Add my photo'));
        // Not awaited — uploadPlayerAvatar's promise never resolves until
        // resolveUpload() below, so awaiting this press would hang on the
        // same promise this test is trying to observe mid-flight.
        fireEvent.press(screen.getByLabelText('Take new photo'));

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
