/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Regression test for a real read-amplification bug: `allPlayerNames` is
 * recomputed as a fresh array on every GameMasterView render (even an
 * unrelated player-doc write, e.g. a boundary location report that lands
 * every 5-15s), so without memoization here, the `players` prop handed to
 * LivePlayerMapButton would be a new array (of new objects) on every
 * render too. LivePlayerMapButton's own Firestore listener is keyed on
 * that exact prop — a changed reference tears it down and resubscribes,
 * which re-reads every document in the boundaryStatuses collection, not
 * just the delta. This test proves the reference HeaderExecution hands
 * down stays stable across renders where the actual player names did not
 * change, and only changes when they do.
 *
 * Every other child is stubbed — each has its own thorough test file —
 * so this stays focused on HeaderExecution's own memoization, same
 * reasoning as GameMasterView.test.jsx's stubs.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render } from '@testing-library/react';
import HeaderExecution from './HeaderExecution';
import { gameContext } from '../Contexts';

const capturedPlayersProps = [];
jest.mock('../map_components/LivePlayerMapButton', () => (props) => {
    capturedPlayersProps.push(props.players);
    return null;
});

jest.mock('./PlaybookLink', () => () => null);
jest.mock('./ResetTargetsButton', () => () => null);
jest.mock('./Endgamebutton', () => () => null);
jest.mock('./LogoutButton', () => () => null);
jest.mock('../map_components/GameBoundaryButton', () => () => null);

const renderHeader = (allPlayerNames) =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-1' }}>
                <HeaderExecution
                    addLog={jest.fn()}
                    arrayOfAlivePlayers={[]}
                    allPlayerNames={allPlayerNames}
                    gameBoundary={null}
                />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    capturedPlayersProps.length = 0;
});

describe('HeaderExecution — LivePlayerMapButton players prop stability', () => {
    it('keeps the same players reference across a re-render with an unchanged, differently-ordered roster', () => {
        const { rerender } = renderHeader(['alice', 'bob']);
        // A new array instance with the same names in a different order —
        // exactly what GameMasterView's own score-ordered query produces
        // on an unrelated write (e.g. a score change), with no actual
        // roster change.
        rerender(
            <ChakraProvider>
                <gameContext.Provider value={{ roomID: 'room-1' }}>
                    <HeaderExecution
                        addLog={jest.fn()}
                        arrayOfAlivePlayers={[]}
                        allPlayerNames={['bob', 'alice']}
                        gameBoundary={null}
                    />
                </gameContext.Provider>
            </ChakraProvider>
        );

        expect(capturedPlayersProps).toHaveLength(2);
        expect(capturedPlayersProps[0]).toBe(capturedPlayersProps[1]);
    });

    it('produces a new players reference once the actual roster changes', () => {
        const { rerender } = renderHeader(['alice', 'bob']);
        rerender(
            <ChakraProvider>
                <gameContext.Provider value={{ roomID: 'room-1' }}>
                    <HeaderExecution
                        addLog={jest.fn()}
                        arrayOfAlivePlayers={[]}
                        allPlayerNames={['alice', 'bob', 'carol']}
                        gameBoundary={null}
                    />
                </gameContext.Provider>
            </ChakraProvider>
        );

        expect(capturedPlayersProps).toHaveLength(2);
        expect(capturedPlayersProps[0]).not.toBe(capturedPlayersProps[1]);
        expect(capturedPlayersProps[1]).toEqual([
            { name: 'alice' },
            { name: 'bob' },
            { name: 'carol' },
        ]);
    });
});
