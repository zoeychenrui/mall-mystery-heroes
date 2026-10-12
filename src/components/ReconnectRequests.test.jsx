/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Mirrors PhotosDisplay.test.jsx's own mock-setup conventions — a GM-
 * facing live list with judgment buttons that call thin Cloud Function
 * wrappers and then log+broadcast the outcome
 * (docs/superpowers/specs/2026-08-30-player-reconnect-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onSnapshot } from 'firebase/firestore';
import ReconnectRequests from './ReconnectRequests';
import { gameContext, executionContext } from './Contexts';
import * as dbCalls from './firebase_calls/dbCalls';
import { approveReconnectRequest } from './approveReconnectRequest';
import { denyReconnectRequest } from './denyReconnectRequest';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('./firebase_calls/dbCalls', () => ({
    addPlayerMessageForRoom: jest.fn(),
    fetchPendingReconnectRequestsQueryForRoom: jest.fn(() => 'requests-query'),
}));
jest.mock('./approveReconnectRequest', () => ({ approveReconnectRequest: jest.fn() }));
jest.mock('./denyReconnectRequest', () => ({ denyReconnectRequest: jest.fn() }));

const executionHandlers = {
    addLog: jest.fn(),
};

const mountWithRequests = (requests) => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: requests.map((data, i) => ({ id: `request-${i}`, data: () => data })) });
        return () => {};
    });

    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <ReconnectRequests />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );
};

beforeEach(() => {
    jest.clearAllMocks();
    dbCalls.addPlayerMessageForRoom.mockResolvedValue(undefined);
    approveReconnectRequest.mockResolvedValue(undefined);
    denyReconnectRequest.mockResolvedValue(undefined);
});

it('renders nothing when there are no pending requests', () => {
    mountWithRequests([]);

    expect(screen.queryByText(/wants to reconnect/)).not.toBeInTheDocument();
});

it('renders a row for each pending request', () => {
    mountWithRequests([{ playerName: 'alice' }, { playerName: 'bob' }]);

    expect(screen.getByText('alice wants to reconnect')).toBeInTheDocument();
    expect(screen.getByText('bob wants to reconnect')).toBeInTheDocument();
});

it('calls approveReconnectRequest and logs/broadcasts on Approve', async () => {
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
        expect(approveReconnectRequest).toHaveBeenCalledWith('room-a', 'request-0')
    );
    expect(executionHandlers.addLog).toHaveBeenCalledWith('alice reconnected', 'blue.300');
    expect(dbCalls.addPlayerMessageForRoom).toHaveBeenCalledWith(
        { type: 'broadcast', recipient: null, text: 'alice reconnected', standings: null },
        'room-a'
    );
});

it('calls denyReconnectRequest on Deny without broadcasting', async () => {
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(denyReconnectRequest).toHaveBeenCalledWith('room-a', 'request-0'));
    expect(dbCalls.addPlayerMessageForRoom).not.toHaveBeenCalled();
    expect(executionHandlers.addLog).not.toHaveBeenCalled();
});

it('shows an error toast when Approve is rejected', async () => {
    approveReconnectRequest.mockRejectedValue(new Error('This request has already been denied.'));
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('This request has already been denied.')).toBeInTheDocument();
});

it('shows an error toast when Deny is rejected', async () => {
    denyReconnectRequest.mockRejectedValue(new Error('This request has already been approved.'));
    mountWithRequests([{ playerName: 'alice' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(await screen.findByText('This request has already been approved.')).toBeInTheDocument();
});
