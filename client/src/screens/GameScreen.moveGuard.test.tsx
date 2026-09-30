import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketMessage } from '../types/messages';
import type { Move } from '../engine';
import type { BoardProps } from '../three/Board';
import { fakeSocket, gameScreenAt } from './testSupport';
import { setStoredRole } from '../lib/playerRole';

// No WebGL in jsdom: the three.js layer is stubbed, and the board only
// hands over its onMove.
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

/** The 3D board comes in its own chunk (GameCanvas): wait until it has mounted. */
const boardMounted = () =>
  vi.waitFor(() => {
    if (!board.onMove) throw new Error('the board has not mounted yet');
  });

beforeEach(() => {
  localStorage.clear();
  // White's player: the seat was stored when the game was created
  setStoredRole('abc123', 'white');
  board.onMove = null;
});

describe('sending a move', () => {
  it('sends it once, however many times the board asks before the page redraws', async () => {
    const send = vi.fn(() => true);
    render(gameScreenAt(fakeSocket([{ type: 'game_start', color: 'white' }], send)));
    await boardMounted();
    act(() => {
      board.onMove!(move);
      board.onMove!(move);
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the next move once the first has come back', async () => {
    const send = vi.fn(() => true);
    const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(gameScreenAt(fakeSocket(start, send)));
    await boardMounted();
    act(() => board.onMove!(move));
    // Still waiting: nothing more is sent
    act(() => board.onMove!(move));
    expect(send).toHaveBeenCalledTimes(1);
    // The echo, and Black's reply
    const later: WebSocketMessage[] = [
      ...start,
      { type: 'move_made', by: 'white', from: 'Ba2', to: 'Ca2' },
      { type: 'move_made', by: 'black', from: 'De5', to: 'Ce5' },
    ];
    rerender(gameScreenAt(fakeSocket(later, send)));
    act(() => board.onMove!({ from: { x: 1, y: 1, z: 1 }, to: { x: 1, y: 1, z: 2 } }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('lets the player try again after a refusal', async () => {
    const send = vi.fn(() => true);
    const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(gameScreenAt(fakeSocket(start, send)));
    await boardMounted();
    act(() => board.onMove!(move));
    rerender(
      gameScreenAt(
        fakeSocket(
          [...start, { type: 'error', code: 'wrong_turn', message: 'Not your turn' }],
          send,
        ),
      ),
    );
    act(() => board.onMove!(move));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
