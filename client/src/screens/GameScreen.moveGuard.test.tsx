import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketMessage } from '../types/messages';
import type { Move } from '../engine';
import type { BoardProps } from '../three/Board';
import { fakeSocket, gameScreenAt } from './testSupport';

// No WebGL in jsdom: the three.js layer is stubbed, and the board only
// hands over its onMove.
const board = vi.hoisted(() => ({ onMove: null as ((move: Move) => void) | null }));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
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

beforeEach(() => {
  localStorage.clear();
  board.onMove = null;
});

describe('sending a move', () => {
  it('sends it once, however many times the board asks before the page redraws', () => {
    const send = vi.fn(() => true);
    render(gameScreenAt(fakeSocket([{ type: 'game_start', color: 'white' }], send)));
    act(() => {
      board.onMove!(move);
      board.onMove!(move);
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the next move once the first has come back', () => {
    const send = vi.fn(() => true);
    const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(gameScreenAt(fakeSocket(start, send)));
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

  it('lets the player try again after a refusal', () => {
    const send = vi.fn(() => true);
    const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(gameScreenAt(fakeSocket(start, send)));
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
