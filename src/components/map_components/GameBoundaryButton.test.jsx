/**
 * Layer 2 — React Testing Library. BoundaryEditorModal is stubbed (it
 * has its own thorough tests) so this stays focused on the button's own
 * job: opening/closing the modal and picking its own label.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import GameBoundaryButton from './GameBoundaryButton';

jest.mock(
    './BoundaryEditorModal',
    () =>
        ({ isOpen, onClose }) =>
            isOpen ? (
                <div data-testid="mock-boundary-editor">
                    <button onClick={onClose}>mock-close</button>
                </div>
            ) : null
);

const renderButton = (props = {}) =>
    render(
        <ChakraProvider>
            <GameBoundaryButton roomID="room-a" gameBoundary={undefined} {...props} />
        </ChakraProvider>
    );

describe('GameBoundaryButton', () => {
    it('shows "Set Game Area" when no boundary has been published', () => {
        renderButton({ gameBoundary: undefined });
        expect(screen.getByRole('button', { name: 'Set Game Area' })).toBeInTheDocument();
    });

    it('shows "Edit Game Area" once a boundary exists, even if disabled', () => {
        renderButton({ gameBoundary: { enabled: false, revision: 2 } });
        expect(screen.getByRole('button', { name: 'Edit Game Area' })).toBeInTheDocument();
    });

    it('opens the editor on click and closes it when the editor closes', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Set Game Area' }));
        expect(screen.getByTestId('mock-boundary-editor')).toBeInTheDocument();

        fireEvent.click(screen.getByText('mock-close'));
        expect(screen.queryByTestId('mock-boundary-editor')).not.toBeInTheDocument();
    });
});
