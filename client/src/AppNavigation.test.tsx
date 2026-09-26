// Navigation between games, with the real socket hook against a mock server:
// the reset on a change of game has to land before the next game's screen
// reads the log, or that screen takes the previous game's seat for its own.
import WS from 'jest-websocket-mock';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import React from 'react';
import App from './App';
import { WS_URL } from './hooks/useGameSocket';
import { getStoredRole, setStoredRole } from './lib/playerRole';

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

let server: WS;
beforeEach(() => {
  localStorage.clear();
  server = new WS(WS_URL, { jsonProtocol: true });
});
afterEach(() => {
  WS.clean();
});

// Exposes navigate() to the test, standing in for a jump through history
let go: (to: string) => void = () => {};
function Navigator() {
  const navigate = useNavigate();
  React.useEffect(() => {
    go = navigate;
  }, [navigate]);
  return null;
}

test('jumping from one game page to another keeps each game its own seat', async () => {
  // Game A: this page joined it live and got Black. Game B: this browser is White there.
  setStoredRole('GAMEB0', 'white');
  render(
    <MemoryRouter initialEntries={['/game/GAMEA0']}>
      <App />
      <Navigator />
    </MemoryRouter>,
  );
  await server.connected;
  await userJoins();
  act(() => {
    server.send({ type: 'game_joined', color: 'black' });
  });
  await screen.findByText('Joined game, waiting for start...');
  expect(getStoredRole('GAMEA0')).toBe('black');

  act(() => go('/game/GAMEB0'));
  // The old socket is closed and a fresh one opens for B, which rejoins as
  // B's own seat, taking it over like any page arriving at a game
  await server.closed;
  await server.connected;
  await expect(server).toReceiveMessage(
    expect.objectContaining({
      type: 'rejoin_game',
      gameId: 'GAMEB0',
      color: 'white',
      takeover: true,
    }),
  );
  expect(getStoredRole('GAMEB0')).toBe('white');
  expect(getStoredRole('GAMEA0')).toBe('black');
});

async function userJoins() {
  const button = await screen.findByRole('button', { name: 'Join Game' });
  act(() => button.click());
  await expect(server).toReceiveMessage(
    expect.objectContaining({ type: 'join_game', gameId: 'GAMEA0' }),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Join Game' })).toBeNull());
}
