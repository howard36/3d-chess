import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import GameScreen from './screens/GameScreen';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';

// test('renders the R3F canvas', () => {
//   render(<App />);
//   expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
// });

test('renders StartScreen for the default route', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  // Check for an element unique to StartScreen, like the button
  expect(screen.getByRole('button', { name: 'Start New Game' })).toBeInTheDocument();
});

test('GameScreen shows waiting message if isCreator is true', () => {
  render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <GameScreen
        gameSocket={{ send: () => {}, lastMessage: { current: null } }}
        isCreator={true}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText('Waiting for player to join...')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Join Game' })).not.toBeInTheDocument();
});

test('GameScreen shows join button if isCreator is false', () => {
  render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <GameScreen
        gameSocket={{ send: () => {}, lastMessage: { current: null } }}
        isCreator={false}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
  expect(screen.queryByText('Waiting for player to join...')).not.toBeInTheDocument();
});

test('clicking Join Game sends join_game message', async () => {
  const send = vi.fn();
  const lastMessage = { current: null };
  render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={<GameScreen gameSocket={{ send, lastMessage }} isCreator={false} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  const joinBtn = screen.getByRole('button', { name: 'Join Game' });
  await userEvent.click(joinBtn);
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ type: 'join_game', gameId: 'abc123' });
  });
});
