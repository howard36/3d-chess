import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import classic from '../three/designs/classic';
import type { Design, DesignEntry } from '../three/designs/types';

// As in App.test.tsx: no WebGL in jsdom, so the three.js layer is stubbed.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/DesignStage', () => ({ DesignStage: () => null }));
vi.mock('../three/Board', () => ({ default: () => null }));

// A design that plays out the mate, standing in for the real ones (which
// paint canvas textures at import).
const Celebration = () => null;
const showy: Design = { ...classic, id: 'showy', name: 'Showy', Celebration };
vi.mock('../three/designs/registry', () => ({
  DESIGNS: [
    {
      id: 'classic',
      name: 'Classic',
      blurb: '',
      swatch: ['', '', '', ''],
      load: async () => ({ default: classic }),
    },
    {
      id: 'showy',
      name: 'Showy',
      blurb: '',
      swatch: ['', '', '', ''],
      load: async () => ({ default: showy }),
    },
  ] satisfies DesignEntry[],
}));

const { DesignChoiceProvider } = await import('../three/designs/context');
const { default: GameScreen } = await import('./GameScreen');

// The showcase game: 17 plies ending in White's mate.
const GAME =
  'Bb1-Ee4 Dd5-Aa2 Bc1-Dc3 Dc4-Cc4 Bd1-Ed4 Dc5-Ed4 Aa1-Aa2 Ed4-Cb4 Dc3-Cb4 Db4-Db3 Ad1-Bd3 Cc4-Cc3 Ba1-Ea4 Db5-Bd5 Ea4-Db4 Bd5-Bb3 Cb4-Dc5'.split(
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
  <DesignChoiceProvider>
    <MemoryRouter initialEntries={['/game/abc123']}>
      <Routes>
        <Route path="/game/:gameId" element={<GameScreen gameSocket={socket(messages)} />} />
      </Routes>
    </MemoryRouter>
  </DesignChoiceProvider>
);

const beforeMate: WebSocketMessage[] = [
  { type: 'game_start', color: 'white' },
  ...records.slice(0, -1).map((r) => ({ type: 'move_made' as const, ...r })),
];
const mated: WebSocketMessage[] = [
  ...beforeMate,
  { type: 'move_made', ...records[records.length - 1] },
];

const result = () => screen.queryByRole('dialog', { name: /wins by checkmate/ });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('the result card after a mate', () => {
  it('shows at once in a design without a mate animation', () => {
    const { rerender } = render(screenFor(beforeMate));
    expect(result()).not.toBeInTheDocument();
    rerender(screenFor(mated));
    expect(result()).toBeInTheDocument();
  });

  it('waits for a design to play the mate out, when it was just played', async () => {
    window.history.replaceState({}, '', '/?design=showy');
    const { rerender } = render(screenFor(beforeMate));
    await act(async () => {}); // the design's chunk arrives
    rerender(screenFor(mated));
    expect(result()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(result()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(result()).toBeInTheDocument();
  });

  it('shows at once when a finished game is reopened', async () => {
    window.history.replaceState({}, '', '/?design=showy');
    render(screenFor([{ type: 'game_state', color: 'white', started: true, moves: records }]));
    await act(async () => {});
    expect(result()).toBeInTheDocument();
  });
});
