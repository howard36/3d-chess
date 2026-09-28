import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import { forgetSettings, setSetting } from '../three/settings';
import GameScreen from './GameScreen';

// As in App.test.tsx: no WebGL in jsdom, so the three.js layer is stubbed.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/Board', () => ({ default: () => null }));

// The showcase game: 17 plies ending in White's mate.
const GAME =
  'Ab2-De5 Ed4-Ba1 Ac2-Cc4 Dc4-Dc3 Ad2-Dd5 Ec4-Dd5 Aa1-Ba1 Dd5-Db3 Cc4-Db3 Db4-Cb4 Ad1-Cd2 Dc3-Cc3 Aa2-Da5 Eb4-Ed2 Da5-Db4 Ed2-Cb2 Db3-Ec4'.split(
    ' ',
  );
const records = GAME.map((m, i) => {
  const [from, to] = m.split('-');
  return { by: i % 2 === 0 ? ('white' as const) : ('black' as const), from, to };
});

const socket = (messages: WebSocketMessage[]): GameSocket => ({
  send: () => true,
  messages,
  status: 'connected',
  sessionId: 1,
  sessionStartIndex: 0,
  reconnect: () => {},
  reset: () => {},
});

const screenFor = (messages: WebSocketMessage[]) => (
  <MemoryRouter initialEntries={['/game/abc123']}>
    <Routes>
      <Route path="/game/:gameId" element={<GameScreen gameSocket={socket(messages)} />} />
    </Routes>
  </MemoryRouter>
);

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
  forgetSettings();
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

  it('waits for the mate to play out, when it was just played', () => {
    // The mate's pulse crosses the board in 2.4 s by default, and a beat more
    const { rerender } = render(screenFor(beforeMate));
    rerender(screenFor(mated));
    expect(result()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2600));
    expect(result()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(result()).toBeInTheDocument();
  });

  it('waits as long as the player’s settings make the mate', () => {
    setSetting('mark.mateSeconds', 3.5);
    const { rerender } = render(screenFor(beforeMate));
    rerender(screenFor(mated));
    act(() => vi.advanceTimersByTime(3700));
    expect(result()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(result()).toBeInTheDocument();
  });

  it('shows at once when a finished game is reopened', () => {
    render(screenFor([{ type: 'game_state', color: 'white', started: true, moves: records }]));
    expect(result()).toBeInTheDocument();
  });
});
