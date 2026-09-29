// Runs one workload once, for counting instructions under valgrind:
//   valgrind --tool=cachegrind --cache-sim=no node --single-threaded \
//     node_modules/vite-node/vite-node.mjs bench/count.ts -- --root <dir> --work <name>
// The workload's count is the run's total minus a `--work none` run's.
import { argv } from 'node:process';
import { resolve } from 'node:path';

const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const root = resolve(arg('root', resolve(import.meta.dirname, '..')));
const work = arg('work', 'none');

const { Board } = await import(`${root}/src/engine/board.ts`);
const { deriveHistory } = await import(`${root}/src/game/history.ts`);
const { toZXY } = await import(`${root}/src/engine/coords.ts`);
// Records carry the wire's promotion letter (Q, R, B, N, U), as the server relays them
const { PIECE_TO_PROMOTION } = await import(`${root}/src/engine/pieces.ts`);
const { PieceType } = await import(`${root}/src/engine/pieces.ts`);
const setModule = await import(`${root}/src/three/pieces/set.ts`);
const { pieceSet } = setModule;
const { wholePiece } = await import(`${root}/src/three/scene/occlusion.ts`);

// The same fixture as engine.ts, one game, recorded as a literal so building
// it costs the same in every run
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const game = () => {
  const r = rng(1);
  let b = Board.setupStartingPosition();
  const recs = [];
  const boards = [b];
  for (let i = 0; i < 60; i++) {
    const turn = i % 2 === 0 ? 'white' : 'black';
    const moves = b.generateAllLegalMoves(turn);
    const m = moves[Math.floor(r() * moves.length)];
    recs.push({
      by: turn,
      from: toZXY(m.from),
      to: toZXY(m.to),
      ...(m.promotion ? { promotion: PIECE_TO_PROMOTION[m.promotion] } : {}),
    });
    b = b.applyMove(m);
    boards.push(b);
  }
  return { recs, boards };
};

let sink = 0;
const works: Record<string, () => void> = {
  none: () => {},
  fixture: () => void game(),
  allLegalMoves: () => {
    const { boards } = game();
    boards.forEach((b, i) => (sink += b.generateAllLegalMoves(i % 2 ? 'black' : 'white').length));
  },
  replayIncremental: () => {
    const { recs } = game();
    let prev = null;
    const log: unknown[] = [];
    for (const r of recs) {
      log.push({ type: 'move_made', ...r });
      prev = deriveHistory(log, prev);
    }
  },
  knight: () => void pieceSet('medium')[PieceType.Knight],
  bake: () => {
    for (const t of Object.values(PieceType)) sink += wholePiece(t).attributes.position.count;
  },
  firstBoard: () => {
    for (const t of Object.values(PieceType)) sink += wholePiece(t).attributes.position.count;
  },
};
// The occlusion bake alone: the set is built first (its knight precomputed
// where the checkout ships it), in every run of this work
if (work === 'bake') {
  await setModule.loadBakedKnight?.();
  for (const t of Object.values(PieceType)) void pieceSet('medium')[t];
}
works[work]();
console.log(JSON.stringify({ work, sink }));
