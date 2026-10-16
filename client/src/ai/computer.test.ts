import { SHORT_GAME } from '../game/shortGame';
import { createComputer } from './computer';
import type { ThinkReply, ThinkRequest } from './computer';

afterEach(() => vi.unstubAllGlobals());

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
  computer.dispose();
  expect(FakeWorker.last!.terminated).toBe(true);
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
  computer.dispose();

  vi.stubGlobal('Worker', undefined);
  const onPage = createComputer();
  const mated = SHORT_GAME.map((m) => ({ from: m.slice(0, 3), to: m.slice(4) }));
  expect(await onPage.analyse(mated)).toMatchObject({ best: null });
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

it('runs every computer’s searches on the page one at a time, a frame between each', async () => {
  FakeWorker.mode = 'fail-load';
  vi.stubGlobal('Worker', FakeWorker);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // A review's computers, each asked while its worker fails
  const answered: number[] = [];
  await Promise.all(
    [0, 1, 2].map(() =>
      createComputer()
        .think([], 'easy')
        .then(() => answered.push(performance.now())),
    ),
  );
  warn.mockRestore();
  expect(answered).toHaveLength(3);
  // Each waits for the page to draw after the one before
  for (let i = 1; i < 3; i++) expect(answered[i] - answered[i - 1]).toBeGreaterThanOrEqual(25);
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
