// The page's handle on the computer player. Its search runs in a worker
// (worker.ts), so the board keeps turning and animating while it thinks;
// where a worker can't be had, the search is loaded and run on the page
// instead, a moment later. Either way the search's code is a chunk of its
// own, fetched the first time the computer is asked for a move (or what it
// makes of a position, when a draw is offered to it).

import type { ComputerMove } from './choose';
import type { Difficulty } from './levels';
import type { WireMove } from './position';

export type { ComputerMove };

export interface ThinkRequest {
  id: number;
  records: WireMove[];
  difficulty: Difficulty;
  seed: number;
  /** Asks what the search makes of the position instead of for a move. */
  assess?: boolean;
}

export type ThinkReply =
  | { id: number; move: ComputerMove | null }
  | { id: number; score: number }
  | { id: number; error: string };

export interface Computer {
  /** The computer's move after `records` (null: it has none). */
  think(records: readonly WireMove[], difficulty: Difficulty): Promise<ComputerMove | null>;
  /**
   * What the computer makes of the position after `records`, in centipawns
   * for the side to move (choose.ts, assessPosition).
   */
  assess(records: readonly WireMove[]): Promise<number>;
  /** Stops the worker; answers still pending are never given. */
  dispose(): void;
}

const plain = (records: readonly WireMove[]): WireMove[] =>
  records.map(({ from, to, promotion }) => (promotion ? { from, to, promotion } : { from, to }));

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

type Answer = ComputerMove | null | number;

/** Runs the search on the page's own thread. */
const inline = async (request: ThinkRequest): Promise<Answer> => {
  const { assessPosition, chooseMove } = await import('./choose');
  // Let the page draw the move just made before the thread is taken
  await new Promise((resolve) => setTimeout(resolve, 30));
  return request.assess
    ? assessPosition(request.records)
    : chooseMove(request.records, request.difficulty, request.seed);
};

export function createComputer(): Computer {
  let worker: Worker | null = null;
  let disposed = false;
  let nextId = 1;
  const pending = new Map<
    number,
    { request: ThinkRequest; resolve: (answer: Answer) => void; reject: (e: Error) => void }
  >();

  const fallBack = () => {
    worker?.terminate();
    worker = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      inline(p.request).then(p.resolve, p.reject);
    }
  };

  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ThinkReply>) => {
        const reply = event.data;
        const p = pending.get(reply.id);
        if (!p) return;
        pending.delete(reply.id);
        if ('error' in reply) p.reject(new Error(reply.error));
        else p.resolve('score' in reply ? reply.score : reply.move);
      };
      // The worker's script failed to load or run: think on the page instead
      worker.onerror = (event) => {
        event.preventDefault();
        fallBack();
      };
    }
  } catch {
    worker = null;
  }

  const ask = (records: readonly WireMove[], difficulty: Difficulty, assess: boolean) => {
    if (disposed) return new Promise<Answer>(() => {});
    const request: ThinkRequest = {
      id: nextId++,
      records: plain(records),
      difficulty,
      seed: randomSeed(),
    };
    if (assess) request.assess = true;
    if (!worker) return inline(request);
    return new Promise<Answer>((resolve, reject) => {
      pending.set(request.id, { request, resolve, reject });
      worker!.postMessage(request);
    });
  };

  return {
    think: (records, difficulty) => ask(records, difficulty, false) as Promise<ComputerMove | null>,
    assess: (records) => ask(records, 'hard', true) as Promise<number>,
    dispose() {
      disposed = true;
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
