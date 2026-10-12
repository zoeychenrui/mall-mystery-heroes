/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Presentational, but now owns the player's claim picker
 * (docs/superpowers/specs/2026-09-02-player-selects-target-mission-design.md)
 * — computed from players/missions/playerName props via
 * buildPhotoClaimOptions, mirroring PhotosDisplay.js's old moderator
 * dropdown exactly, just relocated to the submitting player's own screen.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KillPhotoModal from './KillPhotoModal';

const onClose = jest.fn();
const onSubmit = jest.fn();

const mountModal = (props = {}) =>
    render(
        <ChakraProvider>
            <KillPhotoModal
                isOpen={true}
                onClose={onClose}
                previewUrl="blob:preview"
                error={null}
                onSubmit={onSubmit}
                players={[{ name: 'alice', targets: ['bob'], isAlive: true, openSeason: false }]}
                missions={[]}
                playerName="alice"
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('KillPhotoModal', () => {
    it('auto-resolves and shows plain text when there is exactly one option', () => {
        mountModal();

        expect(screen.queryByLabelText('Select target or mission')).not.toBeInTheDocument();
        expect(screen.getByText('Target: bob')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();
    });

    it('shows a dropdown grouped by Kill Target/Mission when there is more than one option', async () => {
        mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
            missions: [
                {
                    taskIndex: 1,
                    title: 'Find the clue',
                    taskType: 'Task',
                    isComplete: false,
                    completedBy: [],
                },
            ],
        });

        expect(screen.getByLabelText('Select target or mission')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'bob' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'carol' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Find the clue' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('enables Submit once a pick is made from the dropdown, and calls onSubmit with the resolved claim', async () => {
        mountModal({
            players: [
                { name: 'alice', targets: ['bob', 'carol'], isAlive: true, openSeason: false },
            ],
        });

        await userEvent.selectOptions(screen.getByLabelText('Select target or mission'), 'carol');
        expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith('target:carol');
    });

    it('calls onSubmit with the auto-resolved claim when there is only one option', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith('target:bob');
    });

    it('shows a message and disables Submit when there are no options at all', () => {
        mountModal({ players: [{ name: 'alice', targets: [], isAlive: true, openSeason: false }] });

        expect(
            screen.getByText('No open targets or missions for this player.')
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('is still disabled while previewUrl has not arrived yet, even with a resolved option', () => {
        mountModal({ previewUrl: null });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('shows the error banner and no preview image when error is set', () => {
        mountModal({ previewUrl: null, error: 'Could not read that photo. Try taking it again.' });

        expect(
            screen.getByText('Could not read that photo. Try taking it again.')
        ).toBeInTheDocument();
        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });
});
