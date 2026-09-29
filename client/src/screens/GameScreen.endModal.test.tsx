import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketMessage } from '../types/messages';
import { Board } from '../engine';
import { fromZXY } from '../engine/coords';
import { fakeSocket, gameScreenAt } from './testSupport';

// As in App.test.tsx: no WebGL in jsdom, so the three.js layer is stubbed.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/Board', () => ({ default: () => null }));
// The mated king's topple, which the card follows: fired by hand here
const topple = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('../three/toppled', () => ({
  onToppled: (listener: () => void) => {
    topple.listeners.add(listener);
    return () => topple.listeners.delete(listener);
  },
}));
const kingFell = () => topple.listeners.forEach((listener) => listener());

// The showcase game: 17 plies ending in White's mate.
const GAME =
  'Ab2-De5 Ed4-Ba1 Ac2-Cc4 Dc4-Dc3 Ad2-Dd5 Ec4-Dd5 Aa1-Ba1 Dd5-Db3 Cc4-Db3 Db4-Cb4 Ad1-Cd2 Dc3-Cc3 Aa2-Da5 Eb4-Ed2 Da5-Db4 Ed2-Cb2 Db3-Ec4'.split(
    ' ',
  );
const records = GAME.map((m, i) => {
  const [from, to] = m.split('-');
  return { by: i % 2 === 0 ? ('white' as const) : ('black' as const), from, to };
});

const screenFor = (messages: WebSocketMessage[]) => gameScreenAt(fakeSocket(messages));

const beforeMate: WebSocketMessage[] = [
  { type: 'game_start', color: 'white' },
  ...records.slice(0, -1).map((r) => ({ type: 'move_made' as const, ...r })),
];
const mated: WebSocketMessage[] = [
  ...beforeMate,
  { type: 'move_made', ...records[records.length - 1] },
];

const result = () => screen.queryByRole('dialog', { name: 'You win' });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});
afterEach(() => vi.useRealTimers());

describe('the result card after a mate', () => {
  it('turns the turn pill into the result, said to the player', () => {
    const { rerender } = render(screenFor(beforeMate));
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
    rerender(screenFor(mated));
    const pill = screen.getByTestId('turn-indicator');
    expect(pill).toHaveTextContent('Checkmate · you win');
    expect(pill).toHaveAttribute('data-result', 'checkmate');
    expect(pill).toHaveAttribute('data-winner', 'white');
  });

  it('tells the loser plainly, with the winner by colour for screen readers', () => {
    render(screenFor([{ type: 'game_state', color: 'black', started: true, moves: records }]));
    expect(screen.getByRole('dialog', { name: 'You lose' })).toHaveAccessibleDescription(
      'by checkmate',
    );
    expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Checkmate · you lose');
    expect(screen.getByRole('button', { name: 'Start new game' })).toHaveFocus();
  });

  it('waits for the mated king to strike the floor, not for the pulse', () => {
    const { rerender } = render(screenFor(beforeMate));
    rerender(screenFor(mated));
    expect(result()).not.toBeInTheDocument();
    // However long the board takes to topple the king (a slow device)...
    act(() => vi.advanceTimersByTime(8000));
    expect(result()).not.toBeInTheDocument();
    // ...the card follows its signal, on the next frame
    act(() => kingFell());
    act(() => vi.advanceTimersByTime(20));
    expect(result()).toBeInTheDocument();
  });

  it('shows the card anyway if the board never says (its frames stopped)', () => {
    const { rerender } = render(screenFor(beforeMate));
    rerender(screenFor(mated));
    act(() => vi.advanceTimersByTime(11900));
    expect(result()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(result()).toBeInTheDocument();
  });

  it('shows at once when a finished game is reopened', () => {
    render(screenFor([{ type: 'game_state', color: 'white', started: true, moves: records }]));
    expect(result()).toBeInTheDocument();
  });
});

describe('the result card after a stalemate', () => {
  it('follows the last move shortly, once it has landed', () => {
    // A stalemate stood in for: the engine calls White stalemated once Black's
    // unicorn stands on Ba1 (the game's second move)
    const stalemate = vi.spyOn(Board.prototype, 'isStalemate').mockImplementation(function (
      this: Board,
      side,
    ) {
      return side === 'white' && this.getPiece(fromZXY('Ba1'))?.color === 'black';
    });
    const before: WebSocketMessage[] = [
      { type: 'game_start', color: 'white' },
      { type: 'move_made', ...records[0] },
    ];
    const { rerender } = render(screenFor(before));
    rerender(screenFor([...before, { type: 'move_made', ...records[1] }]));
    expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Stalemate · draw');
    const draw = () => screen.queryByRole('dialog', { name: 'Draw' });
    // The move's glide (460 ms) lands first...
    act(() => vi.advanceTimersByTime(500));
    expect(draw()).not.toBeInTheDocument();
    // ...and the card follows at 0.6 s
    act(() => vi.advanceTimersByTime(150));
    expect(draw()).toHaveAccessibleDescription('by stalemate');
    stalemate.mockRestore();
  });
});
