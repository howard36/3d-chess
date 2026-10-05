// The two draws besides stalemate, as in chess: the same position (the same
// pieces on the same squares, the same side to move) for the third time, and
// fifty moves by each side with no capture and no pawn move. This board has
// no castling and no en passant, so a position is only its pieces and the
// side to move. Decided in game/history.ts for the game, and by the computer
// player's search on its own board (ai/position.ts).

import type { Board, Move } from './board';
import { PieceType } from './pieces';
import type { Piece } from './pieces';
import type { Coord } from './coords';

/** A position standing for the third time draws. */
export const REPETITIONS = 3;

/** Fifty moves each (a hundred plies) with no capture and no pawn move draw. */
export const FIFTY_MOVE_PLIES = 100;

// A position's hash (Zobrist): one random key per piece and square, and one
// for Black to move, combined by XOR, so a move changes it by its squares
// alone. Two halves, the high one 21 bits wide, make one safe integer of 53
// bits: two different positions share a hash about once in 10^15 tries.
const TYPES = Object.values(PieceType);
const SQUARES = 125;
const KEY_HI = new Int32Array(2 * TYPES.length * SQUARES);
const KEY_LO = new Int32Array(2 * TYPES.length * SQUARES);
let seed = 0x2545f491;
const next = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
};
for (let i = 0; i < KEY_HI.length; i++) {
  KEY_HI[i] = next() & 0x1fffff;
  KEY_LO[i] = next();
}
const BLACK_HI = next() & 0x1fffff;
const BLACK_LO = next();
const TYPE_INDEX = new Map(TYPES.map((t, i) => [t, i]));

const keyIndex = (piece: Piece, c: Coord) =>
  ((piece.color === 'white' ? 0 : TYPES.length) + TYPE_INDEX.get(piece.type)!) * SQUARES +
  c.z * 25 +
  c.x * 5 +
  c.y;

const join = (hi: number, lo: number) => hi * 2 ** 32 + (lo >>> 0);

/** The hash of `board` with `turn` to move. */
export function positionHash(board: Board, turn: 'white' | 'black'): number {
  let hi = turn === 'black' ? BLACK_HI : 0;
  let lo = turn === 'black' ? BLACK_LO : 0;
  for (let z = 0; z < 5; z++)
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const piece = board.getPiece({ x, y, z });
        if (!piece) continue;
        const k = keyIndex(piece, { x, y, z });
        hi ^= KEY_HI[k];
        lo ^= KEY_LO[k];
      }
  return join(hi, lo);
}

/**
 * The hash after `move`, from the hash before it: `before` and `after` are
 * the boards either side of the move (what left, what was taken, what
 * arrived: a promoted pawn arrives as its new piece).
 */
export function hashAfter(hash: number, before: Board, after: Board, move: Move): number {
  let hi = Math.floor(hash / 2 ** 32) ^ BLACK_HI;
  let lo = (hash % 2 ** 32 | 0) ^ BLACK_LO;
  const toggle = (piece: Piece | null, c: Coord) => {
    if (!piece) return;
    const k = keyIndex(piece, c);
    hi ^= KEY_HI[k];
    lo ^= KEY_LO[k];
  };
  toggle(before.getPiece(move.from), move.from);
  toggle(before.getPiece(move.to), move.to);
  toggle(after.getPiece(move.to), move.to);
  return join(hi, lo);
}
