import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import type { Move } from '../engine';
import type { BoardProps } from '../three/Board';
import GameScreen from './GameScreen';

// No WebGL in jsdom: the three.js layer is stubbed, and the board only
// hands over its onMove.
const board = vi.hoisted(() => ({ onMove: null as ((move: Move) => void) | null }));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/Board', () => ({
  default: (props: BoardProps) => {
    board.onMove = props.onMove ?? null;
    return null;
  },
}));

const move: Move = { from: { x: 0, y: 1, z: 1 }, to: { x: 0, y: 1, z: 2 } };

const screenFor = (socket: GameSocket) => (
  <MemoryRouter initialEntries={['/game/abc123']}>
    <Routes>
      <Route path="/game/:gameId" element={<GameScreen gameSocket={socket} />} />
    </Routes>
  </MemoryRouter>
);

const socket = (messages: WebSocketMessage[], send: GameSocket['send']): GameSocket => ({
  send,
  messages,
  status: 'connected',
  sessionId: 1,
  sessionStartIndex: 0,
  reconnect: () => {},
  reset: () => {},
});

beforeEach(() => {
  localStorage.clear();
  board.onMove = null;
});

describe('sending a move', () => {
  it('sends it once, however many times the board asks before the page redraws', () => {
    const send = vi.fn(() => true);
    render(screenFor(socket([{ type: 'game_start', color: 'white' }], send)));
    act(() => {
      board.onMove!(move);
      board.onMove!(move);
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the next move once the first has come back', () => {
    const send = vi.fn(() => true);
    const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(screenFor(socket(start, send)));
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
    rerender(screenFor(socket(later, send)));
    act(() => board.onMove!({ from: { x: 1, y: 1, z: 1 }, to: { x: 1, y: 1, z: 2 } }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('lets the player try again after a refusal', () => {
    const send = vi.fn(() => true);
    const start: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(screenFor(socket(start, send)));
    act(() => board.onMove!(move));
    rerender(
      screenFor(
        socket([...start, { type: 'error', code: 'wrong_turn', message: 'Not your turn' }], send),
      ),
    );
    act(() => board.onMove!(move));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
