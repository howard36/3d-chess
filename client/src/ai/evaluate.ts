// How the computer judges a position, in centipawns for the side to move.
//
// Material uses this board's values (game/material.ts: measured by self-play,
// queen 9.8, knight 3.2, bishop 2.95, rook 2.45, unicorn 1.4). On top of it,
// what a club player looks for: pieces brought out towards the middle of the
// cube, pawns pushed on towards their last square (counted more as the board
// empties), the king kept home behind its pawns while queens and knights are
// about and brought out once they are gone (position.ts), pieces with room to
// move and near the enemy king, and, a side ahead, trading down and driving
// the bare king to a corner.

import {
  BLACK_SIDE,
  CELLS,
  CENTRE,
  DIST,
  PHASE_MAX,
  TERMS,
  T_BISHOPS,
  T_EG,
  T_MATERIAL,
  T_MG,
  T_PHASE,
  T_PIECES,
  T_PRESSURE,
  WHITE_SIDE,
} from './position';
import type { Position } from './position';

export { DIST, VALUE } from './position';

/** Positional terms beyond the tables, weighted per piece type. */
const MOBILITY_WEIGHT = [0, 0, 2, 2, 2, 2, 1, 0];

/**
 * The position for the side to move, in centipawns (positive: better for
 * them); without the pieces' mobility unless `full`. The sums over the
 * pieces (position.ts) are kept by the board as moves are played.
 */
export function evaluate(pos: Position, full = true): number {
  const t = pos.terms;
  const o = pos.ply * TERMS;
  let mg = t[o + T_MG];
  const eg = t[o + T_EG];
  let phase = t[o + T_PHASE];
  if (phase > PHASE_MAX) phase = PHASE_MAX;

  // Pressure on a king counts while there are pieces to make it tell
  mg += t[o + T_PRESSURE] - t[o + T_PRESSURE + 1];
  // Two bishops cover both colours of the cube
  if (t[o + T_BISHOPS] >= 2) mg += 20;
  if (t[o + T_BISHOPS + 1] >= 2) mg -= 20;

  let score = Math.round((mg * phase + eg * (PHASE_MAX - phase)) / PHASE_MAX);

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

  const relative = pos.side === WHITE_SIDE ? score : -score;
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
  const m = pos.mobility(MOBILITY_WEIGHT);
  return toward50(pos.side === WHITE_SIDE ? m : -m, pos.halfmoves);
};

/** The most mobility is taken to swing a position by. */
export const LAZY = 150;
