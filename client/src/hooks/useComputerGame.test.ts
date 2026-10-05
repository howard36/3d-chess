import { act, renderHook, waitFor } from '@testing-library/react';
import { useComputerGame } from './useComputerGame';
import type { ComputerGameOptions } from './useComputerGame';
import { loadComputerGame, saveComputerGame } from '../lib/computerGames';
import type { Computer, ComputerMove } from '../ai/computer';
import type { Color } from '../types/messages';

afterEach(() => localStorage.clear());

const reply = (from: string, to: string): ComputerMove => ({
  move: { from, to },
  score: 0,
  depth: 1,
  nodes: 1,
  forced: false,
  obvious: false,
  ply: 0,
});

/** A computer that answers from a script, recording what it was asked. */
const scripted = (answers: (ComputerMove | null | 'fail')[]) => {
  const asked: number[] = [];
  let disposed = false;
  const computer: Computer = {
    think: (records) => {
      asked.push(records.length);
      const a = answers.shift();
      return a === 'fail' ? Promise.reject(new Error('no')) : Promise.resolve(a ?? null);
    },
    dispose: () => {
      disposed = true;
    },
  };
  return { computer: () => computer, asked, disposed: () => disposed };
};

const newGame = (color: Color, id = 'g1') =>
  saveComputerGame({ id, color, difficulty: 'easy', started: false, moves: [] });

const options = (computer: () => Computer): ComputerGameOptions => ({
  computer,
  pace: () => 0,
});

it('opens holding the seat, the computer seated at once, and answers like a server', async () => {
  newGame('white');
  const ai = scripted([reply('Dc4', 'Cc4')]);
  const { result, unmount } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  expect(result.current.status).toBe('connected');
  expect(result.current.sessionId).toBe(1);
  // From the first render, as a rejoin's answer: the page never draws a
  // moment without its seat (and so without its lobby or its board)
  expect(result.current.messages).toEqual([
    { type: 'game_state', color: 'white', started: false, moves: [] },
    { type: 'game_start', color: 'white' },
  ]);
  expect(loadComputerGame('g1')!.started).toBe(true);
  act(() => {
    result.current.send({ type: 'move', from: 'Bc2', to: 'Cc2' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  expect(result.current.messages.slice(2)).toEqual([
    { type: 'move_made', by: 'white', from: 'Bc2', to: 'Cc2' },
    { type: 'move_made', by: 'black', from: 'Dc4', to: 'Cc4' },
  ]);
  expect(ai.asked).toEqual([1]);
  // Kept in the browser, move by move
  expect(loadComputerGame('g1')!.moves).toHaveLength(2);
  unmount();
  expect(ai.disposed()).toBe(true);
});

it('moves first playing White, and comes back to the game after a reload', async () => {
  newGame('black');
  const ai = scripted([reply('Bc2', 'Cc2')]);
  const first = renderHook(() => useComputerGame('g1', options(ai.computer)));
  await waitFor(() => expect(first.result.current.messages).toHaveLength(3));
  expect(first.result.current.messages[2]).toMatchObject({ by: 'white', from: 'Bc2' });
  first.unmount();

  // A reload: the stored game comes back under way, with its move
  const again = renderHook(() => useComputerGame('g1', options(scripted([]).computer)));
  expect(again.result.current.messages).toEqual([
    {
      type: 'game_state',
      color: 'black',
      started: true,
      moves: [{ by: 'white', from: 'Bc2', to: 'Cc2' }],
    },
  ]);
  // A rejoin is answered the same way
  act(() => {
    again.result.current.send({ type: 'rejoin_game', gameId: 'g1', color: 'black' });
  });
  expect(again.result.current.messages[1]).toMatchObject({ type: 'game_state', started: true });
});

it('holds its move while asked to', async () => {
  newGame('black');
  const ai = scripted([reply('Bc2', 'Cc2')]);
  const { result, rerender } = renderHook(
    ({ hold }) => useComputerGame('g1', { ...options(ai.computer), hold }),
    { initialProps: { hold: true } },
  );
  await new Promise((r) => setTimeout(r, 30));
  expect(ai.asked).toEqual([]);
  expect(result.current.messages).toHaveLength(2);
  rerender({ hold: false });
  await waitFor(() => expect(result.current.messages).toHaveLength(3));
  expect(ai.asked).toEqual([0]);
});

it('plays a legal move of its own when its search fails or answers nothing', async () => {
  for (const answer of ['fail', null] as const) {
    localStorage.clear();
    newGame('black', 'g2');
    const ai = scripted([answer]);
    const { result, unmount } = renderHook(() => useComputerGame('g2', options(ai.computer)));
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages[2]).toMatchObject({ type: 'move_made', by: 'white' });
    unmount();
  }
});

it('waits out the computer’s thinking time before its move lands', async () => {
  vi.useFakeTimers();
  try {
    newGame('black');
    const ai = scripted([reply('Bc2', 'Cc2')]);
    const { result } = renderHook(() =>
      useComputerGame('g1', { computer: ai.computer, pace: () => 1500 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.messages.map((m) => m.type)).toEqual(['game_state', 'game_start']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.messages).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});

it('refuses for a game it does not hold', () => {
  const { result } = renderHook(() => useComputerGame('nope', options(scripted([]).computer)));
  expect(result.current.messages).toEqual([]);
  act(() => {
    result.current.send({ type: 'look_game', gameId: 'nope' });
  });
  expect(result.current.messages[0]).toMatchObject({ type: 'error', code: 'invalid_game' });
  // The connection's controls do nothing: there is no connection
  result.current.reconnect();
  result.current.reset();
  expect(result.current.messages).toHaveLength(1);
});
