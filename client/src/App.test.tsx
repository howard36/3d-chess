import { render, screen } from '@testing-library/react';
import { test, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import GameScreen from './screens/GameScreen';
import StartScreen from './screens/StartScreen';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import type { GameSocket } from './hooks/useGameSocket';
import type { WebSocketMessage } from './types/messages';
import { getStoredRole, setStoredRole } from './lib/playerRole';

// The started phase mounts a WebGL canvas, which jsdom can't provide; stub the
// three.js layer so these tests can assert on the surrounding UI.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}));

const fakeSocket = (messages: WebSocketMessage[] = [], send = () => {}): GameSocket => ({
  send,
  messages,
  reset: () => {},
});

beforeEach(() => {
  localStorage.clear();
});

test('renders StartScreen for the default route', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  // Check for an element unique to StartScreen, like the button
  expect(screen.getByRole('button', { name: 'Start New Game' })).toBeInTheDocument();
});

test('StartScreen stores the assigned role and navigates when game_created arrives', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <StartScreen
              gameSocket={fakeSocket([{ type: 'game_created', gameId: 'ABC123', color: 'white' }])}
            />
          }
        />
        <Route path="/game/:gameId" element={<div>game page for ABC123</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.getByText('game page for ABC123')).toBeInTheDocument();
  });
  expect(getStoredRole('ABC123')).toBe('white');
});

test('StartScreen shows server errors', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen
        gameSocket={fakeSocket([{ type: 'error', code: 'invalid_message', message: 'Bad request' }])}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Bad request');
});

const renderGameScreen = (gameId: string, socket: GameSocket) =>
  render(
    <MemoryRouter initialEntries={[`/game/${gameId}`]}>
      <Routes>
        <Route path="/game/:gameId" element={<GameScreen gameSocket={socket} />} />
      </Routes>
    </MemoryRouter>,
  );

test('GameScreen shows share link when this browser holds a role in the game', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen('abc123', fakeSocket());
  expect(screen.getByText('Game created! Share this link with a friend:')).toBeInTheDocument();
  expect(screen.getByText(/\/game\/abc123/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Join Game' })).not.toBeInTheDocument();
});

test('GameScreen shows join button when no role is stored', () => {
  renderGameScreen('abc123', fakeSocket());
  expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
  expect(
    screen.queryByText('Game created! Share this link with a friend:'),
  ).not.toBeInTheDocument();
});

test('clicking Join Game sends join_game message', async () => {
  const send = vi.fn();
  renderGameScreen('abc123', fakeSocket([], send));
  const joinBtn = screen.getByRole('button', { name: 'Join Game' });
  await userEvent.click(joinBtn);
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ type: 'join_game', gameId: 'abc123' });
  });
  // Optimistic joined state
  expect(screen.getByText('Joined game, waiting for start...')).toBeInTheDocument();
});

test('GameScreen stores the role when game_start arrives', () => {
  renderGameScreen('abc123', fakeSocket([{ type: 'game_start', color: 'black' }]));
  expect(getStoredRole('abc123')).toBe('black');
});

test('GameScreen auto-rejoins on a fresh load when a role is stored', async () => {
  setStoredRole('abc123', 'black');
  const send = vi.fn();
  renderGameScreen('abc123', fakeSocket([], send));
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ type: 'rejoin_game', gameId: 'abc123', color: 'black' });
  });
  expect(send).toHaveBeenCalledTimes(1);
});

test('GameScreen does not rejoin when the session already created the game', () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_created', gameId: 'abc123', color: 'white' }], send),
  );
  expect(send).not.toHaveBeenCalled();
  // Creator still sees the share-link waiting screen
  expect(screen.getByText('Game created! Share this link with a friend:')).toBeInTheDocument();
});

test('GameScreen restores a started game from game_state', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([
      {
        type: 'game_state',
        color: 'white',
        started: true,
        moves: [{ by: 'white', from: 'Aa2', to: 'Aa3' }],
      },
    ]),
  );
  expect(screen.getByText('You are playing as white.')).toBeInTheDocument();
  // One move replayed from history: black to move
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Black to move');
});

test('GameScreen shows the waiting screen when game_state says the game has not started', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: false, moves: [] }]),
  );
  expect(screen.getByText('Game created! Share this link with a friend:')).toBeInTheDocument();
});

test('GameScreen clears a stale role and falls back to the join button when rejoin fails', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket([], send));
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ type: 'rejoin_game', gameId: 'abc123', color: 'white' });
  });

  // Server rejects the rejoin (game expired or seat never claimed)
  rerender(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={
            <GameScreen
              gameSocket={fakeSocket(
                [{ type: 'error', code: 'invalid_rejoin', message: 'No such seat to rejoin' }],
                send,
              )}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
  });
  expect(getStoredRole('abc123')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('No such seat to rejoin');
});

test('GameScreen returns to the join button and shows the error when joining fails', async () => {
  const send = vi.fn();
  const { rerender } = renderGameScreen('NOPE01', fakeSocket([], send));
  await userEvent.click(screen.getByRole('button', { name: 'Join Game' }));
  expect(screen.getByText('Joined game, waiting for start...')).toBeInTheDocument();

  // Server rejects the join
  rerender(
    <MemoryRouter initialEntries={['/game/NOPE01']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={
            <GameScreen
              gameSocket={fakeSocket(
                [{ type: 'error', code: 'invalid_game', message: 'Cannot join' }],
                send,
              )}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Cannot join');
});
