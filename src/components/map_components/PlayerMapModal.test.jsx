/**
 * Layer 2 — React Testing Library. GameMap is stubbed (it has its own
 * thorough tests) so this stays focused on PlayerMapModal's own job:
 * passing props through, and Recenter on Me calling flyTo on the real
 * map instance handed to it via onMapLoad — the exact pattern
 * BoundaryEditorModal.js already uses, not a new API on GameMap.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import PlayerMapModal from './PlayerMapModal';

let mockLastProps;
const mockFakeMap = { flyTo: jest.fn() };

jest.mock('./GameMap', () => (props) => {
    mockLastProps = props;
    const React = require('react');
    React.useEffect(() => {
        if (props.onMapLoad) props.onMapLoad(mockFakeMap);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.onMapLoad]);
    return <div data-testid="mock-game-map" />;
});

const RING = [
    { lat: 10, lng: 20 },
    { lat: 10, lng: 21 },
    { lat: 11, lng: 21 },
    { lat: 10, lng: 20 },
];

const renderModal = (props = {}) =>
    render(
        <ChakraProvider>
            <PlayerMapModal
                isOpen
                onClose={jest.fn()}
                boundaryVertices={RING}
                ownPosition={null}
                otherPositions={[]}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => jest.clearAllMocks());

describe('PlayerMapModal', () => {
    it('passes the boundary and own position straight through to GameMap', () => {
        const ownPosition = { lat: 10, lng: 20, accuracyM: 12 };
        renderModal({ ownPosition });
        expect(mockLastProps.boundaryVertices).toEqual(RING);
        expect(mockLastProps.ownPosition).toEqual(ownPosition);
    });

    it('passes otherPositions straight through to GameMap', () => {
        const otherPositions = [{ id: 'bob', lat: 11, lng: 21 }];
        renderModal({ otherPositions });
        expect(mockLastProps.otherPositions).toEqual(otherPositions);
    });

    it('Recenter on Me is disabled with no own position', () => {
        renderModal({ ownPosition: null });
        expect(screen.getByRole('button', { name: 'Recenter on Me' })).toBeDisabled();
    });

    it('Recenter on Me flies the real map to the own position once available', () => {
        renderModal({ ownPosition: { lat: 10, lng: 20, accuracyM: 12 } });
        fireEvent.click(screen.getByRole('button', { name: 'Recenter on Me' }));
        expect(mockFakeMap.flyTo).toHaveBeenCalledWith(
            expect.objectContaining({ center: [20, 10] })
        );
    });

    it('renders the boundary status prominently above the map, so it stays visible while the modal is full-screen', () => {
        // Finding 2: the modal is full-screen on phones, hiding the page's
        // own status line entirely for as long as it stays open — the
        // spec requires status display "on the player page as well as
        // inside the map."
        renderModal({ statusText: 'You are outside the game area. Please return inside.' });
        expect(
            screen.getByText('You are outside the game area. Please return inside.')
        ).toBeInTheDocument();
    });

    it('renders nothing extra when no statusText is given', () => {
        renderModal({ statusText: null });
        expect(screen.getByTestId('mock-game-map')).toBeInTheDocument();
    });
});
