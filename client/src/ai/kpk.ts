// King and pawn against king, solved exactly when it comes up: whether the
// side with the pawn wins with best play or it is a draw. The search can't
// tell the two apart: a pawn up looks winning until the search runs into the
// draw, which it may never do, since the stronger king can always wander
// without repeating a position. So the review, Hard and the computer weighing
// up a draw offer ask this instead (search.ts, `endgames`).
//
// Nothing is stored ahead of time. A pawn only goes forward, so the positions
// reachable from one stand the pawn on the squares ahead of it; the first
// question about a pawn's square solves it and those, backwards from mate,
// stalemate and the pawn lost, the most advanced first (about 10 ms a square,
// a third of a second for a pawn that hasn't moved), and keeps them.

import { pawnCaptureDeltas } from '../engine/pieces';
import { CELLS, CX, CY, CZ, DIST, cellOf } from './position';

const inBoard = (x: number, y: number, z: number) =>
  x >= 0 && x < 5 && y >= 0 && y < 5 && z >= 0 && z < 5;

// Every square a king steps to from each square (26 directions, the queen's)
const DIRS: [number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) DIRS.push([dx, dy, dz]);
const NEAR = new Int8Array(CELLS * 26);
const NEAR_LEN = new Uint8Array(CELLS);
// White's pawn: its two steps (forward a rank, up a level) and the squares it attacks
const FORWARD = new Int8Array(CELLS).fill(-1);
const UP = new Int8Array(CELLS).fill(-1);
const ATTACKS = new Uint8Array(CELLS * CELLS);
for (let c = 0; c < CELLS; c++) {
  const x = CX[c];
  const y = CY[c];
  const z = CZ[c];
  for (const [dx, dy, dz] of DIRS)
    if (inBoard(x + dx, y + dy, z + dz))
      NEAR[c * 26 + NEAR_LEN[c]++] = cellOf(x + dx, y + dy, z + dz);
  if (inBoard(x, y + 1, z)) FORWARD[c] = cellOf(x, y + 1, z);
  if (inBoard(x, y, z + 1)) UP[c] = cellOf(x, y, z + 1);
  for (const [dx, dy, dz] of pawnCaptureDeltas(1))
    if (inBoard(x + dx, y + dy, z + dz)) ATTACKS[c * CELLS + cellOf(x + dx, y + dy, z + dz)] = 1;
}
/** White's pawn promotes on rank 5 of level E. */
const promotes = (c: number) => CY[c] === 4 && CZ[c] === 4;

/** Whether a queen on `q` attacks `t`, White's king on `wk` the only piece in the way. */
function queenAttacks(q: number, t: number, wk: number): boolean {
  const dx = CX[t] - CX[q];
  const dy = CY[t] - CY[q];
  const dz = CZ[t] - CZ[q];
  const n = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  // On one of its 26 lines: each step the same length in every axis that changes
  if (n === 0 || [dx, dy, dz].some((d) => d !== 0 && Math.abs(d) !== n)) return false;
  for (let i = 1; i < n; i++) {
    if (cellOf(CX[q] + (dx / n) * i, CY[q] + (dy / n) * i, CZ[q] + (dz / n) * i) === wk)
      return false;
  }
  return true;
}

/**
 * The pawn just promoted on `q` (to a queen), Black to move: a win, unless
 * Black takes the queen or has no move and isn't in check. (King and queen
 * against king is taken to win; a lesser piece is never needed here.)
 */
function promotionWins(q: number, wk: number, bk: number): boolean {
  if (DIST[bk * CELLS + q] <= 1 && DIST[wk * CELLS + q] > 1) return false;
  for (let i = 0; i < NEAR_LEN[bk]; i++) {
    const t = NEAR[bk * 26 + i];
    if (t !== q && DIST[wk * CELLS + t] > 1 && !queenAttacks(q, t, wk)) return true;
  }
  return queenAttacks(q, bk, wk);
}

/** Per pawn square (White's), a byte per (White's king, Black's king, side to move): 1 a win. */
const solved = new Map<number, Uint8Array>();
const index = (wk: number, bk: number, blackToMove: number) => (wk * CELLS + bk) * 2 + blackToMove;

/** Solves White's pawn on `p`, the squares ahead of it first. */
function solve(p: number): Uint8Array {
  const known = solved.get(p);
  if (known) return known;
  const steps = [FORWARD[p], UP[p]].filter((t) => t >= 0);
  for (const t of steps) if (!promotes(t)) solve(t);
  const win = new Uint8Array(CELLS * CELLS * 2);
  // Black's replies not yet known to lose, per Black-to-move position
  const left = new Uint8Array(CELLS * CELLS * 2);
  const queue = new Int32Array(CELLS * CELLS * 2);
  let head = 0;
  let tail = 0;
  const attacks = p * CELLS;
  for (let wk = 0; wk < CELLS; wk++) {
    if (wk === p) continue;
    for (let bk = 0; bk < CELLS; bk++) {
      if (bk === p || DIST[wk * CELLS + bk] <= 1) continue;
      // White to move (Black not in check): a pawn step that wins
      if (!ATTACKS[attacks + bk]) {
        for (const t of steps) {
          if (t === wk || t === bk) continue;
          if (promotes(t) ? promotionWins(t, wk, bk) : solved.get(t)![index(wk, bk, 1)]) {
            const i = index(wk, bk, 0);
            win[i] = 1;
            queue[tail++] = i;
            break;
          }
        }
      }
      // Black to move: its king's moves; taking the pawn draws
      let replies = 0;
      let takes = false;
      for (let n = 0; n < NEAR_LEN[bk]; n++) {
        const t = NEAR[bk * 26 + n];
        if (t === wk || DIST[wk * CELLS + t] <= 1 || ATTACKS[attacks + t]) continue;
        if (t === p) takes = true;
        else replies++;
      }
      if (takes) continue;
      const i = index(wk, bk, 1);
      if (replies > 0) left[i] = replies;
      else if (ATTACKS[attacks + bk]) {
        // Mated (no move, in check); with no move and no check it is stalemate
        win[i] = 1;
        queue[tail++] = i;
      }
    }
  }
  // Backwards from the wins: White wins if any move wins, Black loses if every move loses
  while (head < tail) {
    const s = queue[head++];
    const wk = Math.floor(s / (2 * CELLS));
    const bk = (s >> 1) % CELLS;
    if (s & 1) {
      // Black to move and lost: White's king got here from beside its square
      if (ATTACKS[attacks + bk]) continue;
      for (let n = 0; n < NEAR_LEN[wk]; n++) {
        const from = NEAR[wk * 26 + n];
        if (from === bk || from === p || DIST[from * CELLS + bk] <= 1) continue;
        const j = index(from, bk, 0);
        if (!win[j]) {
          win[j] = 1;
          queue[tail++] = j;
        }
      }
    } else {
      // White to move and won: one more of Black's replies loses
      for (let n = 0; n < NEAR_LEN[bk]; n++) {
        const from = NEAR[bk * 26 + n];
        if (from === wk || from === p || DIST[wk * CELLS + from] <= 1) continue;
        const j = index(wk, from, 1);
        if (left[j] > 0 && --left[j] === 0) {
          win[j] = 1;
          queue[tail++] = j;
        }
      }
    }
  }
  solved.set(p, win);
  return win;
}

// Black's pawn is White's turned through the centre of the cube
const turn = (c: number) => CELLS - 1 - c;

/**
 * King and pawn against king: whether the side with the pawn wins with best
 * play (if not, it is a draw). `side` is the pawn's (0 White), `strong` its
 * king, `weak` the other king.
 */
export function kpkWins(
  pawn: number,
  side: number,
  strong: number,
  weak: number,
  strongToMove: boolean,
): boolean {
  const flip = side !== 0;
  const table = solve(flip ? turn(pawn) : pawn);
  const wk = flip ? turn(strong) : strong;
  const bk = flip ? turn(weak) : weak;
  return table[index(wk, bk, strongToMove ? 0 : 1)] === 1;
}
