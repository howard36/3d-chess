// The cube's cells and the piece codes, shared by the computer's board
// (position.ts) and its judgement (terms.ts, evaluate.ts).

// Piece codes: the type in the low three bits, BLACK set for Black's pieces
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const UNICORN = 5;
export const QUEEN = 6;
export const KING = 7;
export const BLACK = 8;

export const WHITE_SIDE = 0;
export const BLACK_SIDE = 1;

export const SIZE = 5;
export const CELLS = SIZE * SIZE * SIZE;
export const cellOf = (x: number, y: number, z: number) => z * 25 + x * 5 + y;

/** Each cell's file, rank and level. */
export const CX = new Int8Array(CELLS);
export const CY = new Int8Array(CELLS);
export const CZ = new Int8Array(CELLS);
for (let c = 0; c < CELLS; c++) {
  CZ[c] = Math.floor(c / 25);
  CX[c] = Math.floor(c / 5) % 5;
  CY[c] = c % 5;
}
