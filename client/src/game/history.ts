// The played game, derived from the socket's message log.
//
// The client never mutates a board: it replays the move record from the fixed
// starting position (README, "Event-sourced client state"). The record is the
// LATEST game_state snapshot plus the move_made messages after it — every
// reconnect replays the full history in a fresh snapshot that supersedes the
// earlier ones, so counting older messages again would duplicate moves.

import { Board } from '../engine';
import type { Move, Piece } from '../engine';
import { moveFromMessage } from '../engine/protocol';
import type { GameState, MoveMade, MoveRecord, WebSocketMessage } from '../types/messages';

export type Turn = 'white' | 'black';

export interface GameOver {
  result: 'checkmate' | 'stalemate';
  /** The side that delivered mate; absent for a stalemate. */
  winner?: Turn;
}

export interface LastMove {
  move: Move;
  /** Moves applied so far; increments exactly once per new move. */
  moveCount: number;
  /** Piece that stood on move.to before the move, if the move captured. */
  capturedPiece: Piece | null;
}

export interface GameHistory {
  /** The latest game_state snapshot, if this log holds one. */
  snapshot: GameState | undefined;
  /** The full move record: the snapshot's moves plus every move_made after it. */
  moveRecords: MoveRecord[];
  /** Position after the last applied move. */
  board: Board;
  /** How many of `moveRecords` were applied (all of them unless replay failed). */
  appliedMoveCount: number;
  /** White moves first; alternates with each applied move. */
  currentTurn: Turn;
  lastMove: LastMove | undefined;
  /**
   * Index of the first record this client could not replay, or null. The
   * server records any shape-valid, turn-correct move without checking
   * legality, so a buggy or version-skewed client can have written a move
   * this engine can't apply (or one that leaves the position unprocessable,
   * e.g. a captured king). Stopping there keeps the game viewable at the last
   * good position instead of throwing mid-render.
   */
  replayFailedAt: number | null;
  /** Null while the game is on, or when replay failed (the position shown is not final). */
  gameOver: GameOver | null;
}

/** The record in the log: the latest game_state (if any) and the move_made messages after it. */
const locateRecord = (messages: WebSocketMessage[]) => {
  let snapshot: GameState | undefined;
  const tail: MoveMade[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === 'game_state') {
      snapshot = m;
      break;
    }
    if (m.type === 'move_made') tail.push(m);
  }
  tail.reverse();
  const moveRecords: MoveRecord[] = [...(snapshot?.moves ?? []), ...tail];
  return { snapshot, moveRecords };
};

/**
 * Whether `prev` was built from exactly this record. The socket log is
 * append-only and never copies messages, so the snapshot and each move
 * record can be compared by identity.
 */
const sameRecord = (
  prev: GameHistory,
  snapshot: GameState | undefined,
  moveRecords: MoveRecord[],
) =>
  prev.snapshot === snapshot &&
  prev.moveRecords.length === moveRecords.length &&
  prev.moveRecords.every((r, i) => r === moveRecords[i]);

const turnAfter = (moveCount: number): Turn => (moveCount % 2 === 0 ? 'white' : 'black');

const gameOverAt = (board: Board, turn: Turn): GameOver | null => {
  if (board.isCheckmate(turn)) {
    return { result: 'checkmate', winner: turn === 'white' ? 'black' : 'white' };
  }
  if (board.isStalemate(turn)) return { result: 'stalemate' };
  return null;
};

/**
 * Derives the game from the message log.
 *
 * Pass the previous result to get it back unchanged (same object) when the
 * move record has not changed — a presence or error message must not rebuild
 * the board, both because the replay is wasted work and because consumers key
 * off the board's identity (the 3D board clears its selection when the
 * position it was made against is replaced).
 */
export function deriveHistory(
  messages: WebSocketMessage[],
  prev?: GameHistory | null,
): GameHistory {
  const { snapshot, moveRecords } = locateRecord(messages);
  if (prev && sameRecord(prev, snapshot, moveRecords)) return prev;

  // positions[i] is the board after i applied moves.
  const positions: Board[] = [Board.setupStartingPosition()];
  let replayFailedAt: number | null = null;
  for (let i = 0; i < moveRecords.length; i++) {
    try {
      positions.push(positions[i].applyMove(moveFromMessage(moveRecords[i])));
    } catch {
      replayFailedAt = i;
      break;
    }
  }

  let gameOver: GameOver | null = null;
  if (replayFailedAt === null) {
    try {
      gameOver = gameOverAt(positions[positions.length - 1], turnAfter(moveRecords.length));
    } catch {
      // The last applied move left a position the rules can't evaluate (no
      // king to find): treat it like any other unplayable record.
      replayFailedAt = positions.length - 2;
      positions.pop();
    }
  }

  const appliedMoveCount = positions.length - 1;
  const board = positions[appliedMoveCount];
  let lastMove: LastMove | undefined;
  if (appliedMoveCount > 0) {
    // This record was applied successfully above, so converting it again can't throw.
    const move = moveFromMessage(moveRecords[appliedMoveCount - 1]);
    lastMove = {
      move,
      moveCount: appliedMoveCount,
      capturedPiece: positions[appliedMoveCount - 1].getPiece(move.to),
    };
  }

  return {
    snapshot,
    moveRecords,
    board,
    appliedMoveCount,
    currentTurn: turnAfter(appliedMoveCount),
    lastMove,
    replayFailedAt,
    gameOver,
  };
}
