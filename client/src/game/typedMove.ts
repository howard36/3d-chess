// A move typed as text, for players who cannot use a pointer on the 3D board
// (keyboard-only, screen readers). The notation is the one the move list
// shows: two cells as level-file-rank, e.g. "Ab2-Ab3", with "=Q" (or R, B, N,
// U) for a promotion.

import { fromZXY, toZXY } from '../engine/coords';
import type { Board, Move } from '../engine';
import { PROMOTION_TO_PIECE } from '../engine/pieces';
import type { Color, Promotion } from '../types/messages';

export type TypedMoveResult = { move: Move } | { error: string };

// Level letter, file letter, rank digit, either case; any of "-", "–", "x",
// spaces, or nothing between the cells; an optional "=" before the piece.
const PATTERN =
  /^\s*([a-e])([a-e])([1-5])\s*(?:[-–x]\s*)?([a-e])([a-e])([1-5])\s*(?:=?\s*([qrbnu]))?\s*$/i;

const cell = (level: string, file: string, rank: string) =>
  fromZXY(level.toUpperCase() + file.toLowerCase() + rank);

/** Resolves typed text to one of `color`'s legal moves on `board`, or says why it isn't one. */
export function parseTypedMove(text: string, board: Board, color: Color): TypedMoveResult {
  const m = PATTERN.exec(text);
  if (!m) return { error: 'Type a move as two cells, like Ab2-Ab3.' };
  const from = cell(m[1], m[2], m[3]);
  const to = cell(m[4], m[5], m[6]);
  const promotion = m[7] ? PROMOTION_TO_PIECE[m[7].toUpperCase() as Promotion] : undefined;

  const piece = board.getPiece(from);
  if (!piece || piece.color !== color) return { error: `You have no piece on ${toZXY(from)}.` };
  const candidates = board
    .generateLegalMoves(from)
    .filter((c) => c.to.x === to.x && c.to.y === to.y && c.to.z === to.z);
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
