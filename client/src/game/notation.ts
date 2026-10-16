// How the record writes a move: the piece (an icon on screen), the whole
// starting square only where another piece of its kind could make the same
// move, "x" for a capture (or "–" after a starting square, for a move that
// takes nothing), the destination, the piece a pawn promotes to, and "+" for
// check or "#" for mate: ♘xBb3+, ♙Cd2xCc3, ♙Cc2–Cc3, ♙Ed5=♕, ♕Ee5#.
//
// The wire keeps its own form (Bb1-Cb1): this is only how the record is shown.

import { PieceType } from '../engine';
import type { Board, Coord, Move } from '../engine';
import { toZXY } from '../engine/coords';

/** A move as the record writes it. */
export interface MoveNotation {
  /** The piece that moved (a pawn, for a promotion). */
  piece: PieceType;
  /** Its starting square, where another piece of its kind could make the same move. */
  from: string | null;
  capture: boolean;
  to: string;
  /** What a pawn became. */
  promotion: PieceType | null;
  /** The move gives check, or mate. */
  check: '' | '+' | '#';
}

const sameSquare = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * Whether a piece of the mover's kind and side other than the mover could
 * also move to the destination: then the move needs its starting square.
 * Only pieces of that kind are asked, and only those whose moves reach the
 * square are tested for leaving their king safe.
 */
function ambiguous(board: Board, move: Move): boolean {
  const mover = board.getPiece(move.from);
  if (!mover) return false;
  for (let z = 0; z < 5; z++) {
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const at = { x, y, z };
        const other = board.getPiece(at);
        if (!other || other.type !== mover.type || other.color !== mover.color) continue;
        if (sameSquare(at, move.from)) continue;
        if (!board.generatePotentialMoves(at).some((m) => sameSquare(m.to, move.to))) continue;
        if (board.generateLegalMoves(at).some((m) => sameSquare(m.to, move.to))) return true;
      }
    }
  }
  return false;
}

/**
 * The record's notation of `move`, played on `board` to give `after`.
 * `mate` marks a move that ends the game in mate (the caller knows: the
 * history's result, or a test of `after` for a move not played).
 */
export function notateMove(board: Board, move: Move, after: Board, mate = false): MoveNotation {
  const mover = board.getPiece(move.from);
  if (!mover) throw new Error(`No piece at ${toZXY(move.from)} to notate a move for.`);
  const opponent = mover.color === 'white' ? 'black' : 'white';
  return {
    piece: mover.type,
    from: ambiguous(board, move) ? toZXY(move.from) : null,
    capture: !!board.getPiece(move.to),
    to: toZXY(move.to),
    promotion: move.promotion ?? null,
    check: mate ? '#' : after.inCheck(opponent) ? '+' : '',
  };
}

/**
 * The notation of a move not played (the review's better move): its check
 * and mate tested on the position it leads to.
 */
export function notateCandidate(board: Board, move: Move): MoveNotation {
  const after = board.applyMove(move);
  const mover = board.getPiece(move.from);
  const opponent = mover?.color === 'white' ? 'black' : 'white';
  return notateMove(board, move, after, after.isCheckmate(opponent));
}

/** The squares after the piece's icon: "xBb3", "Cd2xCc3", "Cc2–Cc3", "Cc3". */
export function notationSquares(n: MoveNotation): string {
  const joint = n.capture ? 'x' : n.from ? '–' : '';
  return `${n.from ?? ''}${joint}${n.to}`;
}

const named = (piece: PieceType) => piece.toLowerCase();

/** The move in words, for a screen reader: "Pawn Cd2 takes Cc3, check". */
export function notationWords(n: MoveNotation): string {
  const where = `${n.capture ? 'takes' : 'to'} ${n.to}`;
  const promotes = n.promotion ? `, promotes to ${named(n.promotion)}` : '';
  const check = n.check === '#' ? ', checkmate' : n.check === '+' ? ', check' : '';
  return `${n.piece}${n.from ? ` ${n.from}` : ''} ${where}${promotes}${check}`;
}
