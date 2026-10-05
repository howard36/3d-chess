// How the computer judges a position, in centipawns for the side to move.
//
// Material uses this board's values (game/material.ts: measured by self-play,
// queen 9.8, knight 3.2, bishop 2.95, rook 2.45, unicorn 1.4). On top of it,
// what a club player looks for: pieces brought out towards the middle of the
// cube, pawns pushed on towards their last square (counted more as the board
// empties), the king kept home behind its pawns while queens and knights are
// about and brought out once they are gone, pieces with room to move, and,
// a side ahead, trading down and driving the bare king to a corner.

import {
  BISHOP,
  BLACK,
  CELLS,
  CX,
  CY,
  CZ,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  UNICORN,
  WHITE_SIDE,
} from './position';
import type { Position } from './position';

export const VALUE = new Int16Array(8);
VALUE[PAWN] = 100;
VALUE[KNIGHT] = 320;
VALUE[BISHOP] = 295;
VALUE[ROOK] = 245;
VALUE[UNICORN] = 140;
VALUE[QUEEN] = 980;
VALUE[KING] = 0;

/** Each piece's weight in the game's phase: the opening's 24 down to the endgame's 0. */
const PHASE = [0, 0, 1, 1, 1, 1, 4, 0];
const PHASE_MAX = 24;

/** From the middle of the cube (0) to a corner (6), in steps along the axes. */
const CENTRE = new Int8Array(CELLS);
/** Chebyshev distance between two cells. */
export const DIST = new Uint8Array(CELLS * CELLS);
for (let c = 0; c < CELLS; c++) {
  CENTRE[c] = Math.abs(CX[c] - 2) + Math.abs(CY[c] - 2) + Math.abs(CZ[c] - 2);
  for (let d = 0; d < CELLS; d++)
    DIST[c * CELLS + d] = Math.max(
      Math.abs(CX[c] - CX[d]),
      Math.abs(CY[c] - CY[d]),
      Math.abs(CZ[c] - CZ[d]),
    );
}

/** A pawn's worth for how far along it is (rank + level, 0..8; 8 is its last square). */
const PAWN_STEP_MG = [0, 0, 6, 14, 24, 36, 52, 75, 0];
const PAWN_STEP_EG = [0, 0, 10, 24, 42, 66, 100, 150, 0];

// Piece-square tables, material included, from White's side: middlegame and
// endgame, per piece code and cell. Black's are White's turned through the
// centre of the cube.
const MG = new Int16Array(16 * CELLS);
const EG = new Int16Array(16 * CELLS);
const mirror = (c: number) => CELLS - 1 - c; // (x, y, z) -> (4 - x, 4 - y, 4 - z)
for (let c = 0; c < CELLS; c++) {
  const centre = CENTRE[c];
  const x = CX[c];
  const y = CY[c];
  const z = CZ[c];
  // White's home is rank 1 and level A: how far out a piece has come
  const out = y + z;
  const set = (type: number, mg: number, eg: number) => {
    MG[type * CELLS + c] = VALUE[type] + mg;
    EG[type * CELLS + c] = VALUE[type] + eg;
    MG[(type | BLACK) * CELLS + mirror(c)] = -(VALUE[type] + mg);
    EG[(type | BLACK) * CELLS + mirror(c)] = -(VALUE[type] + eg);
  };
  const fileBonus = x === 2 ? 6 : x === 1 || x === 3 ? 3 : 0;
  set(PAWN, PAWN_STEP_MG[out] + fileBonus, PAWN_STEP_EG[out]);
  // Developed: off the home rank and level
  const home = y === 0 && z === 0 ? -14 : 0;
  set(KNIGHT, 28 - 8 * centre + home, 18 - 6 * centre);
  set(BISHOP, 16 - 4 * centre + home, 10 - 3 * centre);
  set(UNICORN, 12 - 3 * centre + (y <= 1 && z === 0 ? -8 : 0), 8 - 2 * centre);
  set(ROOK, 6 - centre, 4 - centre);
  // The queen wants the middle, but not too soon (the knights and bishops first)
  set(QUEEN, 6 - 2 * centre, 10 - 3 * centre);
  // Home and behind its pawns while there is an attack to fear; to the middle after
  set(KING, -14 * out - 4 * Math.abs(x - 2), 24 - 8 * centre);
}

/** Positional terms beyond the tables, weighted per piece type. */
const MOBILITY_WEIGHT = [0, 0, 2, 2, 2, 2, 1, 0];
/** How much a piece near the enemy king threatens it. */
const TROPISM_WEIGHT = [0, 0, 3, 2, 1, 2, 6, 0];

/**
 * The position for the side to move, in centipawns (positive: better for
 * them); without the pieces' mobility unless `full`.
 */
export function evaluate(pos: Position, full = true): number {
  const board = pos.board;
  let mg = 0;
  let eg = 0;
  let phase = 0;
  // Material without pawns and kings, and with them, per side
  const pieces = [0, 0];
  const material = [0, 0];
  const bishops = [0, 0];
  let tropism = 0; // White's pressure on Black's king, less Black's on White's
  const wk = pos.king[0];
  const bk = pos.king[1];
  const occ = pos.occ;
  for (let word = 0; word < 8; word++) {
    let bits = occ[word];
    while (bits !== 0) {
      const low = bits & -bits;
      bits ^= low;
      const c = ((word & 3) << 5) | (31 - Math.clz32(low));
      const p = board[c];
      mg += MG[p * CELLS + c];
      eg += EG[p * CELLS + c];
      const type = p & 7;
      const side = p >> 3;
      phase += PHASE[type];
      material[side] += VALUE[type];
      if (type !== PAWN && type !== KING) {
        pieces[side] += VALUE[type];
        if (type === BISHOP) bishops[side]++;
        const enemyKing = side === WHITE_SIDE ? bk : wk;
        if (enemyKing >= 0) {
          const near = 4 - DIST[c * CELLS + enemyKing];
          if (near > 0) tropism += (side === WHITE_SIDE ? 1 : -1) * near * TROPISM_WEIGHT[type];
        }
      }
    }
  }
  if (phase > PHASE_MAX) phase = PHASE_MAX;

  // Pressure on a king counts while there are pieces to make it tell
  mg += tropism;
  // Two bishops cover both colours of the cube
  if (bishops[0] >= 2) mg += 20;
  if (bishops[1] >= 2) mg -= 20;

  let score = Math.round((mg * phase + eg * (PHASE_MAX - phase)) / PHASE_MAX);

  // Ahead on material: trade down (each trade makes the lead count for more),
  // and with the enemy short of pieces, drive the king to a corner and bring
  // our own up to help
  const lead = material[0] - material[1];
  if (Math.abs(lead) >= 150) {
    const strong = lead > 0 ? 0 : 1;
    const sign = lead > 0 ? 1 : -1;
    const total = material[0] + material[1];
    score += sign * Math.round((Math.abs(lead) * (7800 - Math.min(total, 7800))) / 7800 / 6);
    const weakKing = pos.king[strong ^ 1];
    const strongKing = pos.king[strong];
    if (pieces[strong ^ 1] <= 300 && weakKing >= 0 && strongKing >= 0) {
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
