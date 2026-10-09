// Stepping through a game's record: the position after any of its moves,
// derived by replaying the record from the start as history.ts derives the
// latest, and where each of the history's controls (and keys) leads.
//
// The replay is made only while the player looks back (GameView), never as a
// move lands at the live position, and is carried on, not redone, as moves
// land while they look.

import { Board } from '../engine';
import type { PieceType } from '../engine';
import { moveFromMessage } from '../engine/protocol';
import type { MoveRecord } from '../types/messages';
import type { GameHistory, LastMove, Turn } from './history';

/** The game as it stood after some of its moves. */
export interface Position {
  /** The moves played to reach it (0: the starting position). */
  ply: number;
  board: Board;
  /** The side to move. */
  currentTurn: Turn;
  /** The move that reached it (none at the start). */
  lastMove: LastMove | undefined;
  /** The pieces each side had taken by then, in the order taken. */
  captured: Record<Turn, PieceType[]>;
}

/** The positions after each move of a record, the start first. */
export interface ReviewLine {
  /** The records replayed, as the history held them. */
  records: readonly MoveRecord[];
  /** `positions[n]` is the position after `n` moves, for every n up to `records.length`. */
  positions: readonly Position[];
}

const turnAfter = (ply: number): Turn => (ply % 2 === 0 ? 'white' : 'black');

const start = (): Position => ({
  ply: 0,
  board: Board.setupStartingPosition(),
  currentTurn: 'white',
  lastMove: undefined,
  captured: { white: [], black: [] },
});

/**
 * Every position of the game so far: the moves the history could replay
 * (`appliedMoveCount`; a record past one it could not play is left out).
 * Pass the previous line to carry it on when the history has only added
 * moves to the record it was made from (a move landing while the player
 * looks back): its positions are kept, the same objects, and only the new
 * moves are played.
 */
export function reviewLine(history: GameHistory, prev?: ReviewLine | null): ReviewLine {
  const records = history.moveRecords.slice(0, history.appliedMoveCount);
  const carried =
    !!prev &&
    prev.records.length <= records.length &&
    prev.records.every((r, i) => r === records[i]);
  if (carried && prev.records.length === records.length) return prev;
  const positions: Position[] = carried ? [...prev.positions] : [start()];
  for (let i = positions.length - 1; i < records.length; i++) {
    const at = positions[i];
    // Moves the history has already played: replaying them can't fail
    const move = moveFromMessage(records[i]);
    const taken = at.board.getPiece(move.to);
    const mover = turnAfter(i);
    positions.push({
      ply: i + 1,
      board: at.board.applyMove(move),
      currentTurn: turnAfter(i + 1),
      lastMove: { move, moveCount: i + 1, capturedPiece: taken },
      captured: taken
        ? { ...at.captured, [mover]: [...at.captured[mover], taken.type] }
        : at.captured,
    });
  }
  return { records, positions };
}

/** The ways through the record: the history's four controls. */
export type ReviewStep = 'first' | 'previous' | 'next' | 'latest';

/**
 * The ply a step leads to from the one shown, in a game of `latest` plies:
 * the start, one back, one on, or the latest, never past either end.
 */
export function stepTo(step: ReviewStep, shown: number, latest: number): number {
  switch (step) {
    case 'first':
      return 0;
    case 'previous':
      return Math.max(0, shown - 1);
    case 'next':
      return Math.min(latest, shown + 1);
    case 'latest':
      return latest;
  }
}

/** The step a key takes (← → Home End), or null for any other key. */
export function stepOfKey(key: string): ReviewStep | null {
  switch (key) {
    case 'ArrowLeft':
      return 'previous';
    case 'ArrowRight':
      return 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'latest';
    default:
      return null;
  }
}

/**
 * How a ply is written in the record: the move's number, with "…" for
 * Black's ("7… Ed4–Ba1"), or "Start" for the starting position.
 */
export function plyLabel(records: readonly MoveRecord[], ply: number): string {
  if (ply === 0) return 'Start';
  const n = Math.ceil(ply / 2);
  return `${n}${ply % 2 === 1 ? '.' : '…'} ${formatMove(records[ply - 1])}`;
}

/**
 * A move as the wire writes it (level-file-rank), with an en dash and the
 * promotion after "=", so a record this client cannot replay still lists.
 */
export const formatMove = (m: MoveRecord) =>
  `${m.from}–${m.to}${m.promotion ? `=${m.promotion}` : ''}`;
