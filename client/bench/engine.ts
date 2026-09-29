// Engine benchmark: the rules engine on the paths the app runs.
// Usage: npx vite-node bench/engine.ts -- --root <client dir> [--reps N]
// --root lets the same harness time another checkout (the base worktree).
import { argv } from 'node:process';
import { resolve } from 'node:path';

const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const root = resolve(arg('root', resolve(import.meta.dirname, '..')));
const reps = Number(arg('reps', '7'));

const { Board } = await import(`${root}/src/engine/board.ts`);
const { deriveHistory } = await import(`${root}/src/game/history.ts`);
const { toZXY } = await import(`${root}/src/engine/coords.ts`);

// A deterministic random game: mulberry32, uniform over legal moves.
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type Rec = { by: 'white' | 'black'; from: string; to: string; promotion?: string };
const playGame = (seed: number, plies: number) => {
  const r = rng(seed);
  let b = Board.setupStartingPosition();
  const recs: Rec[] = [];
  const boards = [b];
  for (let i = 0; i < plies; i++) {
    const turn = i % 2 === 0 ? 'white' : 'black';
    const moves = b.generateAllLegalMoves(turn);
    if (moves.length === 0) break;
    const m = moves[Math.floor(r() * moves.length)];
    recs.push({
      by: turn,
      from: toZXY(m.from),
      to: toZXY(m.to),
      ...(m.promotion ? { promotion: m.promotion } : {}),
    });
    b = b.applyMove(m);
    boards.push(b);
  }
  return { recs, boards };
};
// Fixed fixtures, generated once per process (not timed)
const games = [1, 2, 3, 4].map((s) => playGame(s, 160));
const positions = games.flatMap((g) => g.boards);

const time = (fn: () => void) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const results: Record<string, number[]> = {};
const run = (name: string, fn: () => void) => {
  fn(); // warm
  const xs: number[] = [];
  for (let i = 0; i < reps; i++) xs.push(time(fn));
  results[name] = xs;
};

let sink = 0;
// E1: every legal move of the side to move, in every position (status checks, typed moves)
run('allLegalMoves', () => {
  for (let i = 0; i < positions.length; i++)
    sink += positions[i].generateAllLegalMoves((i % 161) % 2 === 0 ? 'white' : 'black').length;
});
// E2: the per-move status the app computes: check, mate, stalemate
run('status', () => {
  for (let i = 0; i < positions.length; i++) {
    const turn = (i % 161) % 2 === 0 ? 'white' : 'black';
    const b = positions[i];
    sink += b.inCheck(turn) ? 1 : 0;
    sink += b.isCheckmate(turn) ? 1 : 0;
    sink += b.isStalemate(turn) ? 1 : 0;
  }
});
// E3: a whole game arriving move by move (deriveHistory with prev, as GameScreen calls it)
run('replayIncremental', () => {
  for (const g of games) {
    let prev = null;
    const log: unknown[] = [];
    for (const r of g.recs) {
      log.push({ type: 'move_made', ...r });
      prev = deriveHistory(log, prev);
    }
    sink += prev.appliedMoveCount;
  }
});
// E4: a rejoin: the full record in one game_state snapshot
run('replaySnapshot', () => {
  for (const g of games) {
    const h = deriveHistory([{ type: 'game_state', started: true, moves: g.recs }]);
    sink += h.appliedMoveCount;
  }
});

const out = Object.fromEntries(
  Object.entries(results).map(([k, xs]) => [
    k,
    {
      median: +median(xs).toFixed(2),
      min: +Math.min(...xs).toFixed(2),
      max: +Math.max(...xs).toFixed(2),
    },
  ]),
);
console.log(
  JSON.stringify({
    bench: 'engine',
    root,
    positions: positions.length,
    plies: games.map((g) => g.recs.length),
    results: out,
    sink,
  }),
);
