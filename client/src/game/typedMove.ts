// A move typed as text, for players who cannot use a pointer on the 3D board
// (keyboard-only, screen readers). The notation is the one the move list
// shows: two cells as level-file-rank, e.g. "Bb1-Cb1", with "=Q" (or R, B, N,
// U) for a promotion.

import { fromZXY, sameCoord, toZXY } from '../engine/coords';
import type { Board, Move } from '../engine';
import { PROMOTION_TO_PIECE } from '../engine/pieces';
import type { Color, Promotion } from '../types/messages';

type TypedMoveResult = { move: Move } | { error: string };

// Level letter, file letter, rank digit, either case; any of "-", "–", "x",
// spaces, or nothing between the cells; an optional "=" before the piece.
const PATTERN =
  /^\s*([a-e])([a-e])([1-5])\s*(?:[-–x]\s*)?([a-e])([a-e])([1-5])\s*(?:=?\s*([qrbnu]))?\s*$/i;

// The same pattern with each run of spaces after a cell or "=" taken whole
// ((?=(\s*))\N, JavaScript's way of a possessive \s*). What follows those
// runs is never a space, so it reads every text as PATTERN does, but it
// cannot share a long run of spaces out between neighbouring \s* in every
// possible way before failing: PATTERN takes time quadratic in such a run
// (a legal move, 20,000 spaces and a stray character: 784 ms). It is a
// little slower on a short text, so it reads only long ones.
export const LONG_PATTERN =
  /^\s*([a-e])([a-e])([1-5])(?=(\s*))\4(?:[-–x]\s*)?([a-e])([a-e])([1-5])(?=(\s*))\8(?:=?(?=(\s*))\9([qrbnu]))?\s*$/i;
/** Longer texts go to LONG_PATTERN (a move is at most about a dozen characters). */
const LONG = 64;

const cell = (level: string, file: string, rank: string) =>
  fromZXY(level.toUpperCase() + file.toLowerCase() + rank);

/** Resolves typed text to one of `color`'s legal moves on `board`, or says why it isn't one. */
export function parseTypedMove(text: string, board: Board, color: Color): TypedMoveResult {
  const long = text.length > LONG;
  const m = (long ? LONG_PATTERN : PATTERN).exec(text);
  if (!m) return { error: 'Type a move as two cells, like Bb1-Cb1.' };
  // LONG_PATTERN's runs of spaces are groups of their own (4, 8 and 9)
  const [l1, f1, r1, l2, f2, r2, p] = long
    ? [m[1], m[2], m[3], m[5], m[6], m[7], m[10]]
    : [m[1], m[2], m[3], m[4], m[5], m[6], m[7]];
  const from = cell(l1, f1, r1);
  const to = cell(l2, f2, r2);
  const promotion = p ? PROMOTION_TO_PIECE[p.toUpperCase() as Promotion] : undefined;

  const piece = board.getPiece(from);
  if (!piece || piece.color !== color) return { error: `You have no piece on ${toZXY(from)}.` };
  const candidates = board.generateLegalMoves(from).filter((c) => sameCoord(c.to, to));
  if (candidates.length === 0) {
    return { error: `The piece on ${toZXY(from)} cannot move to ${toZXY(to)}.` };
  }
  const isPromotion = candidates.some((c) => c.promotion !== undefined);
  if (!isPromotion) {
    return promotion
      ? { error: `${toZXY(from)}-${toZXY(to)} is not a promotion.` }
      : { move: candidates[0] };
  }
  if (!promotion) {
    return { error: 'Say which piece to promote to: add =Q, =R, =B, =N or =U.' };
  }
  const chosen = candidates.find((c) => c.promotion === promotion);
  return chosen ? { move: chosen } : { error: 'A pawn cannot promote to that piece.' };
}
