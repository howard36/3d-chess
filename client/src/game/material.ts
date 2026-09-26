// Material taken so far, read off the current position.
//
// A position doesn't record its captures, but a starting army is fixed, so
// whatever is missing was taken. A promotion is the one way to gain a piece:
// every piece beyond the starting count is a promoted pawn, which is gone
// from the pawns without having been captured.

import type { Board } from '../engine';
import { PieceType } from '../engine/pieces';
import { FILES, LEVELS, RANKS } from '../engine/coords';

type Side = 'white' | 'black';

const START: Record<PieceType, number> = {
  [PieceType.King]: 1,
  [PieceType.Queen]: 1,
  [PieceType.Rook]: 2,
  [PieceType.Bishop]: 2,
  [PieceType.Knight]: 2,
  [PieceType.Unicorn]: 2,
  [PieceType.Pawn]: 10,
};

/** Conventional values; the unicorn is valued like the other minor pieces. */
export const PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.King]: 0,
  [PieceType.Queen]: 9,
  [PieceType.Rook]: 5,
  [PieceType.Bishop]: 3,
  [PieceType.Unicorn]: 3,
  [PieceType.Knight]: 3,
  [PieceType.Pawn]: 1,
};

// Most valuable first, the order a captured row is shown in.
const ORDER = [
  PieceType.Queen,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Unicorn,
  PieceType.Knight,
  PieceType.Pawn,
];

export interface MaterialBalance {
  /** Each side's pieces that have been captured, most valuable first. */
  lost: Record<Side, PieceType[]>;
  /** White's material minus Black's, in pawns (positive: White is ahead). */
  advantage: number;
}

const tally = (board: Board, side: Side) => {
  const counts = Object.fromEntries(Object.keys(START).map((t) => [t, 0])) as Record<
    PieceType,
    number
  >;
  for (let z = 0; z < LEVELS.length; z++)
    for (let x = 0; x < FILES.length; x++)
      for (let y = 0; y < RANKS.length; y++) {
        const piece = board.getPiece({ x, y, z });
        if (piece?.color === side) counts[piece.type]++;
      }
  return counts;
};

const lostBy = (board: Board, side: Side): PieceType[] => {
  const counts = tally(board, side);
  let promoted = 0;
  const lost: PieceType[] = [];
  for (const type of ORDER) {
    if (type === PieceType.Pawn) continue;
    promoted += Math.max(0, counts[type] - START[type]);
    for (let i = counts[type]; i < START[type]; i++) lost.push(type);
  }
  const pawnsLost = START[PieceType.Pawn] - counts[PieceType.Pawn] - promoted;
  for (let i = 0; i < pawnsLost; i++) lost.push(PieceType.Pawn);
  return lost;
};

const materialOf = (board: Board, side: Side) => {
  const counts = tally(board, side);
  return ORDER.reduce((sum, type) => sum + counts[type] * PIECE_VALUE[type], 0);
};

export function materialBalance(board: Board): MaterialBalance {
  return {
    lost: { white: lostBy(board, 'white'), black: lostBy(board, 'black') },
    advantage: materialOf(board, 'white') - materialOf(board, 'black'),
  };
}
