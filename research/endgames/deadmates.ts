// Which endings of king and pieces against a bare king have a checkmate
// position at all, on this 5×5×5 board: every placement of the four or five
// men is tried, the bare king to move, and counted as mate when it is in
// check with no legal move. An ending with none can never be won, however
// either side plays, and draws as soon as it stands (engine/draws.ts,
// insufficientMaterial). The moves are the engine's own vectors; one mate in
// fifty found in the endings that have them, and 20,000 random positions of
// the endings that have none, are checked against the engine's isCheckmate.
// About 13 minutes on one core; it exits non-zero if a dead ending has a mate.
//
// usage (bundled as research/levels/match.ts is): node deadmates.mjs
import { createHash } from 'node:crypto';
import { Board } from '../../client/src/engine/board';
import {
  BISHOP_VECTORS,
  KING_VECTORS,
  KNIGHT_VECTORS,
  PieceType,
  ROOK_VECTORS,
  UNICORN_VECTORS,
} from '../../client/src/engine/pieces';

const N = 5;
const S = N * N * N;
type Vec = readonly [number, number, number];
const at = (z: number, x: number, y: number) => (z * N + x) * N + y;
const zxy = (s: number): Vec => [Math.floor(s / 25), Math.floor(s / 5) % 5, s % 5];
const inside = (z: number, x: number, y: number) =>
  z >= 0 && z < N && x >= 0 && x < N && y >= 0 && y < N;

const KINDS: Record<string, { type: PieceType; vectors: readonly Vec[]; slides: boolean }> = {
  Q: {
    type: PieceType.Queen,
    vectors: [...ROOK_VECTORS, ...BISHOP_VECTORS, ...UNICORN_VECTORS],
    slides: true,
  },
  R: { type: PieceType.Rook, vectors: ROOK_VECTORS, slides: true },
  B: { type: PieceType.Bishop, vectors: BISHOP_VECTORS, slides: true },
  N: { type: PieceType.Knight, vectors: KNIGHT_VECTORS, slides: false },
  U: { type: PieceType.Unicorn, vectors: UNICORN_VECTORS, slides: true },
};

// The king's neighbours, and each kind's rays from each square
const near: number[][] = [];
for (let s = 0; s < S; s++) {
  const [z, x, y] = zxy(s);
  near.push(
    KING_VECTORS.filter(([dz, dx, dy]) => inside(z + dz, x + dx, y + dy)).map(([dz, dx, dy]) =>
      at(z + dz, x + dx, y + dy),
    ),
  );
}
const adjacent = (a: number, b: number) => near[a].includes(b);
const raysOf = (kind: string): number[][][] => {
  const { vectors, slides } = KINDS[kind];
  const out: number[][][] = [];
  for (let s = 0; s < S; s++) {
    const [z, x, y] = zxy(s);
    out.push(
      vectors.map(([dz, dx, dy]) => {
        const ray: number[] = [];
        for (let k = 1; inside(z + dz * k, x + dx * k, y + dy * k); k++) {
          ray.push(at(z + dz * k, x + dx * k, y + dy * k));
          if (!slides) break;
        }
        return ray;
      }),
    );
  }
  return out;
};
const RAYS = Object.fromEntries(Object.keys(KINDS).map((k) => [k, raysOf(k)]));

/** Whether a piece of `kind` on `from` attacks `to`, with only `blockers` in the way. */
const attacks = (kind: string, from: number, to: number, blockers: readonly number[]) => {
  for (const ray of RAYS[kind][from])
    for (const sq of ray) {
      if (sq === to) return true;
      if (blockers.includes(sq)) break;
    }
  return false;
};

/** Every mate with the bare king to move: the strong king, its pieces, the bare king. */
function mates(army: string[], onMate: (wk: number, bk: number, ps: number[]) => void): number {
  let count = 0;
  const ps = new Array<number>(army.length);
  const place = (i: number, wk: number, bk: number): void => {
    if (i === army.length) {
      // In check
      const checked = army.some((k, j) =>
        attacks(k, ps[j], bk, [wk, ...ps.filter((_, m) => m !== j)]),
      );
      if (!checked) return;
      // No square to go to: the king leaves bk, so bk blocks nothing; taking a piece removes it
      for (const t of near[bk]) {
        if (t === wk || adjacent(wk, t)) continue;
        const left = ps.filter((p) => p !== t);
        if (left.length < ps.length && adjacent(wk, t)) continue;
        const covered = army.some(
          (k, j) => ps[j] !== t && attacks(k, ps[j], t, [wk, ...left.filter((p) => p !== ps[j])]),
        );
        if (!covered) return;
      }
      count++;
      onMate(wk, bk, [...ps]);
      return;
    }
    for (let s = 0; s < S; s++) {
      if (s === wk || s === bk || ps.slice(0, i).includes(s)) continue;
      ps[i] = s;
      place(i + 1, wk, bk);
    }
  };
  for (let wk = 0; wk < S; wk++)
    for (let bk = 0; bk < S; bk++) if (wk !== bk && !adjacent(wk, bk)) place(0, wk, bk);
  return count;
}

const coord = (s: number) => {
  const [z, x, y] = zxy(s);
  return { x, y, z };
};
const boardOf = (army: string[], wk: number, bk: number, ps: number[]) => {
  const board = new Board();
  board.setPiece(coord(wk), { type: PieceType.King, color: 'white' });
  board.setPiece(coord(bk), { type: PieceType.King, color: 'black' });
  army.forEach((k, j) => board.setPiece(coord(ps[j]), { type: KINDS[k].type, color: 'white' }));
  return board;
};

// Endings that can never mate (engine/draws.ts) and, to show the count finds
// mates where there are some, endings that can
const DEAD = [['R'], ['B'], ['N'], ['U'], ['U', 'R'], ['U', 'B'], ['U', 'N'], ['U', 'U']];
const LIVE = [['Q'], ['R', 'R'], ['R', 'B'], ['R', 'N'], ['B', 'B'], ['B', 'N'], ['N', 'N']];
let checked = 0;
for (const army of [...LIVE, ...DEAD]) {
  const start = performance.now();
  const found = mates(army, (wk, bk, ps) => {
    // Every mate is a mate to the engine too (one in fifty, for time)
    if (checked++ % 50 !== 0) return;
    if (!boardOf(army, wk, bk, ps).isCheckmate('black'))
      throw new Error(`not a mate to the engine: ${army.join('')} ${wk} ${bk} ${ps}`);
  });
  const secs = ((performance.now() - start) / 1000).toFixed(0);
  console.log(`K+${army.join('+')} vs K: ${found} mates (${secs} s)`);
  if (DEAD.includes(army) && found !== 0) process.exitCode = 1;
}
// ...and a sample of positions the count calls no mate are none to the engine
let random = 12345;
const next = () => (random = (random * 1103515245 + 12345) & 0x7fffffff) % S;
for (let i = 0; i < 20000; i++) {
  const army = DEAD[i % DEAD.length];
  const squares = new Set<number>();
  while (squares.size < army.length + 2) squares.add(next());
  const [wk, bk, ...ps] = [...squares];
  if (adjacent(wk, bk)) continue;
  if (boardOf(army, wk, bk, ps).isCheckmate('black'))
    throw new Error(`a mate the count missed: ${army.join('')} ${wk} ${bk} ${ps}`);
}
console.log(
  `the engine agrees on ${Math.ceil(checked / 50)} of the ${checked} mates (one in fifty) and on 20,000 random dead positions`,
);
// The moves checked, as engine/draws.test.ts pins them
const moves = [N, KING_VECTORS, ROOK_VECTORS, BISHOP_VECTORS, KNIGHT_VECTORS, UNICORN_VECTORS];
console.log(
  `moves fingerprint ${createHash('sha256').update(JSON.stringify(moves)).digest('hex').slice(0, 16)}`,
);
