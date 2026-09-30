import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import TurnPill from './screens/TurnPill';
import userEvent from '@testing-library/user-event';
import type { GameSocket } from './hooks/useGameSocket';
import type { WebSocketMessage } from './types/messages';
import type { Move } from './engine';
import { PieceType } from './engine';
import { getStoredRole, setStoredRole } from './lib/playerRole';
import { fakeSocket, gameScreenAt, loadBoardChunk } from './screens/testSupport';

// The started phase mounts a WebGL canvas, which jsdom can't provide; stub the
// three.js layer so these tests can assert on the surrounding UI. The Canvas
// stub renders only component children (the stubs below), not the raw
// three.js elements (lights, fog), which jsdom can't take.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) && typeof child.type !== 'string' ? child : null,
      )}
    </div>
  ),
}));
vi.mock('./three/CameraControls', () => ({
  CameraControls: () => null,
}));
vi.mock('./three/FitCameraToBoard', () => ({
  FitCameraToBoard: () => null,
}));
vi.mock('./three/scene/stage', () => ({
  Stage: () => null,
}));
vi.mock('./three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
// No frames in jsdom: the game's entrance is over as soon as it mounts
vi.mock('./three/scene/warm', () => ({
  WarmPrograms: () => null,
}));
vi.mock('./three/intro/IntroDirector', async () => {
  const { useEffect } = await import('react');
  return {
    INTRO_SCENE_VAR: '--intro-scene',
    INTRO_HUD_VAR: '--intro-hud',
    IntroDirector: ({ onDone }: { onDone?: () => void }) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
      useEffect(() => onDone?.(), []);
      return null;
    },
  };
});
// The 3D board itself is covered by Board.test.tsx; here it is a button that
// plays a fixed pawn move, so GameScreen's move wiring can be exercised.
vi.mock('./three/Board', () => ({
  default: ({
    onMove,
    onChoosePromotion,
    disabled,
  }: {
    onMove?: (m: Move) => void;
    onChoosePromotion?: (choices: Move[]) => void;
    disabled?: boolean;
  }) => (
    <>
      <button
        data-testid="board"
        disabled={disabled}
        onClick={() => onMove?.({ from: { x: 0, y: 0, z: 1 }, to: { x: 0, y: 0, z: 2 } })}
      >
        board
      </button>
      <button
        data-testid="board-promote"
        disabled={disabled}
        onClick={() =>
          onChoosePromotion?.(
            [PieceType.Queen, PieceType.Rook, PieceType.Unicorn].map((promotion) => ({
              from: { x: 2, y: 4, z: 3 },
              to: { x: 2, y: 4, z: 4 },
              promotion,
            })),
          )
        }
      >
        promote
      </button>
    </>
  ),
}));

// The 3D board is a lazy chunk: load it before any test looks for it
beforeAll(loadBoardChunk);
beforeEach(() => {
  localStorage.clear();
});

const renderGameScreen = (gameId: string, socket: GameSocket) =>
  render(gameScreenAt(socket, gameId));

// A guest's invitation, once the server has said the host holds White
const invited: WebSocketMessage[] = [{ type: 'game_info', gameId: 'abc123', seats: ['white'] }];

test('GameScreen shows the invite card once the seat this browser holds is confirmed', () => {
  setStoredRole('abc123', 'white');
  const { rerender } = renderGameScreen('abc123', fakeSocket());
  // Rejoining: a moment, and neither card
  expect(screen.getByText('Returning to your game…')).toBeInTheDocument();
  expect(screen.queryByTestId('invite-card')).not.toBeInTheDocument();
  rerender(
    gameScreenAt(fakeSocket([{ type: 'game_state', color: 'white', started: false, moves: [] }])),
  );
  expect(screen.getByTestId('invite-card')).toHaveAttribute('data-seat', 'white');
  expect(screen.getByTestId('share-link')).toHaveAttribute(
    'data-link',
    `${window.location.origin}/game/abc123`,
  );
  expect(screen.queryByRole('button', { name: 'Join game' })).not.toBeInTheDocument();
});

test('taking the seat an invitation offers sends join_game', async () => {
  const send = vi.fn();
  renderGameScreen('abc123', fakeSocket(invited, send));
  expect(screen.queryByTestId('invite-card')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({
      type: 'join_game',
      gameId: 'abc123',
      clientId: expect.any(String),
    });
  });
  // Optimistic joined state
  expect(screen.getByRole('button', { name: 'Joining…' })).toHaveAttribute('aria-disabled', 'true');
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
    expect(send).toHaveBeenCalledWith({
      type: 'rejoin_game',
      gameId: 'abc123',
      color: 'black',
      clientId: expect.any(String),
      takeover: true,
    });
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
  // Creator still sees the invitation to send
  expect(screen.getByTestId('invite-card')).toHaveAttribute('data-seat', 'white');
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
        moves: [{ by: 'white', from: 'Ba1', to: 'Ca1' }],
      },
    ]),
  );
  expect(screen.getByTestId('seat')).toHaveAttribute('data-seat', 'white');
  // One move replayed from history: black to move, the opponent's half lit
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Their move');
});

test('GameScreen shows the waiting screen when game_state says the game has not started', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: false, moves: [] }]),
  );
  expect(screen.getByTestId('invite-card')).toBeInTheDocument();
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
  rerender(gameScreenAt(fakeSocket(msgs, send, { sessionId: 2, sessionStartIndex: msgs.length })));
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({
      type: 'rejoin_game',
      gameId: 'abc123',
      color: 'white',
      clientId: expect.any(String),
      takeover: false,
    });
  });
  expect(send).toHaveBeenCalledTimes(1);
});

test('GameScreen shows a reconnecting notice while the socket is down', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: true, moves: [] }], () => true, {
      status: 'reconnecting',
    }),
  );
  // Under the pill, in a status region that was there before it, and the
  // pill, which may be out of date, dims
  expect(screen.getByText('Reconnecting…').closest('[role="status"]')).not.toBeNull();
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-stale', 'true');
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
        // Ca1 is empty in the starting position: no client version could have
        // made this move, so replay must stop instead of throwing mid-render.
        moves: [{ by: 'white', from: 'Ca1', to: 'Da1' }],
      },
    ]),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/can't be replayed by this version/);
  // Nothing was applied, so the shown position is still White to move
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
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
          { by: 'white', from: 'Ba1', to: 'Ca1' },
          { by: 'black', from: 'Dd5', to: 'Cd5' },
          { by: 'white', from: 'Ac2', to: 'Ec5' },
        ],
      },
    ]),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(/Move 3 of this game/);
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  // The record itself is still listed in full
  expect(screen.getByTestId('move-list')).toHaveTextContent('Ac2–Ec5');
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
          { by: 'white', from: 'Bb1', to: 'Cb1' },
          { by: 'black', from: 'Dd5', to: 'Cd5' },
        ],
      },
    ]),
  );
  const list = screen.getByTestId('move-list');
  expect(list).toHaveTextContent('1.');
  expect(list).toHaveTextContent('Bb1–Cb1');
  expect(list).toHaveTextContent('Dd5–Cd5');
});

test('GameScreen does not double-count moves that predate a reconnect snapshot', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([
      // Live session: one move arrives normally...
      { type: 'game_start', color: 'white' },
      { type: 'move_made', by: 'white', from: 'Ba1', to: 'Ca1' },
      // ...then a reconnect replays the full history in a snapshot.
      {
        type: 'game_state',
        color: 'white',
        started: true,
        moves: [
          { by: 'white', from: 'Bb1', to: 'Cb1' },
          { by: 'black', from: 'Dd5', to: 'Cd5' },
        ],
      },
    ]),
  );
  // Two moves total (not three): back to White
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
});

test('GameScreen clears a stale role and falls back to the invitation when rejoin fails', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket([], send));
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({
      type: 'rejoin_game',
      gameId: 'abc123',
      color: 'white',
      clientId: expect.any(String),
      takeover: true,
    });
  });

  // Server rejects the rejoin (the seat was never claimed)
  const refused: WebSocketMessage[] = [
    { type: 'error', code: 'invalid_rejoin', message: 'No such seat to rejoin' },
  ];
  rerender(gameScreenAt(fakeSocket(refused, send)));
  await waitFor(() => expect(getStoredRole('abc123')).toBeNull());
  expect(screen.getByRole('alert')).toHaveTextContent('No such seat to rejoin');
  // The page is now a guest's: it asks which seat is free, and offers it
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith({ type: 'look_game', gameId: 'abc123' }),
  );
  // (nothing said about the wait: it is usually over in a moment)
  expect(screen.queryByText(/server…/)).not.toBeInTheDocument();
  rerender(gameScreenAt(fakeSocket([...refused, ...invited], send)));
  expect(screen.getByRole('button', { name: 'Join game' })).toBeEnabled();
});

test('GameScreen clears a stale role and says so when the game has expired', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket([], send));
  rerender(
    gameScreenAt(
      fakeSocket([{ type: 'error', code: 'invalid_game', message: 'Cannot rejoin' }], send),
    ),
  );
  await waitFor(() => expect(getStoredRole('abc123')).toBeNull());
  expect(screen.getByRole('heading', { name: 'No game here' })).toBeInTheDocument();
  // Nothing more to ask: the refusal already answers the look
  expect(send).toHaveBeenCalledTimes(1);
});

test.each([
  ['invalid_game', 'Cannot join', 'No game here'],
  ['game_full', 'Game is full', 'This game is taken'],
] as const)(
  'GameScreen tells the guest why their join was refused (%s)',
  async (code, message, heading) => {
    const send = vi.fn();
    const { rerender } = renderGameScreen('abc123', fakeSocket(invited, send));
    await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
    expect(screen.getByRole('button', { name: 'Joining…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Server rejects the join: the card says why, in place of the banner
    rerender(gameScreenAt(fakeSocket([...invited, { type: 'error', code, message }], send)));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(heading);
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new game' })).toBeInTheDocument();
    expect(getStoredRole('abc123')).toBeNull();
  },
);

test('GameScreen explains a replaced seat and lets the user take the game back', async () => {
  setStoredRole('abc123', 'white');
  const reconnect = vi.fn();
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: true, moves: [] }], () => true, {
      status: 'replaced',
      reconnect,
    }),
  );
  expect(
    screen.getByRole('alertdialog', { name: 'This game is open in another tab' }),
  ).toBeInTheDocument();
  // The dialog takes focus, and the game behind it is out of reach
  expect(screen.getByRole('button', { name: 'Play here' })).toHaveFocus();
  expect(screen.getByTestId('r3f-canvas').closest('[inert]')).not.toBeNull();
  // Not a connection fault, so no retry banner
  expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
  expect(reconnect).toHaveBeenCalledTimes(1);
});

test('GameScreen shows the replaced notice on the waiting screen too', () => {
  setStoredRole('abc123', 'white');
  renderGameScreen(
    'abc123',
    fakeSocket([{ type: 'game_state', color: 'white', started: false, moves: [] }], () => true, {
      status: 'replaced',
    }),
  );
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  // The invitation stays behind it, out of reach
  expect(screen.getByTestId('invite-card').closest('[inert]')).not.toBeNull();
});

test('GameScreen stores the role from game_joined, so a drop before game_start is recoverable', () => {
  const joined: WebSocketMessage[] = [...invited, { type: 'game_joined', color: 'black' }];
  const { rerender } = render(gameScreenAt(fakeSocket(joined)));
  expect(getStoredRole('abc123')).toBe('black');
  // Seat confirmed but the game hasn't started: still the guest's card,
  // taking the seat (not the host's invitation to send)
  expect(screen.queryByTestId('invite-card')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Joining…' })).toHaveAttribute('aria-disabled', 'true');

  // A session that already holds game_joined must not rejoin on top of it
  const send = vi.fn();
  rerender(gameScreenAt(fakeSocket(joined, send)));
  expect(send).not.toHaveBeenCalled();
});

const started: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];

test('GameScreen sends a move and holds the board until the server answers', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board'));
  expect(send).toHaveBeenCalledWith({ type: 'move', from: 'Ba1', to: 'Ca1', promotion: undefined });
  // Awaiting the echo: a second move must not go out into a turn that may
  // no longer be ours (the server would answer wrong_turn).
  expect(screen.getByTestId('board')).toBeDisabled();
  expect(send).toHaveBeenCalledTimes(1);

  // The echo arrives: the board is live again
  rerender(
    gameScreenAt(
      fakeSocket([...started, { type: 'move_made', by: 'white', from: 'Ba1', to: 'Ca1' }], send),
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
    gameScreenAt(fakeSocket(started, send, { sessionId: 2, sessionStartIndex: started.length })),
  );
  // Still held until the new connection's rejoin is answered with a snapshot
  expect(screen.getByTestId('board')).toBeDisabled();
  const answered: WebSocketMessage[] = [
    ...started,
    { type: 'game_state', color: 'white', started: true, moves: [] },
  ];
  rerender(
    gameScreenAt(fakeSocket(answered, send, { sessionId: 2, sessionStartIndex: started.length })),
  );
  expect(screen.getByTestId('board')).toBeEnabled();
});

test('GameScreen asks which piece to promote to and sends the chosen move', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board-promote'));
  const dialog = screen.getByRole('dialog', { name: 'Promote to' });
  expect(dialog).toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Unicorn' }));
  expect(send).toHaveBeenCalledWith({ type: 'move', from: 'Dc5', to: 'Ec5', promotion: 'U' });
  expect(screen.queryByRole('dialog', { name: 'Promote to' })).not.toBeInTheDocument();
  // The move is in flight, so the board holds like for any other move
  expect(screen.getByTestId('board')).toBeDisabled();
});

test('GameScreen closes the promotion prompt when the position moves on or the socket drops', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  const { rerender } = renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board-promote'));
  expect(screen.getByRole('dialog', { name: 'Promote to' })).toBeInTheDocument();

  // The socket drops: the board is a frozen snapshot, so is the prompt.
  rerender(gameScreenAt(fakeSocket(started, send, { status: 'reconnecting' })));
  expect(screen.queryByRole('dialog', { name: 'Promote to' })).not.toBeInTheDocument();
  // ...and it does not come back once reconnected: the choices were dropped.
  rerender(gameScreenAt(fakeSocket(started, send, { sessionId: 2 })));
  expect(screen.queryByRole('dialog', { name: 'Promote to' })).not.toBeInTheDocument();

  // A new position (the opponent moved, a replayed history) closes it too.
  await userEvent.click(screen.getByTestId('board-promote'));
  expect(screen.getByRole('dialog', { name: 'Promote to' })).toBeInTheDocument();
  rerender(
    gameScreenAt(
      fakeSocket([...started, { type: 'move_made', by: 'white', from: 'Ba1', to: 'Ca1' }], send),
    ),
  );
  expect(screen.queryByRole('dialog', { name: 'Promote to' })).not.toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
});

test('GameScreen drops the promotion when the player cancels', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn();
  renderGameScreen('abc123', fakeSocket(started, send));
  await userEvent.click(screen.getByTestId('board-promote'));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByTestId('board')).toBeEnabled();
});

test('GameScreen shows whether the opponent is connected, from the latest presence message', () => {
  const { rerender } = renderGameScreen('abc123', fakeSocket(started));
  // No presence yet: nothing claimed either way
  const presence = screen.getByTestId('opponent-presence');
  expect(presence).not.toHaveAttribute('data-online');
  expect(presence).toHaveTextContent('');
  expect(screen.getByTestId('turn-indicator')).not.toHaveTextContent('Offline');

  const withPresence = (...presence: WebSocketMessage[]) =>
    gameScreenAt(fakeSocket([...started, ...presence]));
  rerender(withPresence({ type: 'presence', color: 'black', online: true }));
  // Online is the normal state: said to a screen reader, not shown
  expect(screen.getByTestId('opponent-presence')).toHaveAttribute('data-online', 'true');
  expect(screen.getByTestId('opponent-presence')).toHaveTextContent('Your opponent is online.');
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Opponent');
  expect(screen.getByTestId('turn-indicator')).not.toHaveTextContent('Offline');
  rerender(
    withPresence(
      { type: 'presence', color: 'black', online: true },
      { type: 'presence', color: 'black', online: false },
    ),
  );
  expect(screen.getByTestId('opponent-presence')).toHaveAttribute('data-online', 'false');
  expect(screen.getByTestId('opponent-presence')).toHaveTextContent('Your opponent is offline.');
  expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Offline');
  // A presence message about our own colour is not about the opponent
  rerender(
    withPresence(
      { type: 'presence', color: 'black', online: false },
      { type: 'presence', color: 'white', online: true },
    ),
  );
  expect(screen.getByTestId('opponent-presence')).toHaveAttribute('data-online', 'false');
});

test('GameScreen re-sends a join whose answer was lost to a drop, with the same client id', async () => {
  const send = vi.fn<GameSocket['send']>(() => true);
  const { rerender } = renderGameScreen('abc123', fakeSocket(invited, send));
  await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
  expect(send).toHaveBeenCalledTimes(1);

  rerender(gameScreenAt(fakeSocket(invited, send, { status: 'reconnecting' })));
  rerender(gameScreenAt(fakeSocket(invited, send, { sessionId: 2 })));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  const [first, second] = send.mock.calls.map(([msg]) => msg);
  expect(second).toEqual(first);
  expect(second).toMatchObject({ type: 'join_game', gameId: 'abc123' });
  expect(screen.getByRole('button', { name: 'Joining…' })).toHaveAttribute('aria-disabled', 'true');

  // Answered: the seat is stored, and a later drop rejoins instead
  const joined: WebSocketMessage[] = [...invited, { type: 'game_joined', color: 'black' }];
  rerender(gameScreenAt(fakeSocket(joined, send, { sessionId: 2 })));
  rerender(gameScreenAt(fakeSocket(joined, send, { sessionId: 3, sessionStartIndex: 2 })));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'rejoin_game', color: 'black', takeover: false }),
  );
});

test('GameScreen does not repeat a join that was queued and flushed by the next socket', async () => {
  const send = vi.fn<GameSocket['send']>(() => false);
  const { rerender } = renderGameScreen(
    'abc123',
    fakeSocket(invited, send, { status: 'connecting' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
  // The socket opens and flushes its queue: that was the join going out
  rerender(gameScreenAt(fakeSocket(invited, send, { sessionId: 2 })));
  await new Promise((r) => setTimeout(r, 20));
  expect(send).toHaveBeenCalledTimes(1);
  // ...which that socket's drop then lost: the next one repeats it
  rerender(gameScreenAt(fakeSocket(invited, send, { sessionId: 3 })));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});

test('GameScreen does not take the seat back after a reconnect, and offers Play here', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn<GameSocket['send']>(() => true);
  const reconnect = vi.fn();
  const held: WebSocketMessage[] = [
    { type: 'game_state', color: 'white', started: true, moves: [] },
  ];
  const { rerender } = renderGameScreen('abc123', fakeSocket(held, send, { reconnect }));
  rerender(gameScreenAt(fakeSocket(held, send, { sessionId: 2, sessionStartIndex: 1, reconnect })));
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'rejoin_game', takeover: false }),
    ),
  );

  const refused: WebSocketMessage[] = [
    ...held,
    { type: 'error', code: 'seat_in_use', message: 'This game is open in another tab' },
  ];
  rerender(
    gameScreenAt(fakeSocket(refused, send, { sessionId: 2, sessionStartIndex: 1, reconnect })),
  );
  expect(
    screen.getByRole('alertdialog', { name: 'This game is open in another tab' }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/^Error:/)).not.toBeInTheDocument();
  expect(screen.getByTestId('board')).toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Play here' }));
  expect(reconnect).toHaveBeenCalledTimes(1);
  rerender(
    gameScreenAt(
      fakeSocket(refused, send, { sessionId: 3, sessionStartIndex: refused.length, reconnect }),
    ),
  );
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'rejoin_game', takeover: true }),
    ),
  );
});

test('GameScreen holds the board until the rejoin on a fresh load is answered', () => {
  setStoredRole('abc123', 'white');
  const { rerender } = renderGameScreen(
    'abc123',
    fakeSocket(started, () => true, { sessionStartIndex: 1 }),
  );
  expect(screen.getByTestId('board')).toBeDisabled();
  rerender(
    gameScreenAt(
      fakeSocket(
        [...started, { type: 'game_state', color: 'white', started: true, moves: [] }],
        () => true,
        { sessionStartIndex: 1 },
      ),
    ),
  );
  expect(screen.getByTestId('board')).toBeEnabled();
});

test('GameScreen plays a move typed into the move box, and explains one it cannot play', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn<GameSocket['send']>(() => true);
  renderGameScreen('abc123', fakeSocket(started, send));
  const box = screen.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' });

  await userEvent.type(box, 'Ba2-Ea2{Enter}');
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText('The piece on Ba2 cannot move to Ea2.')).toBeInTheDocument();
  expect(box).toHaveAttribute('aria-invalid', 'true');

  await userEvent.clear(box);
  await userEvent.type(box, 'ba2 ca2{Enter}');
  expect(send).toHaveBeenCalledWith({ type: 'move', from: 'Ba2', to: 'Ca2', promotion: undefined });
  expect(box).toHaveValue('');
  // In flight: like the board, the box holds until the server answers
  expect(screen.getByTestId('board')).toBeDisabled();
  await userEvent.type(box, 'Bb2-Cb2{Enter}');
  expect(send).toHaveBeenCalledTimes(1);
});

test("GameScreen's move box only plays on the player's turn, and says so", async () => {
  setStoredRole('abc123', 'black');
  const send = vi.fn<GameSocket['send']>(() => true);
  renderGameScreen('abc123', fakeSocket([{ type: 'game_start', color: 'black' }], send));
  const box = screen.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' });
  await userEvent.type(box, 'Dd5-Cd5{Enter}');
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText('Wait for their move.')).toBeInTheDocument();
});

test('GameScreen keeps the move card out of sight until Tab asks for it', async () => {
  renderGameScreen('abc123', fakeSocket(started));
  const card = screen.getByTestId('move-card');
  // Out of sight, but in the page: the list for screen readers, the field for Tab
  expect(card).toHaveAttribute('data-hidden');
  expect(screen.getByRole('list', { name: 'Move history' })).toHaveClass('sr-only');
  // The first tab stop after the board (a few buttons in these tests; the
  // real canvas takes no focus)
  const field = screen.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' });
  for (let i = 0; i < 6 && document.activeElement !== field; i++) {
    await userEvent.tab();
  }
  expect(field).toHaveFocus();
  expect(card).not.toHaveAttribute('data-hidden');
  expect(screen.getByText(/Esc to hide/)).toBeInTheDocument();
  // Tab on to its button keeps it up; Escape puts it away
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Play the move' })).toHaveFocus();
  expect(card).not.toHaveAttribute('data-hidden');
  await userEvent.keyboard('{Escape}');
  expect(card).toHaveAttribute('data-hidden');
  // ...and the next Tab reaches the field again (not the button after it)
  await userEvent.tab();
  expect(screen.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' })).toHaveFocus();
  expect(card).not.toHaveAttribute('data-hidden');
  await userEvent.keyboard('{Escape}');
  expect(card).toHaveAttribute('data-hidden');
});

test('GameScreen announces each move as it lands, with whose move it is now', () => {
  const { rerender } = renderGameScreen('abc123', fakeSocket(started));
  const announcer = screen.getByTestId('move-announcer');
  expect(announcer).toHaveAttribute('aria-live', 'polite');
  expect(announcer).toHaveTextContent('');
  expect(announcer).toHaveAttribute('data-move-count', '0');
  rerender(
    gameScreenAt(
      fakeSocket([...started, { type: 'move_made', by: 'white', from: 'Bb1', to: 'Cb1' }]),
    ),
  );
  expect(announcer).toHaveTextContent('White pawn Bb1 to Cb1. Black to move.');
  expect(announcer).toHaveAttribute('data-last-move', 'Bb1-Cb1');
  expect(announcer).toHaveAttribute('data-move-count', '1');
});

describe('the turn pill', () => {
  const pill = (props: Partial<React.ComponentProps<typeof TurnPill>> = {}) => (
    <TurnPill
      seat="white"
      turn="white"
      inCheck={false}
      gameOver={null}
      opponentOnline={true}
      stale={false}
      {...props}
    />
  );

  it('lights the half of the side to move, the player always on the left', () => {
    const { rerender } = render(pill());
    const indicator = screen.getByTestId('turn-indicator');
    expect(indicator).toHaveTextContent(/^You play White\. Your move\.Your move\s*Opponent$/);
    expect(indicator).toHaveAttribute('data-turn', 'white');
    expect(indicator.querySelector('[data-side="me"]')).toHaveAttribute('data-on');
    rerender(pill({ turn: 'black' }));
    expect(indicator.querySelector('[data-side="them"]')).toHaveAttribute('data-on');
    expect(indicator).toHaveTextContent('Their move');
    expect(screen.getByTestId('seat')).toHaveTextContent('You play White. Black to move.');
  });

  it('shows no check in the pill, only to screen readers and tools', () => {
    const { rerender } = render(pill({ turn: 'black', inCheck: true }));
    const them = screen.getByTestId('turn-indicator').querySelector('[data-side="them"]');
    expect(them).not.toHaveTextContent(/check/i);
    expect(them?.querySelector('.hud-stone')).not.toHaveAttribute('data-check');
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-check', 'true');
    expect(screen.getByTestId('seat')).toHaveTextContent('Black to move, in check.');
    rerender(pill({ seat: 'black', turn: 'black', inCheck: true }));
    const me = screen.getByTestId('turn-indicator').querySelector('[data-side="me"]');
    expect(me).toHaveTextContent(/^Your move$/);
    expect(me?.querySelector('.hud-stone')).not.toHaveAttribute('data-check');
    expect(screen.getByTestId('seat')).toHaveTextContent('You play Black. Your move, in check.');
  });

  it('shows an absent opponent as an outline and "Offline", and dims while reconnecting', () => {
    render(pill({ opponentOnline: false, stale: true }));
    const indicator = screen.getByTestId('turn-indicator');
    expect(indicator).toHaveTextContent('Offline');
    expect(indicator.querySelector('[data-side="them"] .hud-stone')).toHaveAttribute('data-absent');
    expect(indicator).toHaveAttribute('data-stale', 'true');
    expect(screen.getByTestId('seat')).toHaveTextContent('Your opponent is offline.');
  });

  it("gives the result, from the player's side, once the game is over", () => {
    const { rerender } = render(pill({ gameOver: { result: 'checkmate', winner: 'white' } }));
    const indicator = screen.getByTestId('turn-indicator');
    expect(indicator).toHaveTextContent('Checkmate · you win');
    expect(indicator).toHaveAttribute('data-result', 'checkmate');
    expect(indicator).toHaveAttribute('data-winner', 'white');
    expect(indicator).not.toHaveAttribute('data-turn');
    rerender(pill({ gameOver: { result: 'checkmate', winner: 'black' } }));
    expect(indicator).toHaveTextContent('Checkmate · you lose');
    rerender(pill({ gameOver: { result: 'stalemate' } }));
    expect(indicator).toHaveTextContent('Stalemate · draw');
    expect(indicator).not.toHaveAttribute('data-winner');
  });
});

test('GameScreen shows the real position when a re-sent join is answered with a snapshot', async () => {
  const send = vi.fn<GameSocket['send']>(() => true);
  const { rerender } = renderGameScreen('abc123', fakeSocket(invited, send));
  await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
  // The first answer was lost; the repeated join is answered with the seat
  // and the whole record, in which White has already moved
  const answered: WebSocketMessage[] = [
    ...invited,
    { type: 'game_joined', color: 'black' },
    {
      type: 'game_state',
      color: 'black',
      started: true,
      moves: [{ by: 'white', from: 'Bb1', to: 'Cb1' }],
    },
  ];
  rerender(gameScreenAt(fakeSocket(answered, send, { sessionId: 2 })));
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
  expect(screen.getByTestId('move-list')).toHaveTextContent('Bb1–Cb1');
  expect(screen.getByTestId('board')).toBeEnabled();
  expect(getStoredRole('abc123')).toBe('black');
});

test('GameScreen still takes the seat over when a fresh page loses its first rejoin to a drop', async () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn<GameSocket['send']>(() => true);
  const { rerender } = renderGameScreen('abc123', fakeSocket([], send));
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ takeover: true })),
  );
  rerender(gameScreenAt(fakeSocket([], send, { status: 'reconnecting' })));
  rerender(gameScreenAt(fakeSocket([], send, { sessionId: 2 })));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ takeover: true }));
});

test('GameScreen sends no rejoin while the socket is down, so none is queued twice', () => {
  setStoredRole('abc123', 'white');
  const send = vi.fn<GameSocket['send']>(() => false);
  renderGameScreen('abc123', fakeSocket([], send, { status: 'reconnecting' }));
  expect(send).not.toHaveBeenCalled();
});

test('GameScreen drops the seat-in-use dialog while "Play here" opens a fresh socket', () => {
  setStoredRole('abc123', 'white');
  const refused: WebSocketMessage[] = [
    { type: 'error', code: 'seat_in_use', message: 'This game is open in another tab' },
  ];
  const { rerender } = renderGameScreen(
    'abc123',
    fakeSocket(refused, () => true),
  );
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  rerender(gameScreenAt(fakeSocket(refused, () => true, { status: 'connecting' })));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
