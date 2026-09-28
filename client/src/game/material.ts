// What each side has taken, and who is ahead on material.
//
// The pieces taken come from the replayed record (GameHistory.captured): what
// stood on each move's destination, so a promoted piece that is taken counts
// as what it became. The lead is read off the position, which counts a
// promotion too: a pawn that became a queen is worth a queen.

import type { Board } from '../engine';
import { PieceType } from '../engine/pieces';
import { FILES, LEVELS, RANKS } from '../engine/coords';
import type { Turn } from './history';

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

// Most valuable first, the order taken pieces are shown and said in (a king
// is never taken)
const ORDER = [
  PieceType.Queen,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Unicorn,
  PieceType.Knight,
  PieceType.Pawn,
];

/** One kind of piece a side has taken, and how many. */
export interface TakenGroup {
  type: PieceType;
  count: number;
}

/** Pieces taken, one group per kind, most valuable first. */
export function groupTaken(types: readonly PieceType[]): TakenGroup[] {
  return ORDER.map((type) => ({ type, count: types.filter((t) => t === type).length })).filter(
    (group) => group.count > 0,
  );
}

/** A side's material on the board, in pawns. */
export function materialOf(board: Board, side: Turn): number {
  let sum = 0;
  for (let z = 0; z < LEVELS.length; z++)
    for (let x = 0; x < FILES.length; x++)
      for (let y = 0; y < RANKS.length; y++) {
        const piece = board.getPiece({ x, y, z });
        if (piece?.color === side) sum += PIECE_VALUE[piece.type];
      }
  return sum;
}

/** How far `side` is ahead on material, in pawns (negative: behind). */
export function materialLead(board: Board, side: Turn): number {
  return materialOf(board, side) - materialOf(board, side === 'white' ? 'black' : 'white');
}

const NAME: Record<PieceType, string> = {
  [PieceType.King]: 'king',
  [PieceType.Queen]: 'queen',
  [PieceType.Rook]: 'rook',
  [PieceType.Bishop]: 'bishop',
  [PieceType.Unicorn]: 'unicorn',
  [PieceType.Knight]: 'knight',
  [PieceType.Pawn]: 'pawn',
};

/** "3 pawns", "a knight"; several joined as "a queen, 2 rooks and a pawn". */
const listOf = (groups: readonly TakenGroup[]) => {
  const parts = groups.map(({ type, count }) =>
    count === 1 ? `a ${NAME[type]}` : `${count} ${NAME[type]}s`,
  );
  return parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/**
 * What one side has taken, in words, for a screen reader: "You have taken a
 * knight and 3 pawns; you are 5 ahead." or "Your opponent has taken a
 * bishop." Empty when there is nothing to say.
 */
export function describeTaken(
  groups: readonly TakenGroup[],
  lead: number,
  who: 'you' | 'opponent',
): string {
  const you = who === 'you';
  if (groups.length === 0) {
    // Ahead without taking anything: a promotion
    if (lead <= 0) return '';
    return you ? `You are ${lead} ahead.` : `Your opponent is ${lead} ahead.`;
  }
  const taken = `${you ? 'You have' : 'Your opponent has'} taken ${listOf(groups)}`;
  return lead > 0 ? `${taken}; ${you ? 'you' : 'they'} are ${lead} ahead.` : `${taken}.`;
}
