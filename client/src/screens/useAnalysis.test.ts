import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Computer, PositionAnalysis } from '../ai/computer';
import type { WireMove } from '../ai/position';
import { evaluationText } from '../game/analysis';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';
import type { MoveRecord, WebSocketMessage } from '../types/messages';
import { useAnalysis } from './useAnalysis';

// The review searches each position in the computer's worker: stood in for
// here by a computer whose answers the test hands out one at a time
const worker = vi.hoisted(() => ({
  asked: [] as number[],
  depths: [] as (number | undefined)[],
  answers: [] as ((a: PositionAnalysis | Error) => void)[],
  made: 0,
  disposed: 0,
  fails: false,
}));
vi.mock('../ai/computer', () => ({
  createComputer: (): Computer => {
    if (worker.fails) throw new Error('chunk');
    worker.made++;
    return {
      think: () => Promise.resolve(null),
      assess: () => Promise.resolve(0),
      analyse: (records: readonly WireMove[], depth?: number) => {
        worker.asked.push(records.length);
        worker.depths.push(depth);
        return new Promise((resolve, reject) =>
          worker.answers.push((a) => (a instanceof Error ? reject(a) : resolve(a))),
        );
      },
      dispose: () => {
        worker.disposed++;
      },
    };
  },
}));

beforeEach(() => {
  worker.asked.length = 0;
  worker.depths.length = 0;
  worker.answers.length = 0;
  worker.made = 0;
  worker.disposed = 0;
  worker.fails = false;
  cores(2);
});
afterEach(() => vi.restoreAllMocks());

/** The machine's cores, which set how many workers a review takes (one fewer, at most 3). */
const cores = (n: number) =>
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: n, configurable: true });
// A browser with workers (jsdom has none): the review's computers are stood in for above
beforeEach(() => vi.stubGlobal('Worker', class {}));
afterEach(() => vi.unstubAllGlobals());

const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1']; // Black mates
const historyOf = (moves: string[], resigned = false): GameHistory => {
  const records = moves.map(
    (m, i) =>
      ({ by: i % 2 ? 'black' : 'white', from: m.slice(0, 3), to: m.slice(4) }) as MoveRecord,
  );
  const messages: WebSocketMessage[] = [
    { type: 'game_state', color: 'white', started: true, moves: records } as WebSocketMessage,
  ];
  const history = deriveHistory(messages);
  return resigned ? { ...history, gameOver: { result: 'resignation', winner: 'black' } } : history;
};

const at = (score: number, from: string, to: string): PositionAnalysis => ({
  best: { from, to },
  score,
});

/** Hands the oldest question its answer, and lets the hook take it. */
const answer = async (a: PositionAnalysis | Error) => {
  await act(async () => {
    worker.answers.shift()!(a);
  });
};

it('waits to be asked, then searches each position in turn, marks coming in as they are done', async () => {
  const { result } = renderHook(() => useAnalysis(historyOf(MATE)));
  expect(result.current.state).toBe('idle');
  expect(result.current.total).toBe(5);
  expect(worker.made).toBe(0);

  act(() => result.current.start());
  expect(result.current.state).toBe('running');
  await act(async () => {});
  expect(worker.asked).toEqual([0]);
  // The mate the game ended in, counted from the start: it needs no search
  expect(result.current.done).toBe(1);
  await answer(at(40, 'Ad1', 'Cc1'));
  expect(result.current.done).toBe(2);
  // One for each position, those still to come undefined
  expect(result.current.evaluations).toEqual([
    { score: 40, chances: expect.any(Number) },
    undefined,
    undefined,
    undefined,
    { score: 0, mate: 0, chances: -1 },
  ]);
  expect(result.current.grades).toEqual([undefined, undefined, undefined, undefined]);
  await answer(at(11, 'Ed5', 'Cc5'));
  // The first move, a little off the best: no mark
  expect(result.current.grades[0]).toBeNull();
  await answer(at(1050, 'Bc1', 'Cc2'));
  expect(result.current.grades[1]).toBe('blunder');
  await answer({ best: { from: 'Cc2', to: 'Bb1' }, score: 30999, mate: 1 });
  // White's move walked into a mate the position before it was not seen to
  // hold: that position searched again, deep enough to see it, before the mark
  expect(worker.asked).toEqual([0, 1, 2, 3, 2]);
  expect(worker.depths).toEqual([undefined, undefined, undefined, undefined, 3]);
  expect(result.current.grades[2]).toBeUndefined();
  expect([result.current.done, result.current.total]).toEqual([5, 6]);
  expect(result.current.state).toBe('running');
  await answer(at(1050, 'Bc1', 'Cc2'));
  expect(result.current.grades[2]).toBe('blunder');
  // The mate the game ended in needs no search
  expect(result.current.state).toBe('done');
  expect(result.current.done).toBe(6);
  expect(result.current.grades[3]).toBeNull();
  expect(result.current.counts.white.blunder).toBe(1);
  expect(result.current.counts.black.blunder).toBe(1);
  // Each position from White's side, the mate the game ended in its result
  expect(result.current.evaluations.map((e) => e && evaluationText(e))).toEqual([
    '+0.4',
    '\u22120.1',
    '+10.5',
    '\u2212M1',
    '0–1',
  ]);
  expect(worker.disposed).toBe(1);
  // Asked again, nothing more is searched
  act(() => result.current.start());
  await act(async () => {});
  expect(worker.made).toBe(1);
  expect(worker.asked).toEqual([0, 1, 2, 3, 2]);
  expect(result.current.state).toBe('done');
  expect(result.current.done).toBe(6);
});

it('searches in several workers at once, the marks the same whatever order they finish in', async () => {
  cores(8);
  const { result } = renderHook(() => useAnalysis(historyOf(MATE.slice(0, 3), true)));
  act(() => result.current.start());
  await act(async () => {});
  // Three workers (one core left to the page), the positions handed out from the start
  expect(worker.made).toBe(3);
  expect(worker.asked).toEqual([0, 1, 2]);
  const [first, second, third] = worker.answers.splice(0);
  await act(async () => third(at(1050, 'Bc1', 'Cc2')));
  // The worker done first takes the next position
  expect(worker.asked).toEqual([0, 1, 2, 3]);
  await act(async () => first(at(40, 'Ad1', 'Cc1')));
  await act(async () =>
    worker.answers.shift()!({ best: { from: 'Cc2', to: 'Bb1' }, score: 30999, mate: 1 }),
  );
  // The third move's recheck (see above), taken by the worker that found it needed
  expect(worker.asked).toEqual([0, 1, 2, 3, 2]);
  expect(result.current.grades).toEqual([undefined, undefined, undefined]);
  await act(async () => second(at(11, 'Ed5', 'Cc5')));
  expect(result.current.state).toBe('running');
  expect(result.current.grades).toEqual([null, 'blunder', undefined]);
  await answer(at(1050, 'Bc1', 'Cc2'));
  expect(result.current.state).toBe('done');
  expect(result.current.done).toBe(5);
  expect(result.current.grades).toEqual([null, 'blunder', 'blunder']);
  expect(worker.disposed).toBe(3);
});

it('searches the last position too, of a game the players ended', async () => {
  const { result } = renderHook(() => useAnalysis(historyOf(MATE.slice(0, 2), true)));
  act(() => result.current.start());
  for (const score of [40, 11, 1050]) {
    await act(async () => {});
    await answer(at(score, 'Bc1', 'Cc2'));
  }
  expect(worker.asked).toEqual([0, 1, 2]);
  expect(result.current.state).toBe('done');
});

it('says where a search fails, and asked again goes on from the positions it has', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderHook(() => useAnalysis(historyOf(MATE)));
  act(() => result.current.start());
  await act(async () => {});
  await answer(at(40, 'Ad1', 'Cc1'));
  await answer(new Error('no'));
  expect(result.current.state).toBe('stopped');
  expect(result.current.done).toBe(2);
  expect(worker.disposed).toBe(1);
  expect(warn).toHaveBeenCalledWith('The review stopped short.', new Error('no'));

  act(() => result.current.start());
  await act(async () => {});
  expect(result.current.state).toBe('running');
  // Not the start again: the second position, which failed
  expect(worker.asked).toEqual([0, 1, 1]);
  await answer(at(11, 'Ed5', 'Cc5'));
  await answer(at(1050, 'Bc1', 'Cc2'));
  await answer({ best: { from: 'Cc2', to: 'Bb1' }, score: 30999, mate: 1 });
  await answer(at(1050, 'Bc1', 'Cc2'));
  expect(result.current.state).toBe('done');
  expect(result.current.grades).toEqual([null, 'blunder', 'blunder', null]);
});

const mate = (plies: number, from: string, to: string): PositionAnalysis => ({
  best: { from, to },
  score: plies > 0 ? 31000 - plies : -31000 - plies,
  mate: plies,
});

it('searches a position again deeper where a move’s positions disagree on a mate', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderHook(() => useAnalysis(historyOf(MATE)));
  act(() => result.current.start());
  await act(async () => {});
  await answer(at(40, 'Ad1', 'Cc1'));
  // Black mates in 3 after White's first move: the position before it
  // searched again, past where that mate would be, and found level still
  await answer(mate(3, 'Ec4', 'Cb2'));
  expect(worker.asked).toEqual([0, 1, 0]);
  expect(worker.depths[2]).toBe(5);
  expect(result.current.grades[0]).toBeUndefined();
  await answer(at(40, 'Ad1', 'Cc1'));
  expect(result.current.grades[0]).toBe('blunder');
  // After Black's move nothing is seen: the position after searched again
  await answer(at(-1100, 'Ac2', 'Ad1'));
  expect(worker.asked).toEqual([0, 1, 0, 2, 2]);
  expect(worker.depths[4]).toBe(5);
  expect(result.current.grades).toEqual(['blunder', undefined, undefined, undefined]);
  // A slower mate, not one let go
  await answer(mate(-4, 'Ac2', 'Ad1'));
  expect(result.current.grades[1]).toBeNull();
  // White then walks into Black's mate in 1: the position before it searched
  // again for that move too
  await answer(mate(1, 'Cc2', 'Bb1'));
  expect(worker.asked).toEqual([0, 1, 0, 2, 2, 3, 2]);
  expect(worker.depths[6]).toBe(3);
  await answer(new Error('no'));
  expect(result.current.state).toBe('stopped');
  expect([result.current.done, result.current.total]).toEqual([7, 8]);

  // Asked again, it goes on from the recheck still to do
  act(() => result.current.start());
  await act(async () => {});
  expect(worker.asked).toEqual([0, 1, 0, 2, 2, 3, 2, 2]);
  expect(worker.depths[7]).toBe(3);
  await answer(mate(-2, 'Ac2', 'Ad1'));
  expect(result.current.state).toBe('done');
  expect(result.current.done).toBe(8);
  // Mated whatever White played: no mark
  expect(result.current.grades).toEqual(['blunder', null, null, null]);
  expect(result.current.rechecks).toEqual([
    at(40, 'Ad1', 'Cc1'),
    mate(-4, 'Ac2', 'Ad1'),
    mate(-2, 'Ac2', 'Ad1'),
  ]);
});

it('stays stopped when a search still under way finishes after another failed', async () => {
  // As on the page itself (no worker), where disposing cannot stop a search
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  cores(8);
  const { result } = renderHook(() => useAnalysis(historyOf(MATE)));
  act(() => result.current.start());
  await act(async () => {});
  const [first, second] = worker.answers.splice(0);
  await act(async () => first(new Error('no')));
  await act(async () => second(at(11, 'Ed5', 'Cc5')));
  expect(result.current.state).toBe('stopped');
  expect(worker.asked).toEqual([0, 1, 2]);
});

it('searches one position at a time on the page itself, where there are no workers', async () => {
  vi.stubGlobal('Worker', undefined);
  cores(8);
  const { result } = renderHook(() => useAnalysis(historyOf(MATE)));
  act(() => result.current.start());
  await act(async () => {});
  expect(worker.made).toBe(1);
  expect(worker.asked).toEqual([0]);
});

it('can be asked again when the computer could not be had', async () => {
  worker.fails = true;
  const { result } = renderHook(() => useAnalysis(historyOf(MATE)));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  act(() => result.current.start());
  await act(async () => {});
  expect(result.current.state).toBe('stopped');
  worker.fails = false;
  act(() => result.current.start());
  await act(async () => {});
  expect(result.current.state).toBe('running');
  expect(worker.asked).toEqual([0]);
});

it('is not asked for while the game is on', () => {
  const { result } = renderHook(() => useAnalysis(historyOf(MATE.slice(0, 2))));
  act(() => result.current.start());
  expect(result.current.state).toBe('idle');
  expect(worker.made).toBe(0);
});

it('stops the work when the page goes, or for another game', async () => {
  const { result, rerender, unmount } = renderHook(({ h }) => useAnalysis(h), {
    initialProps: { h: historyOf(MATE) },
  });
  act(() => result.current.start());
  await act(async () => {});
  rerender({ h: historyOf(MATE.slice(0, 2), true) });
  expect(worker.disposed).toBe(1);
  expect(result.current.state).toBe('idle');
  // The old game's answer lands nowhere
  await answer(at(40, 'Ad1', 'Cc1'));
  expect(result.current.done).toBe(0);
  expect(worker.asked).toEqual([0]);

  act(() => result.current.start());
  await act(async () => {});
  unmount();
  expect(worker.disposed).toBe(2);
});
