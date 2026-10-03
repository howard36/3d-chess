// The page's handle on the computer player. Its search runs in a worker
// (worker.ts), so the board keeps turning and animating while it thinks;
// where a worker can't be had, the search is loaded and run on the page
// instead, a moment later. Either way the search's code is a chunk of its
// own, fetched the first time the computer is asked for a move.

import type { ComputerMove } from './choose';
import type { Difficulty } from './levels';
import type { WireMove } from './position';

export type { ComputerMove };

export interface ThinkRequest {
  id: number;
  records: WireMove[];
  difficulty: Difficulty;
  seed: number;
}

export type ThinkReply = { id: number; move: ComputerMove | null } | { id: number; error: string };

export interface Computer {
  /** The computer's move after `records` (null: it has none). */
  think(records: readonly WireMove[], difficulty: Difficulty): Promise<ComputerMove | null>;
  /** Stops the worker; answers still pending are never given. */
  dispose(): void;
}

const plain = (records: readonly WireMove[]): WireMove[] =>
  records.map(({ from, to, promotion }) => (promotion ? { from, to, promotion } : { from, to }));

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Runs the search on the page's own thread. */
const inline = async (request: ThinkRequest): Promise<ComputerMove | null> => {
  const { chooseMove } = await import('./choose');
  // Let the page draw the move just made before the thread is taken
  await new Promise((resolve) => setTimeout(resolve, 30));
  return chooseMove(request.records, request.difficulty, request.seed);
};

export function createComputer(): Computer {
  let worker: Worker | null = null;
  let disposed = false;
  let nextId = 1;
  const pending = new Map<
    number,
    { request: ThinkRequest; resolve: (m: ComputerMove | null) => void; reject: (e: Error) => void }
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
        else p.resolve(reply.move);
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

  return {
    think(records, difficulty) {
      if (disposed) return new Promise(() => {});
      const request: ThinkRequest = {
        id: nextId++,
        records: plain(records),
        difficulty,
        seed: randomSeed(),
      };
      if (!worker) return inline(request);
      return new Promise((resolve, reject) => {
        pending.set(request.id, { request, resolve, reject });
        worker!.postMessage(request);
      });
    },
    dispose() {
      disposed = true;
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
