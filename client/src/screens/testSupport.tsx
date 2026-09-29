import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import GameScreen from './GameScreen';

/** A socket that has a message log and answers as its `send` says, for screen tests. */
export const fakeSocket = (
  messages: WebSocketMessage[] = [],
  send: GameSocket['send'] = () => true,
  overrides: Partial<GameSocket> = {},
): GameSocket => ({
  send,
  messages,
  status: 'connected',
  sessionId: 1,
  sessionStartIndex: 0,
  reconnect: () => {},
  reset: () => {},
  ...overrides,
});

/** The game page as the router mounts it; rerender with a new socket to play on. */
export const gameScreenAt = (socket: GameSocket, gameId = 'abc123') => (
  <MemoryRouter initialEntries={[`/game/${gameId}`]}>
    <Routes>
      <Route path="/game/:gameId" element={<GameScreen gameSocket={socket} />} />
    </Routes>
  </MemoryRouter>
);

/**
 * Loads the game's 3D board (GameCanvas.tsx, a lazy chunk) once for
 * the test file, by drawing a started game until the board is up: React
 * suspends the first time any file draws it, so a test that looks for the
 * board straight after its render would otherwise pass or fail by the order
 * the file's tests run in. Call it in beforeAll, after the file's mocks.
 */
export const loadBoardChunk = async () => {
  const { cleanup, render, screen } = await import('@testing-library/react');
  localStorage.clear();
  render(gameScreenAt(fakeSocket([{ type: 'game_start', color: 'white' }]), 'warm-up'));
  await screen.findByTestId('r3f-canvas');
  cleanup();
  localStorage.clear();
};
