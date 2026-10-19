// The page's handle on the computer player. Its search runs in a worker
// (worker.ts), so the board keeps turning and animating while it thinks;
// where a worker can't be had, the search is loaded and run on the page
// instead, a moment later. Either way the search's code is a chunk of its
// own, fetched the first time the computer is asked for a move (or what it
// makes of a position, when a draw is offered to it or a finished game is
// reviewed).

import type { ComputerMove, PositionAnalysis } from './choose';
import type { Difficulty } from './levels';
import type { WireMove } from './position';
import { cachedImport } from '../lib/cachedImport';

export type { ComputerMove, PositionAnalysis };

export interface ThinkRequest {
  id: number;
  records: WireMove[];
  difficulty: Difficulty;
  seed: number;
  /** Asks what the search makes of the position instead of for a move. */
  assess?: boolean;
  /** Asks for the position's best move and its worth, for a review of the game. */
  analyse?: boolean;
  /** With `analyse`: searched again this many plies deep (choose.ts, recheckPosition). */
  depth?: number;
}

export type ThinkReply =
  | { id: number; move: ComputerMove | null }
  | { id: number; score: number }
  | { id: number; analysis: PositionAnalysis }
  | { id: number; error: string };

export interface Computer {
  /** The computer's move after `records` (null: it has none). */
  think(records: readonly WireMove[], difficulty: Difficulty): Promise<ComputerMove | null>;
  /**
   * What the computer makes of the position after `records`, in centipawns
   * for the side to move (choose.ts, assessPosition).
   */
  assess(records: readonly WireMove[]): Promise<number>;
  /**
   * The best move after `records` and what it is worth (choose.ts,
   * analysePosition): one position of a finished game's review. With
   * `depth`, the position searched again that deep (recheckPosition).
   */
  analyse(records: readonly WireMove[], depth?: number): Promise<PositionAnalysis>;
  /** Stops the worker; answers still pending are never given. */
  dispose(): void;
}

const plain = (records: readonly WireMove[]): WireMove[] =>
  records.map(({ from, to, promotion }) => (promotion ? { from, to, promotion } : { from, to }));

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

type Answer = ComputerMove | null | number | PositionAnalysis;

/**
 * The search's code on the page. A load that fails (a page from before a
 * deploy, whose chunk has gone; no network) is a ChunkLoadError, told apart
 * from a search that failed.
 */
const loadSearch = cachedImport(() => import('./choose'));

/** The searches run on the page, every computer's, one after another. */
let onPage: Promise<unknown> = Promise.resolve();

/** What a search left in the queue by a computer since disposed comes to: nothing. */
const DROPPED = Symbol('dropped');

/**
 * Runs the search on the page's own thread, after any other computer's
 * (a review's several, whose worker failed, would otherwise take the thread
 * in turn with no frame between them). A search whose computer was disposed
 * while it waited (a review left) never runs, and is never answered.
 */
const inline = (request: ThinkRequest, wanted: () => boolean): Promise<Answer> => {
  const run = onPage.then(async () => {
    const { analysePosition, assessPosition, chooseMove, recheckPosition } = await loadSearch();
    // Let the page draw the move just made before the thread is taken
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (!wanted()) return DROPPED;
    if (request.analyse) {
      return request.depth
        ? recheckPosition(request.records, request.depth)
        : analysePosition(request.records);
    }
    return request.assess
      ? assessPosition(request.records)
      : chooseMove(request.records, request.difficulty, request.seed);
  });
  onPage = run.catch(() => {});
  return run.then((answer) => (answer === DROPPED ? new Promise<Answer>(() => {}) : answer));
};

export function createComputer(): Computer {
  let worker: Worker | null = null;
  let disposed = false;
  const wanted = () => !disposed;
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
      inline(p.request, wanted).then(p.resolve, p.reject);
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
        else if ('analysis' in reply) p.resolve(reply.analysis);
        else p.resolve('score' in reply ? reply.score : reply.move);
      };
      // The worker's script failed to load or run: think on the page instead
      worker.onerror = (event) => {
        event.preventDefault();
        console.warn('The computer’s worker failed; it thinks on the page instead.', event.message);
        fallBack();
      };
    }
  } catch (cause) {
    // (a page whose policy or bundling refuses the worker)
    console.warn('The computer’s worker could not start; it thinks on the page instead.', cause);
    worker = null;
  }

  type Kind = 'think' | 'assess' | 'analyse';
  const ask = (
    records: readonly WireMove[],
    difficulty: Difficulty,
    kind: Kind,
    depth?: number,
  ) => {
    if (disposed) return new Promise<Answer>(() => {});
    const request: ThinkRequest = {
      id: nextId++,
      records: plain(records),
      difficulty,
      seed: randomSeed(),
    };
    if (kind === 'assess') request.assess = true;
    if (kind === 'analyse') request.analyse = true;
    if (depth) request.depth = depth;
    if (!worker) return inline(request, wanted);
    return new Promise<Answer>((resolve, reject) => {
      pending.set(request.id, { request, resolve, reject });
      worker!.postMessage(request);
    });
  };

  return {
    think: (records, difficulty) =>
      ask(records, difficulty, 'think') as Promise<ComputerMove | null>,
    assess: (records) => ask(records, 'hard', 'assess') as Promise<number>,
    analyse: (records, depth) =>
      ask(records, 'hard', 'analyse', depth) as Promise<PositionAnalysis>,
    dispose() {
      disposed = true;
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
