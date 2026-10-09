import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketMessage } from '../types/messages';
import type { Move } from '../engine';
import type { BoardProps } from '../three/Board';
import { fakeSocket, gameScreenAt } from './testSupport';
import { getStoredRole, setStoredRole } from '../lib/playerRole';

// The error banner and the refusals the page acts on: each judged by what
// this page asked and what came back since, not by the whole log. No WebGL
// in jsdom: the three.js layer is stubbed, and the board only hands over its
// onMove.
const board = vi.hoisted(() => ({ onMove: null as ((move: Move) => void) | null }));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/scene/warm', () => ({
  WarmPrograms: () => null,
}));
vi.mock('../three/intro/IntroDirector', () => ({
  INTRO_SCENE_VAR: '--intro-scene',
  INTRO_HUD_VAR: '--intro-hud',
  IntroDirector: () => null,
}));
vi.mock('../three/Board', () => ({
  default: (props: BoardProps) => {
    board.onMove = props.onMove ?? null;
    return null;
  },
}));

const move: Move = { from: { x: 0, y: 1, z: 1 }, to: { x: 0, y: 1, z: 2 } };
const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
const wrongTurn: WebSocketMessage = { type: 'error', code: 'wrong_turn', message: 'Not your turn' };
const banner = () => screen.queryByTestId('error-banner');

/** The 3D board comes in its own chunk (GameCanvas): wait until it has mounted. */
const boardMounted = () =>
  vi.waitFor(() => {
    if (!board.onMove) throw new Error('the board has not mounted yet');
  });

beforeEach(() => {
  localStorage.clear();
  board.onMove = null;
});

describe('the error banner', () => {
  it('goes once a later move lands', async () => {
    setStoredRole('abc123', 'white');
    const send = vi.fn(() => true);
    const { rerender } = render(gameScreenAt(fakeSocket(start, send)));
    await boardMounted();
    act(() => board.onMove!(move));
    rerender(gameScreenAt(fakeSocket([...start, wrongTurn], send)));
    expect(banner()).toHaveTextContent('Not your turn');
    // Tried again, and this time it lands: the refusal is over
    act(() => board.onMove!(move));
    rerender(
      gameScreenAt(
        fakeSocket(
          [...start, wrongTurn, { type: 'move_made', by: 'white', from: 'Ba2', to: 'Ca2' }],
          send,
        ),
      ),
    );
    expect(banner()).not.toBeInTheDocument();
    // A presence report is no answer to anything: a new refusal stands through it
    const later: WebSocketMessage[] = [
      ...start,
      wrongTurn,
      { type: 'move_made', by: 'white', from: 'Ba2', to: 'Ca2' },
      wrongTurn,
      { type: 'presence', color: 'black', online: false },
    ];
    rerender(gameScreenAt(fakeSocket(later, send)));
    expect(banner()).toHaveTextContent('Not your turn');
  });

  it('shows a new error after one was dismissed', async () => {
    setStoredRole('abc123', 'white');
    const { rerender } = render(gameScreenAt(fakeSocket(start)));
    rerender(gameScreenAt(fakeSocket([...start, wrongTurn])));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(banner()).not.toBeInTheDocument();
    rerender(gameScreenAt(fakeSocket([...start, wrongTurn, { ...wrongTurn, message: 'Again' }])));
    expect(banner()).toHaveTextContent('Again');
  });

  it("does not carry the side choice's refusals onto the game's page", () => {
    // The creator's first try was refused, the second made the game; the
    // socket's log comes along from /new
    setStoredRole('abc123', 'white');
    const fromSideChoice: WebSocketMessage[] = [
      { type: 'error', code: 'already_in_game', message: 'Already in a game' },
      { type: 'game_created', gameId: 'abc123', color: 'white' },
    ];
    const { rerender } = render(gameScreenAt(fakeSocket(fromSideChoice)));
    expect(screen.getByTestId('invite-card')).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
    // Its own refusals still show
    rerender(
      gameScreenAt(
        fakeSocket([
          ...fromSideChoice,
          { type: 'error', code: 'invalid_message', message: 'Bad request' },
        ]),
      ),
    );
    expect(banner()).toHaveTextContent('Bad request');
  });
});

describe('a refused rejoin', () => {
  it('does not take back the seat the page then joins', async () => {
    // A stale stored seat: its rejoin is refused, the page falls back to the
    // invitation, and the guest takes the free seat
    setStoredRole('abc123', 'white');
    const send = vi.fn(() => true);
    const { rerender } = render(gameScreenAt(fakeSocket([], send)));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'rejoin_game' })),
    );
    const refused: WebSocketMessage[] = [
      { type: 'error', code: 'invalid_rejoin', message: 'No such seat to rejoin' },
    ];
    rerender(gameScreenAt(fakeSocket(refused, send)));
    await waitFor(() => expect(getStoredRole('abc123')).toBeNull());
    const invited: WebSocketMessage[] = [
      ...refused,
      { type: 'game_info', gameId: 'abc123', seats: ['white'] },
    ];
    rerender(gameScreenAt(fakeSocket(invited, send)));
    // The invitation answers; the old refusal no longer stands over it
    expect(banner()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
    // The seat is confirmed, and the game's start follows in its own message
    const joined: WebSocketMessage[] = [...invited, { type: 'game_joined', color: 'black' }];
    rerender(gameScreenAt(fakeSocket(joined, send)));
    await waitFor(() => expect(getStoredRole('abc123')).toBe('black'));
    rerender(gameScreenAt(fakeSocket([...joined, { type: 'game_start', color: 'black' }], send)));
    await boardMounted();
    // Kept for the next visit: the refusal answered the old rejoin, not this seat
    expect(getStoredRole('abc123')).toBe('black');
  });
});
