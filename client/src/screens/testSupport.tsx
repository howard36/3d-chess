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
