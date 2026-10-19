import { SHORT_GAME } from '../game/shortGame';
import { createComputer, gameSeed } from './computer';
import type { ThinkReply, ThinkRequest } from './computer';

// The page's own searches, timed (and made to fail once on request), each
// still the real one
const searches = vi.hoisted(() => ({ runs: [] as { start: number; end: number }[], fail: false }));
vi.mock('./choose', async (importOriginal) => {
  const real = await importOriginal<typeof import('./choose')>();
  return {
    ...real,
    chooseMove: (...args: Parameters<typeof real.chooseMove>) => {
      const start = performance.now();
      if (searches.fail) {
        searches.fail = false;
        throw new Error('search failed');
      }
      try {
        return real.chooseMove(...args);
      } finally {
        searches.runs.push({ start, end: performance.now() });
      }
    },
  };
});

afterEach(() => vi.unstubAllGlobals());
// A search that never reached the mock leaves no flag for the next test
beforeEach(() => {
  searches.runs.length = 0;
  searches.fail = false;
});

/** A stand-in Worker: answers each request with a fixed move, or fails to load. */
class FakeWorker {
  static last: FakeWorker | null = null;
  static mode: 'answer' | 'error' | 'fail-load' = 'answer';
  onmessage: ((e: MessageEvent<ThinkReply>) => void) | null = null;
  onerror: ((e: { preventDefault: () => void }) => void) | null = null;
  requests: ThinkRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(request: ThinkRequest) {
    this.requests.push(request);
    queueMicrotask(() => {
      if (FakeWorker.mode === 'fail-load') return this.onerror?.({ preventDefault: () => {} });
      const reply: ThinkReply =
        FakeWorker.mode === 'error'
          ? { id: request.id, error: 'boom' }
          : request.analyse
            ? { id: request.id, analysis: { best: { from: 'Bb1', to: 'Cb1' }, score: 12 } }
            : request.assess
              ? { id: request.id, score: -42 }
              : {
                  id: request.id,
                  move: {
                    move: { from: 'Dc4', to: 'Cc4' },
                    score: 0,
                    depth: 1,
                    nodes: 1,
                    forced: false,
                    obvious: false,
                    ply: request.records.length,
                    tension: 1,
                  },
                };
      this.onmessage?.({ data: reply } as MessageEvent<ThinkReply>);
    });
  }
  terminate() {
    this.terminated = true;
  }
}

it('asks its worker, with the record stripped to plain moves', async () => {
  FakeWorker.mode = 'answer';
  vi.stubGlobal('Worker', FakeWorker);
  const computer = createComputer();
  const move = await computer.think([{ by: 'white', from: 'Bc2', to: 'Cc2' } as never], 'easy');
  expect(move?.move).toEqual({ from: 'Dc4', to: 'Cc4' });
  expect(FakeWorker.last!.requests[0].records).toEqual([{ from: 'Bc2', to: 'Cc2' }]);
  expect(FakeWorker.last!.requests[0].difficulty).toBe('easy');
  expect(FakeWorker.last!.requests[0].game).toBeUndefined();
  computer.dispose();
  expect(FakeWorker.last!.terminated).toBe(true);
});

it('names the game each move is for by a seed of its own, the same all game', async () => {
  FakeWorker.mode = 'answer';
  vi.stubGlobal('Worker', FakeWorker);
  const computer = createComputer();
  await computer.think([], 'medium', 'game-a');
  await computer.think([], 'medium', 'game-a');
  await computer.think([], 'medium', 'game-b');
  const [a, again, b] = FakeWorker.last!.requests.map((r) => r.game);
  expect(a).toBe(gameSeed('game-a'));
  expect(again).toBe(a);
  expect(b).not.toBe(a);
  computer.dispose();
});

it('asks its worker what it makes of a position, or works it out on the page', async () => {
  FakeWorker.mode = 'answer';
  vi.stubGlobal('Worker', FakeWorker);
  const computer = createComputer();
  expect(await computer.assess([{ from: 'Bc2', to: 'Cc2' }])).toBe(-42);
  expect(FakeWorker.last!.requests[0]).toMatchObject({
    assess: true,
    records: [{ from: 'Bc2', to: 'Cc2' }],
  });
  computer.dispose();

  vi.stubGlobal('Worker', undefined);
  const onPage = createComputer();
  expect(typeof (await onPage.assess([]))).toBe('number');
});

it('asks its worker for a position’s best move, or works it out on the page', async () => {
  FakeWorker.mode = 'answer';
  vi.stubGlobal('Worker', FakeWorker);
  const computer = createComputer();
  expect(await computer.analyse([{ from: 'Bc2', to: 'Cc2' }])).toEqual({
    best: { from: 'Bb1', to: 'Cb1' },
    score: 12,
  });
  expect(FakeWorker.last!.requests[0]).toMatchObject({
    analyse: true,
    records: [{ from: 'Bc2', to: 'Cc2' }],
  });
  expect(FakeWorker.last!.requests[0].assess).toBeUndefined();
  expect(FakeWorker.last!.requests[0].depth).toBeUndefined();
  // Searched again deeper, for a mate seen on one side of a move only
  await computer.analyse([{ from: 'Bc2', to: 'Cc2' }], 9);
  expect(FakeWorker.last!.requests[1]).toMatchObject({ analyse: true, depth: 9 });
  computer.dispose();

  vi.stubGlobal('Worker', undefined);
  const onPage = createComputer();
  const mated = SHORT_GAME.map((m) => ({ from: m.slice(0, 3), to: m.slice(4) }));
  expect(await onPage.analyse(mated)).toMatchObject({ best: null });
  expect(await onPage.analyse(mated, 3)).toMatchObject({ best: null });
}, 20_000);

it('passes on a search that failed', async () => {
  FakeWorker.mode = 'error';
  vi.stubGlobal('Worker', FakeWorker);
  const computer = createComputer();
  await expect(computer.think([], 'easy')).rejects.toThrow('boom');
});

it('thinks on the page when the worker cannot load, or there is none', async () => {
  FakeWorker.mode = 'fail-load';
  vi.stubGlobal('Worker', FakeWorker);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const computer = createComputer();
  const move = await computer.think([], 'easy');
  expect(move?.ply).toBe(0);
  expect(FakeWorker.last!.terminated).toBe(true);
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
  // Later questions go straight to the page
  expect((await computer.think([{ from: 'Bc2', to: 'Cc2' }], 'easy'))?.ply).toBe(1);

  vi.stubGlobal('Worker', undefined);
  const noWorker = createComputer();
  expect((await noWorker.think([], 'easy'))?.move).toBeTruthy();
});

it('says so when its worker cannot even be made, and thinks on the page', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('refused');
      }
    },
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const computer = createComputer();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
  expect((await computer.think([], 'easy'))?.ply).toBe(0);
});

it('runs every computer’s searches on the page one at a time, a frame between each', async () => {
  FakeWorker.mode = 'fail-load';
  vi.stubGlobal('Worker', FakeWorker);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  searches.runs = [];
  // A review's computers, each asked while its worker fails
  const moves = await Promise.all([0, 1, 2].map(() => createComputer().think([], 'easy')));
  warn.mockRestore();
  expect(moves.every((m) => m?.move)).toBe(true);
  expect(searches.runs).toHaveLength(3);
  // Each starts a wait for the page to draw after the one before has ended
  for (let i = 1; i < 3; i++)
    expect(searches.runs[i].start - searches.runs[i - 1].end).toBeGreaterThanOrEqual(25);
});

it('a search left waiting by a computer since disposed never runs; the next one does', async () => {
  vi.stubGlobal('Worker', undefined);
  searches.runs = [];
  const left = createComputer();
  const answered = vi.fn();
  left.think([], 'easy').then(answered);
  left.dispose();
  const live = createComputer();
  expect((await live.think([], 'easy'))?.move).toBeTruthy();
  expect(searches.runs).toHaveLength(1);
  expect(answered).not.toHaveBeenCalled();
});

it('a search that fails rejects its own question, and the queue goes on', async () => {
  vi.stubGlobal('Worker', undefined);
  searches.fail = true;
  const computer = createComputer();
  const failed = computer.think([], 'easy');
  const next = computer.think([], 'easy');
  await expect(failed).rejects.toThrow('search failed');
  expect((await next)?.move).toBeTruthy();
});

it('never answers once disposed', async () => {
  vi.stubGlobal('Worker', undefined);
  const computer = createComputer();
  computer.dispose();
  const answered = vi.fn();
  computer.think([], 'easy').then(answered);
  // A live computer asked after it, on the same thread, answers after any
  // answer the disposed one could give (a wait of its own could end first)
  const live = createComputer();
  expect((await live.think([], 'easy'))?.move).toBeTruthy();
  live.dispose();
  expect(answered).not.toHaveBeenCalled();
});
