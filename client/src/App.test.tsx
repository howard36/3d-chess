import { render, screen } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import GameScreen from './screens/GameScreen';
import StartScreen from './screens/StartScreen';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import type { GameSocket } from './hooks/useGameSocket';
import type { WebSocketMessage } from './types/messages';

const fakeSocket = (messages: WebSocketMessage[] = [], send = () => {}): GameSocket => ({
  send,
  messages,
  reset: () => {},
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

test('StartScreen navigates to the game page when game_created arrives', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <StartScreen
              gameSocket={fakeSocket([{ type: 'game_created', gameId: 'ABC123' }])}
              setIsCreator={() => {}}
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
});

test('StartScreen shows server errors', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen
        gameSocket={fakeSocket([{ type: 'error', code: 'invalid_message', message: 'Bad request' }])}
        setIsCreator={() => {}}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Bad request');
});

test('GameScreen shows share link if isCreator is true', () => {
  render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={<GameScreen gameSocket={fakeSocket()} isCreator={true} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('Game created! Share this link with a friend:')).toBeInTheDocument();
  expect(screen.getByText(/\/game\/abc123/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Join Game' })).not.toBeInTheDocument();
});

test('GameScreen shows join button if isCreator is false', () => {
  render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={<GameScreen gameSocket={fakeSocket()} isCreator={false} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
  expect(
    screen.queryByText('Game created! Share this link with a friend:'),
  ).not.toBeInTheDocument();
});

test('clicking Join Game sends join_game message', async () => {
  const send = vi.fn();
  render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={<GameScreen gameSocket={fakeSocket([], send)} isCreator={false} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  const joinBtn = screen.getByRole('button', { name: 'Join Game' });
  await userEvent.click(joinBtn);
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ type: 'join_game', gameId: 'abc123' });
  });
  // Optimistic joined state
  expect(screen.getByText('Joined game, waiting for start...')).toBeInTheDocument();
});

test('GameScreen returns to the join button and shows the error when joining fails', async () => {
  const send = vi.fn();
  const { rerender } = render(
    <MemoryRouter initialEntries={['/game/NOPE01']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={<GameScreen gameSocket={fakeSocket([], send)} isCreator={false} />}
        />
      </Routes>
    </MemoryRouter>,
  );
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
              isCreator={false}
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
