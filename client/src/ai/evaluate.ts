// How the computer judges a position, in centipawns for the side to move,
// by one of two sets of numbers (numbers.ts): the levels' or the expert's.
//
// Material and position together, in tables per piece and cell (position.ts):
// pieces brought out towards the middle of the cube, pawns pushed on towards
// their last square (counted more as the board empties), the king kept home
// behind its pawns while there is an attack to fear and brought to the middle
// after, each table blending a middlegame and an endgame half by the game's
// phase. On top: pieces with room to move and near the enemy king, the bishop
// pair, and, a side ahead, trading down and driving the bare king to a
// corner. The expert's numbers add four terms: the king's tables and the
// pressure on it blend by its own danger (the enemy's pieces and above all its
// queen) rather than the game's phase; own pawns beside the king; enemy
// pieces a pawn attacks; and having the move.

import {
  BLACK,
  BLACK_SIDE,
  CELLS,
  CENTRE,
  DIST,
  KING,
  PHASE_MAX,
  SIDE_HI,
  SIDE_LO,
  TERMS,
  T_BISHOPS,
  T_EG,
  T_FORCE,
  T_MATERIAL,
  T_MG,
  T_PHASE,
  T_PIECES,
  T_PRESSURE,
  T_QUEENS,
  T_SHIELD,
  T_THREATS,
  WHITE_SIDE,
} from './position';
import type { Position, Weights } from './position';
import type { EvalNumbers } from './numbers';

export { DIST } from './position';

const WHITE_KING = KING * CELLS;
const BLACK_KING = (KING | BLACK) * CELLS;

/** A king's danger (the expert's), 0 to 24, from the game's phase and the enemy's pieces and queen. */
const danger = (n: EvalNumbers, phase: number, enemyForce: number, enemyQueens: number) => {
  const f = enemyForce < 12 ? enemyForce : 12;
  const w =
    (1 - n.dangerForce - n.dangerQueen) * phase +
    2 * n.dangerForce * f +
    24 * n.dangerQueen * (enemyQueens > 0 ? 1 : 0);
  return w > 24 ? 24 : w;
};

/**
 * The position for the side to move, in centipawns (positive: better for
 * them); without the pieces' mobility unless `full`. The sums over the
 * pieces (position.ts) are kept by the board as moves are played.
 */
export function evaluate(pos: Position, full = true): number {
  const w = pos.w;
  const n = w.numbers;
  const t = pos.terms;
  const o = pos.ply * TERMS;
  let phase = t[o + T_PHASE];
  if (phase > PHASE_MAX) phase = PHASE_MAX;
  let score: number;
  if (!w.extended) {
    let mg = t[o + T_MG];
    const eg = t[o + T_EG];
    // Pressure on a king counts while there are pieces to make it tell
    mg += t[o + T_PRESSURE] - t[o + T_PRESSURE + 1];
    // Two bishops cover both colours of the cube
    if (t[o + T_BISHOPS] >= 2) mg += n.bishopPair;
    if (t[o + T_BISHOPS + 1] >= 2) mg -= n.bishopPair;
    score = Math.round((mg * phase + eg * (PHASE_MAX - phase)) / PHASE_MAX);
  } else {
    // The kings' tables apart: they blend by each king's danger
    const wk = pos.king[0];
    const bk = pos.king[1];
    const kingMgW = wk >= 0 ? w.mg[WHITE_KING + wk] : 0;
    const kingEgW = wk >= 0 ? w.eg[WHITE_KING + wk] : 0;
    const kingMgB = bk >= 0 ? w.mg[BLACK_KING + bk] : 0;
    const kingEgB = bk >= 0 ? w.eg[BLACK_KING + bk] : 0;
    let mg = t[o + T_MG] - kingMgW - kingMgB;
    const eg = t[o + T_EG] - kingEgW - kingEgB;

    // Two bishops cover both colours of the cube
    if (t[o + T_BISHOPS] >= 2) mg += n.bishopPair;
    if (t[o + T_BISHOPS + 1] >= 2) mg -= n.bishopPair;

    // Each king's danger, in 24ths: its tables, the pressure on it and its
    // pawns beside it count by that
    const dangerW = danger(n, phase, t[o + T_FORCE + 1], t[o + T_QUEENS + 1]);
    const dangerB = danger(n, phase, t[o + T_FORCE], t[o + T_QUEENS]);
    let sum = mg * phase + eg * (PHASE_MAX - phase);
    sum +=
      kingMgW * dangerW + kingEgW * (24 - dangerW) + kingMgB * dangerB + kingEgB * (24 - dangerB);
    sum += t[o + T_PRESSURE] * dangerB - t[o + T_PRESSURE + 1] * dangerW;
    if (wk >= 0) sum += n.shield * t[o + T_SHIELD] * dangerW;
    if (bk >= 0) sum += -1 * n.shield * t[o + T_SHIELD + 1] * dangerB;
    // Pieces a pawn attacks
    sum += n.pawnThreat * 24 * t[o + T_THREATS];
    sum += -1 * n.pawnThreat * 24 * t[o + T_THREATS + 1];
    score = Math.round(sum / PHASE_MAX);
  }

  // Ahead on material: trade down (each trade makes the lead count for more),
  // and with the enemy short of pieces, drive the king to a corner and bring
  // our own up to help
  const white = t[o + T_MATERIAL];
  const black = t[o + T_MATERIAL + 1];
  const lead = white - black;
  if (Math.abs(lead) >= 150) {
    const strong = lead > 0 ? WHITE_SIDE : BLACK_SIDE;
    const sign = lead > 0 ? 1 : -1;
    const total = white + black;
    score += sign * Math.round((Math.abs(lead) * (7800 - Math.min(total, 7800))) / 7800 / 6);
    const weakKing = pos.king[strong ^ 1];
    const strongKing = pos.king[strong];
    if (t[o + T_PIECES + (strong ^ 1)] <= 300 && weakKing >= 0 && strongKing >= 0) {
      score += sign * (12 * CENTRE[weakKing] + 10 * (4 - DIST[weakKing * CELLS + strongKing]));
    }
  }

  let relative = pos.side === WHITE_SIDE ? score : -score;
  // Having the move
  if (n.tempo) relative += n.tempo;
  const scaled = toward50(relative, pos.halfmoves);
  return full ? scaled + mobilityScore(pos) : scaled;
}

/**
 * A lead counts for less as the fifty moves run out (a quarter less at the
 * last ply), so a side ahead makes progress, a capture or a pawn move, rather
 * than drift towards the draw.
 */
const toward50 = (score: number, halfmoves: number) =>
  halfmoves <= 0 ? score : Math.round((score * (400 - Math.min(halfmoves, 100))) / 400);

/**
 * What the pieces' room to move adds to evaluate(pos, false), for the side
 * to move: evaluate(pos) is the two together. Half the evaluation's cost,
 * so the quiescence search leaves it out where it cannot matter (LAZY).
 */
export const mobilityScore = (pos: Position) => {
  // Kept by the board's own hash (the side to move taken out), as the
  // transposition table keeps a search's results, for one set of weights
  if (pos.w !== owner) {
    owner = pos.w;
    age++;
  }
  const black = pos.side !== WHITE_SIDE;
  const lo = black ? pos.hashLo ^ SIDE_LO : pos.hashLo;
  const hi = black ? pos.hashHi ^ SIDE_HI : pos.hashHi;
  const slot = lo & MOBILITY_MASK;
  let m: number;
  if (mobilityAge[slot] === age && mobilityCheck[slot] === hi) {
    m = mobilityValue[slot];
  } else {
    m = pos.mobility(pos.w.mobility);
    mobilityAge[slot] = age;
    mobilityCheck[slot] = hi;
    mobilityValue[slot] = m;
  }
  return toward50(black ? -m : m, pos.halfmoves);
};

/**
 * The boards' mobility met in a search, by slot (the hash's low bits) with
 * the high half to check: a board's mobility is the same wherever the search
 * meets it again (the next iteration, a re-search, another move order).
 * forgetMobility() at each search's start empties it (and the first time makes
 * it), so a search costs the same whatever searched before it on the thread.
 */
const MOBILITY_MASK = (1 << 16) - 1;
// Made at the first search's start, not when the worker loads (until then
// nothing is kept: a read past the end is never a match, a write is dropped)
let mobilityCheck = new Int32Array(0);
let mobilityValue = new Int32Array(0);
let mobilityAge = new Int32Array(0);
let age = 1;
// The weights the kept mobility was counted by: another set forgets it
let owner: Weights | null = null;

export const forgetMobility = () => {
  if (mobilityAge.length === 0) {
    mobilityCheck = new Int32Array(MOBILITY_MASK + 1);
    mobilityValue = new Int32Array(MOBILITY_MASK + 1);
    mobilityAge = new Int32Array(MOBILITY_MASK + 1);
  }
  age++;
};

/** The most mobility is taken to swing a position by. */
export const LAZY = 150;
