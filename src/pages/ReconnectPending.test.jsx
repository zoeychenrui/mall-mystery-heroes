/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the requester-facing side of
 * docs/superpowers/specs/2026-08-30-player-reconnect-design.md: shows a
 * waiting message while pending, redirects into the normal waiting-room
 * flow once approved (writing the session first), and shows a denied
 * message otherwise.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import ReconnectPending from './ReconnectPending';
import { fetchReconnectRequestReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { readPlayerSession } from '../utils/playerSession';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchReconnectRequestReferenceForRoom: jest.fn(() => 'request-ref'),
}));

const renderPending = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/reconnecting/request-1']}>
                <Routes>
                    <Route
                        path="/rooms/:roomID/reconnecting/:requestId"
                        element={<ReconnectPending />}
                    />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

it('fetches the request for this room and requestId', () => {
    onSnapshot.mockImplementation(() => () => {});
    renderPending();

    expect(fetchReconnectRequestReferenceForRoom).toHaveBeenCalledWith('request-1', 'Fluffy42317');
});

it('shows a waiting message while the request is pending', () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({ exists: () => true, data: () => ({ status: 'pending' }) });
        return () => {};
    });

    renderPending();

    expect(screen.getByText('Waiting for the host to approve your reconnect…')).toBeInTheDocument();
});

it('writes the session and navigates to the waiting room once approved', async () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({
            exists: () => true,
            data: () => ({ status: 'approved', playerName: 'Alice' }),
        });
        return () => {};
    });

    renderPending();

    expect(await screen.findByText('Waiting page')).toBeInTheDocument();
    expect(readPlayerSession()).toEqual({ roomID: 'Fluffy42317', playerName: 'Alice' });
});

it('shows a denied message and a way back home when denied', async () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({ exists: () => true, data: () => ({ status: 'denied' }) });
        return () => {};
    });

    renderPending();

    expect(screen.getByText('Your reconnect request was denied')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
});

it('treats the request document disappearing the same as denied', () => {
    onSnapshot.mockImplementation((ref, onNext) => {
        onNext({ exists: () => false });
        return () => {};
    });

    renderPending();

    expect(screen.getByText('Your reconnect request was denied')).toBeInTheDocument();
});
