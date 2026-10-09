// Navigation between games, with the real socket hook against a mock server:
// the reset on a change of game has to land before the next game's screen
// reads the log, or that screen takes the previous game's seat for its own.
import WS from 'jest-websocket-mock';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router';
import React from 'react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { WS_URL } from './hooks/useGameSocket';
import { getStoredRole, setStoredRole } from './lib/playerRole';
import type { LobbyView } from './three/lobby/LobbyScene';

// The landing page's live preview is a WebGL canvas, which jsdom can't provide
vi.mock('./screens/LandingPreview', () => ({
  LandingPreview: () => null,
}));
// Neither is the lobby's stage: its canvas renders the scene component only,
// and the scene stands in for its choosing moment by saying at once that the
// pick has played out
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="lobby-canvas">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) && typeof child.type !== 'string' ? child : null,
      )}
    </div>
  ),
}));
vi.mock('./three/lobby/LobbyScene', () => ({
  LobbyScene: ({ view }: { view: LobbyView }) => {
    React.useEffect(() => {
      if (view.beat === 'choose' && view.mine) view.onSettled?.();
    }, [view]);
    return null;
  },
}));
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

test('the default route is the start screen', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('button', { name: 'Play a friend' })).toBeInTheDocument();
});

test.each(['/games', '/game/', '/game/ABC123/moves', '/new/x'])(
  'an address with no page (%s) says so, and leads home',
  async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    // Not the lobby: no stage, and no game asked of the server
    expect(screen.queryByTestId('lobby')).not.toBeInTheDocument();
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home).toHaveFocus();
    await userEvent.click(home);
    expect(await screen.findByRole('button', { name: 'Play a friend' })).toBeInTheDocument();
  },
);

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
  await waitFor(() => expect(getStoredRole('GAMEA0')).toBe('black'));

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
  // The invitation asks which seat is free before it offers one
  await expect(server).toReceiveMessage({ type: 'look_game', gameId: 'GAMEA0' });
  act(() => {
    server.send({ type: 'game_info', gameId: 'GAMEA0', seats: ['white'] });
  });
  const button = await screen.findByRole('button', { name: 'Join game' });
  act(() => button.click());
  await expect(server).toReceiveMessage(
    expect.objectContaining({ type: 'join_game', gameId: 'GAMEA0' }),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Join game' })).toBeNull());
}

test('a new game goes from the start screen through the side choice to its invitation', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Play a friend' }));
  // The side choice, over the lobby's stage
  expect(await screen.findByTestId('choose-side')).toBeInTheDocument();
  expect(screen.getByTestId('lobby')).toHaveAttribute('data-beat', 'choose');
  const stage = screen.getByTestId('lobby-canvas');
  await server.connected;
  await userEvent.click(screen.getByRole('button', { name: 'Black' }));
  await expect(server).toReceiveMessage({
    type: 'create_game',
    clientId: expect.any(String),
    color: 'black',
  });
  act(() => {
    server.send({ type: 'game_created', gameId: 'NEWG00', color: 'black' });
  });

  // The game's own page, on the same socket session: the creator's seat is
  // already held, so it sends nothing more and shows the invitation to send
  const card = await screen.findByTestId('invite-card');
  expect(card).toHaveAttribute('data-seat', 'black');
  expect(screen.getByTestId('share-link')).toHaveAttribute(
    'data-link',
    `${window.location.origin}/game/NEWG00`,
  );
  expect(getStoredRole('NEWG00')).toBe('black');
  expect(screen.getByTestId('lobby')).toHaveAttribute('data-beat', 'wait');
  // The stage stayed up across the move from one page to the other
  expect(screen.getByTestId('lobby-canvas')).toBe(stage);
  await new Promise((r) => setTimeout(r, 20));
  expect(server.messages).toHaveLength(1);
});
