// What the computer's judgement (evaluate.ts) adds up over the pieces: their
// values, the piece-square tables and how near each cell is to a king. The
// board (position.ts) keeps these sums as each move is played, so a position
// is judged without visiting its pieces.
//
// Material uses this board's values (game/material.ts: measured by self-play,
// queen 9.8, knight 3.2, bishop 2.95, rook 2.45, unicorn 1.4). On top of it,
// what a club player looks for: pieces brought out towards the middle of the
// cube, pawns pushed on towards their last square (counted more as the board
// empties), the king kept home behind its pawns while queens and knights are
// about and brought out once they are gone.

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
} from './cells';

export const VALUE = new Int16Array(8);
VALUE[PAWN] = 100;
VALUE[KNIGHT] = 320;
VALUE[BISHOP] = 295;
VALUE[ROOK] = 245;
VALUE[UNICORN] = 140;
VALUE[QUEEN] = 980;
VALUE[KING] = 0;

/** Each piece's weight in the game's phase: the opening's 24 down to the endgame's 0. */
export const PHASE = [0, 0, 1, 1, 1, 1, 4, 0];
export const PHASE_MAX = 24;

/** From the middle of the cube (0) to a corner (6), in steps along the axes. */
export const CENTRE = new Int8Array(CELLS);
/** Chebyshev distance between two cells. */
export const DIST = new Uint8Array(CELLS * CELLS);
/** How near a piece on one cell is to a king on another: 4 less the distance, or 0. */
export const NEAR = new Uint8Array(CELLS * CELLS);
for (let c = 0; c < CELLS; c++) {
  CENTRE[c] = Math.abs(CX[c] - 2) + Math.abs(CY[c] - 2) + Math.abs(CZ[c] - 2);
  for (let d = 0; d < CELLS; d++) {
    DIST[c * CELLS + d] = Math.max(
      Math.abs(CX[c] - CX[d]),
      Math.abs(CY[c] - CY[d]),
      Math.abs(CZ[c] - CZ[d]),
    );
    NEAR[c * CELLS + d] = Math.max(0, 4 - DIST[c * CELLS + d]);
  }
}

/** A pawn's worth for how far along it is (rank + level, 0..8; 8 is its last square). */
const PAWN_STEP_MG = [0, 0, 6, 14, 24, 36, 52, 75, 0];
const PAWN_STEP_EG = [0, 0, 10, 24, 42, 66, 100, 150, 0];

// Piece-square tables, material included, from White's side: middlegame and
// endgame, per piece code and cell. Black's are White's turned through the
// centre of the cube.
export const MG = new Int16Array(16 * CELLS);
export const EG = new Int16Array(16 * CELLS);
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

/** How much a piece near the enemy king threatens it (pawns and kings: nothing). */
export const TROPISM_WEIGHT = [0, 0, 3, 2, 1, 2, 6, 0];
