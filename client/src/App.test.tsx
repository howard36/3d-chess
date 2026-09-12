import React from 'react';
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
import type { Move } from './engine';
import { getStoredRole, setStoredRole } from './lib/playerRole';

// The started phase mounts a WebGL canvas, which jsdom can't provide; stub the
// three.js layer so these tests can assert on the surrounding UI. The Canvas
// stub renders only component children (the Board stub below, OrbitControls),
// not the raw three.js elements (lights, fog), which jsdom can't take.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) && typeof child.type !== 'string' ? child : null,
      )}
    </div>
  ),
}));
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}));
// The 3D board itself is covered by Board.test.tsx; here it is a button that
// plays a fixed pawn move, so GameScreen's move wiring can be exercised.
vi.mock('./three/Board', () => ({
  default: ({ onMove, disabled }: { onMove?: (m: Move) => void; disabled?: boolean }) => (
    <button
      data-testid="board"
      disabled={disabled}
      onClick={() => onMove?.({ from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 2, z: 0 } })}
    >
      board
    </button>
  ),
}));
// The one test that renders <App /> must not open a real WebSocket to the
// production backend; every other test injects a fake socket directly.
vi.mock('./hooks/useGameSocket', () => ({
  useGameSocket: () => ({
    send: () => {},
    messages: [],
    status: 'connected',
    sessionId: 1,
    sessionStartIndex: 0,
    reconnect: () => {},
    reset: () => {},
  }),
}));

const fakeSocket = (
  messages: WebSocketMessage[] = [],
  send = () => {},
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

const renderStartScreen = (socket: GameSocket) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StartScreen gameSocket={socket} />} />
        <Route path="/game/:gameId" element={<div>game page for ABC123</div>} />
      </Routes>
    </MemoryRouter>,
  );

test('StartScreen stores the assigned role and navigates when its create request is answered', async () => {
  const send = vi.fn();
  const { rerender } = renderStartScreen(fakeSocket([], send));
  await userEvent.click(screen.getByRole('button', { name: 'Start New Game' }));
  expect(send).toHaveBeenCalledWith({ type: 'create_game' });
  expect(screen.getByRole('button', { name: 'Creating Game...' })).toBeDisabled();

  rerender(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <StartScreen
              gameSocket={fakeSocket(
                [{ type: 'game_created', gameId: 'ABC123', color: 'white' }],
                send,
              )}
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

test('StartScreen ignores a game_created left in the log by a previous game', () => {
  // "Start new game" from a finished game lands here with that game's
  // game_created still in the log (App resets the session in an effect that
  // runs after this screen's). Reacting to it navigated straight back into
  // the finished game.
  renderStartScreen(fakeSocket([{ type: 'game_created', gameId: 'ABC123', color: 'white' }]));
  expect(screen.getByRole('button', { name: 'Start New Game' })).toBeEnabled();
  expect(screen.queryByText('game page for ABC123')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('StartScreen shows the server error that answers its request, not an older one', async () => {
  const stale: WebSocketMessage[] = [
    { type: 'error', code: 'invalid_game', message: 'Cannot rejoin' },
  ];
  const { rerender } = render(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen gameSocket={fakeSocket(stale)} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Start New Game' }));
  rerender(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen
        gameSocket={fakeSocket([
          ...stale,
          { type: 'error', code: 'invalid_message', message: 'Bad request' },
        ])}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Bad request');
});

test('StartScreen re-enables the create button when the server answers with an error', async () => {
  const send = vi.fn();
  const { rerender } = render(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen gameSocket={fakeSocket([], send)} />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Start New Game' }));
  expect(send).toHaveBeenCalledWith({ type: 'create_game' });
  expect(screen.getByRole('button', { name: 'Creating Game...' })).toBeDisabled();

  rerender(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen
        gameSocket={fakeSocket(
          [{ type: 'error', code: 'already_in_game', message: 'Already in a game' }],
          send,
        )}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Already in a game');
  expect(screen.getByRole('button', { name: 'Start New Game' })).toBeEnabled();
});

test('StartScreen reports the connection status until the socket is open', () => {
  const { rerender } = render(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen gameSocket={fakeSocket([], () => {}, { status: 'connecting' })} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Connecting to server…');

  rerender(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen gameSocket={fakeSocket([], () => {}, { status: 'reconnecting' })} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to server…');

  rerender(
    <MemoryRouter initialEntries={['/']}>
      <StartScreen gameSocket={fakeSocket()} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

test('GameScreen rejoins again when the socket session changes (mid-game reconnect)', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  const msgs: WebSocketMessage[] = [
    { type: 'game_state', color: 'white', started: true, moves: [] },
  ];
  // Session 1 already holds the seat (game_state arrived on it): no rejoin.
  const { rerender } = renderGameScreen('abc123', fakeSocket(msgs, send));
  expect(send).not.toHaveBeenCalled();

  // The socket dropped and reopened: session 2 starts after the retained log,
  // and the server no longer knows this client — it must rejoin.
  rerender(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={
            <GameScreen
              gameSocket={fakeSocket(msgs, send, { sessionId: 2, sessionStartIndex: msgs.length })}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ type: 'rejoin_game', gameId: 'abc123', color: 'white' });
  });
  expect(send).toHaveBeenCalledTimes(1);
});

test('GameScreen shows a reconnecting notice while the socket is down', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: true, moves: [] }], () => {}, {
      status: 'reconnecting',
    }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
});

test('GameScreen freezes at the last good position when history has an unplayable move', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([
      {
        type: 'game_state',
        color: 'white',
        started: true,
        // Aa3 is empty in the starting position: no client version could have
        // made this move, so replay must stop instead of throwing mid-render.
        moves: [{ by: 'white', from: 'Aa3', to: 'Aa4' }],
      },
    ]),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/not a legal move for this client/);
  // Nothing was applied, so the shown position is still White to move
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('White to move');
});

test('GameScreen freezes before a recorded king capture instead of crashing', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([
      {
        type: 'game_state',
        color: 'white',
        started: true,
        // Shape-valid and turn-correct, so the server recorded it, but no
        // client that detects check could have played a king capture. The
        // position after it has no black king to test for check, which used
        // to throw from the game-over check and white-screen the page.
        moves: [
          { by: 'white', from: 'Aa2', to: 'Aa3' },
          { by: 'black', from: 'Ed4', to: 'Ed3' },
          { by: 'white', from: 'Bc1', to: 'Ec5' },
        ],
      },
    ]),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/Move 3 in this game's history/);
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('White to move');
  // The record itself is still listed in full
  expect(screen.getByTestId('move-list')).toHaveTextContent('Bc1–Ec5');
});

test('GameScreen lists played moves in wire notation', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([
      {
        type: 'game_state',
        color: 'white',
        started: true,
        moves: [
          { by: 'white', from: 'Ab2', to: 'Ab3' },
          { by: 'black', from: 'Ed4', to: 'Ed3' },
        ],
      },
    ]),
  );
  const list = screen.getByTestId('move-list');
  expect(list).toHaveTextContent('1.');
  expect(list).toHaveTextContent('Ab2–Ab3');
  expect(list).toHaveTextContent('Ed4–Ed3');
});

test('GameScreen does not double-count moves that predate a reconnect snapshot', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([
      // Live session: one move arrives normally...
      { type: 'game_start', color: 'white' },
      { type: 'move_made', by: 'white', from: 'Aa2', to: 'Aa3' },
      // ...then a reconnect replays the full history in a snapshot.
      {
        type: 'game_state',
        color: 'white',
        started: true,
        moves: [
          { by: 'white', from: 'Ab2', to: 'Ab3' },
          { by: 'black', from: 'Ed4', to: 'Ed3' },
        ],
      },
    ]),
  );
  // Two moves total (not three): back to White
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('White to move');
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

test('GameScreen explains a replaced seat and lets the user take the game back', async () => {
  setStoredRole('abc123', 'white');
  const reconnect = vi.fn();
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: true, moves: [] }], () => {}, {
      status: 'replaced',
      reconnect,
    }),
  );
  const dialog = screen.getByRole('alertdialog', { name: 'This game is open in another tab' });
  expect(dialog).toBeInTheDocument();
  // Not a connection fault, so no retry banner
  expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
  expect(reconnect).toHaveBeenCalledTimes(1);
});

test('GameScreen shows the replaced notice on the waiting screen too', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([], () => {}, { status: 'replaced' }),
  );
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(screen.getByText('Game created! Share this link with a friend:')).toBeInTheDocument();
});

test('GameScreen stores the role from game_joined, so a drop before game_start is recoverable', () => {
  const { rerender } = render(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={
            <GameScreen gameSocket={fakeSocket([{ type: 'game_joined', color: 'black' }])} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(getStoredRole('abc123')).toBe('black');
  // Seat confirmed but the game hasn't started: neither the share link nor the join button
  expect(screen.getByText('Joined game, waiting for start...')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Join Game' })).not.toBeInTheDocument();

  // A session that already holds game_joined must not rejoin on top of it
  const send = vi.fn();
  rerender(
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={
            <GameScreen gameSocket={fakeSocket([{ type: 'game_joined', color: 'black' }], send)} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(send).not.toHaveBeenCalled();
});

const started: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
const gameScreenAt = (socket: GameSocket) => (
  <MemoryRouter initialEntries={['/game/abc123']}>
    <Routes>
      <Route path="/game/:gameId" element={<GameScreen gameSocket={socket} />} />
    </Routes>
  </MemoryRouter>
);

test('GameScreen sends a move and holds the board until the server answers', async () => {
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board'));
  expect(send).toHaveBeenCalledWith({ type: 'move', from: 'Aa2', to: 'Aa3', promotion: undefined });
  // Awaiting the echo: a second move must not go out into a turn that may
  // no longer be ours (the server would answer wrong_turn).
  expect(screen.getByTestId('board')).toBeDisabled();
  expect(send).toHaveBeenCalledTimes(1);

  // The echo arrives: the board is live again
  rerender(
    gameScreenAt(
      fakeSocket([...started, { type: 'move_made', by: 'white', from: 'Aa2', to: 'Aa3' }], send),
    ),
  );
  expect(screen.getByTestId('board')).toBeEnabled();
});

test('GameScreen frees the board when the server rejects the move', async () => {
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board'));
  expect(screen.getByTestId('board')).toBeDisabled();
  rerender(
    gameScreenAt(
      fakeSocket(
        [...started, { type: 'error', code: 'wrong_turn', message: 'Not your turn' }],
        send,
      ),
    ),
  );
  expect(screen.getByTestId('board')).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Not your turn');
});

test('GameScreen frees the board after a reconnect, since the unanswered move was dropped', async () => {
  const send = vi.fn();
  setStoredRole('abc123', 'white');
  const { rerender } = renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board'));
  expect(screen.getByTestId('board')).toBeDisabled();
  // The socket dropped and reopened as session 2 before any answer came.
  rerender(gameScreenAt(fakeSocket(started, send, { status: 'reconnecting' })));
  rerender(
    gameScreenAt(
      fakeSocket(
        [...started, { type: 'game_state', color: 'white', started: true, moves: [] }],
        send,
        { sessionId: 2, sessionStartIndex: started.length },
      ),
    ),
  );
  expect(screen.getByTestId('board')).toBeEnabled();
});

test('GameScreen shows whether the opponent is connected, from the latest presence message', () => {
  const { rerender } = renderGameScreen('abc123', fakeSocket(started));
  // No presence yet: nothing claimed either way
  expect(screen.queryByTestId('opponent-presence')).not.toBeInTheDocument();

  const withPresence = (...presence: WebSocketMessage[]) => (
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route
          path="/game/:gameId"
          element={<GameScreen gameSocket={fakeSocket([...started, ...presence])} />}
        />
      </Routes>
    </MemoryRouter>
  );
  rerender(withPresence({ type: 'presence', color: 'black', online: true }));
  expect(screen.getByTestId('opponent-presence')).toHaveTextContent('Opponent: online');
  rerender(
    withPresence(
      { type: 'presence', color: 'black', online: true },
      { type: 'presence', color: 'black', online: false },
    ),
  );
  expect(screen.getByTestId('opponent-presence')).toHaveTextContent('Opponent: offline');
  // A presence message about our own colour is not about the opponent
  rerender(
    withPresence(
      { type: 'presence', color: 'black', online: false },
      { type: 'presence', color: 'white', online: true },
    ),
  );
  expect(screen.getByTestId('opponent-presence')).toHaveTextContent('Opponent: offline');
});
