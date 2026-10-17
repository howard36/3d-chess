// What each side has taken, and who is ahead on material.
//
// The pieces taken come from the replayed record (GameHistory.captured): what
// stood on each move's destination, so a promoted piece that is taken counts
// as what it became. The lead is read off the position, which counts a
// promotion too: a pawn that became a queen is worth a queen.

import type { Board } from '../engine';
import { PieceType } from '../engine/pieces';
import { FILES, LEVELS, RANKS } from '../engine/coords';
import { otherSide } from './sides';
import type { Turn } from './history';

/**
 * Each piece's worth in tenths of a pawn (so sums stay exact), for this
 * board, not 2D chess's: measured by engine self-play of imbalances imposed
 * at random, from the start and from positions of played games, as a guide
 * to who is winning (ARCHITECTURE.md "Piece values"). A knight and a bishop
 * are worth the same, a rook nine tenths of either: on a 5-wide board it sees
 * 12 squares from anywhere and cannot mate alone. The unicorn, held to a
 * quarter of the board, is worth well under half a bishop, and the queen, the
 * only piece that mates alone, half as much again as its rook, bishop and
 * unicorn together.
 */
const PIECE_TENTHS: Record<PieceType, number> = {
  [PieceType.King]: 0,
  [PieceType.Queen]: 112,
  [PieceType.Knight]: 31,
  [PieceType.Bishop]: 31,
  [PieceType.Rook]: 28,
  [PieceType.Unicorn]: 12,
  [PieceType.Pawn]: 10,
};

// Most valuable first, the order taken pieces are shown and said in (a king
// is never taken)
const ORDER = [
  PieceType.Queen,
  PieceType.Knight,
  PieceType.Bishop,
  PieceType.Rook,
  PieceType.Unicorn,
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

/** A side's material on the board, in tenths of a pawn. */
function tenthsOf(board: Board, side: Turn): number {
  let sum = 0;
  for (let z = 0; z < LEVELS.length; z++)
    for (let x = 0; x < FILES.length; x++)
      for (let y = 0; y < RANKS.length; y++) {
        const piece = board.getPiece({ x, y, z });
        if (piece?.color === side) sum += PIECE_TENTHS[piece.type];
      }
  return sum;
}

/** A side's material on the board, in pawns. */
export function materialOf(board: Board, side: Turn): number {
  return tenthsOf(board, side) / 10;
}

/** How far `side` is ahead on material, in pawns (negative: behind), to a tenth. */
export function materialLead(board: Board, side: Turn): number {
  return (tenthsOf(board, side) - tenthsOf(board, otherSide(side))) / 10;
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
