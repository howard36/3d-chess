// How the computer judges a position, in centipawns for the side to move.
//
// Material and position together, in tables per piece and cell (position.ts):
// pieces brought out towards the middle of the cube, pawns pushed on towards
// their last square (counted more as the board empties). Each table blends a
// middlegame and an endgame half by the game's phase; the king's alone by its
// own danger, the enemy's pieces and above all its queen: home behind its
// pawns while there is an attack to fear, to the middle after. On top: pieces
// with room to move and near the enemy king, the bishop pair, pawns beside
// their king, pieces a pawn attacks, having the move, and, a side ahead,
// trading down and driving the bare king to a corner. The numbers were tuned for playing
// strength by self-play (research/evaluation/).

import {
  BLACK,
  BLACK_SIDE,
  CELLS,
  CENTRE,
  DIST,
  EG,
  KING,
  MG,
  PHASE_MAX,
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
import type { Position } from './position';

export { DIST, VALUE } from './position';

/** Positional terms beyond the tables, weighted per piece type. */
const MOBILITY_WEIGHT = [0, 0, 1, 1, 2, 3, 0, 0];
const BISHOP_PAIR = 28;
/** The king's danger: shares of the game's phase, the enemy's pieces and the enemy's queen. */
const DANGER_FORCE = 0.27;
const DANGER_QUEEN = 0.32;
/** Each own pawn beside the king, at the king's danger. */
const SHIELD = 12.5;
/** Each enemy piece (no pawn or king) a pawn attacks. */
const PAWN_THREAT = 39.2;
/** Having the move. */
const TEMPO = 19;
const WHITE_KING = KING * CELLS;
const BLACK_KING = (KING | BLACK) * CELLS;

/** A king's danger, 0 to 24, from the game's phase and the enemy's pieces and queen. */
const danger = (phase: number, enemyForce: number, enemyQueens: number) => {
  const f = enemyForce < 12 ? enemyForce : 12;
  const w =
    (1 - DANGER_FORCE - DANGER_QUEEN) * phase +
    2 * DANGER_FORCE * f +
    24 * DANGER_QUEEN * (enemyQueens > 0 ? 1 : 0);
  return w < 0 ? 0 : w > 24 ? 24 : w;
};

/**
 * The position for the side to move, in centipawns (positive: better for
 * them); without the pieces' mobility unless `full`. The sums over the
 * pieces (position.ts) are kept by the board as moves are played.
 */
export function evaluate(pos: Position, full = true): number {
  const t = pos.terms;
  const o = pos.ply * TERMS;
  let phase = t[o + T_PHASE];
  if (phase > PHASE_MAX) phase = PHASE_MAX;
  // The kings' tables apart: they blend by each king's danger
  const wk = pos.king[0];
  const bk = pos.king[1];
  const kingMgW = wk >= 0 ? MG[WHITE_KING + wk] : 0;
  const kingEgW = wk >= 0 ? EG[WHITE_KING + wk] : 0;
  const kingMgB = bk >= 0 ? MG[BLACK_KING + bk] : 0;
  const kingEgB = bk >= 0 ? EG[BLACK_KING + bk] : 0;
  let mg = t[o + T_MG] - kingMgW - kingMgB;
  const eg = t[o + T_EG] - kingEgW - kingEgB;

  // Two bishops cover both colours of the cube
  if (t[o + T_BISHOPS] >= 2) mg += BISHOP_PAIR;
  if (t[o + T_BISHOPS + 1] >= 2) mg -= BISHOP_PAIR;

  // Each king's danger, in 24ths: its tables, the pressure on it and its
  // pawns beside it count by that
  const dangerW = danger(phase, t[o + T_FORCE + 1], t[o + T_QUEENS + 1]);
  const dangerB = danger(phase, t[o + T_FORCE], t[o + T_QUEENS]);
  let sum = mg * phase + eg * (PHASE_MAX - phase);
  sum +=
    kingMgW * dangerW + kingEgW * (24 - dangerW) + kingMgB * dangerB + kingEgB * (24 - dangerB);
  sum += t[o + T_PRESSURE] * dangerB - t[o + T_PRESSURE + 1] * dangerW;
  if (wk >= 0) sum += SHIELD * t[o + T_SHIELD] * dangerW;
  if (bk >= 0) sum += -1 * SHIELD * t[o + T_SHIELD + 1] * dangerB;
  // Pieces a pawn attacks
  sum += PAWN_THREAT * 24 * t[o + T_THREATS];
  sum += -1 * PAWN_THREAT * 24 * t[o + T_THREATS + 1];
  let score = Math.round(sum / PHASE_MAX);

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

  const relative = (pos.side === WHITE_SIDE ? score : -score) + TEMPO;
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
