// The played game, derived from the socket's message log.
//
// The client never mutates a board: it replays the move record from the fixed
// starting position (ARCHITECTURE.md, "Event-sourced client state"). The record is the
// LATEST game_state snapshot plus the move_made messages after it — every
// reconnect replays the full history in a fresh snapshot that supersedes the
// earlier ones, so counting older messages again would duplicate moves.

import { Board, PieceType } from '../engine';
import type { Move, Piece } from '../engine';
import { FIFTY_MOVE_PLIES, REPETITIONS, hashAfter, positionHash } from '../engine/draws';
import { moveFromMessage } from '../engine/protocol';
import type { GameState, MoveMade, MoveRecord, WebSocketMessage } from '../types/messages';

export type Turn = 'white' | 'black';

export interface GameOver {
  /**
   * Mate, or one of the draws: no legal move without being in check, the
   * same position for the third time, or fifty moves each with no capture
   * and no pawn move (engine/draws.ts).
   */
  result: 'checkmate' | 'stalemate' | 'repetition' | 'fifty-moves';
  /** The side that delivered mate; absent for a draw. */
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
  /** Position before the last applied move (null before the first). */
  boardBefore: Board | null;
  /** How many of `moveRecords` were applied (all of them unless replay failed). */
  appliedMoveCount: number;
  /** White moves first; alternates with each applied move. */
  currentTurn: Turn;
  lastMove: LastMove | undefined;
  /**
   * The pieces each side has taken, in the order taken: what stood on each
   * applied move's destination (a promoted piece counts as what it became).
   */
  captured: Record<Turn, PieceType[]>;
  /**
   * Index of the first record this client could not replay, or null. The
   * server records any shape-valid, turn-correct move without checking
   * legality, so a buggy or version-skewed client can have written a move
   * this engine can't apply, or one that captures a king and so leaves a
   * position the rules can't evaluate. Stopping there keeps the game viewable
   * at the last good position instead of throwing mid-render.
   */
  replayFailedAt: number | null;
  /**
   * The positions since the last capture or pawn move, oldest first, the
   * current one last (each a hash of the pieces and the side to move): the only
   * stretch in which a position can stand again, since neither can be taken
   * back. Its length less one is the plies played towards the fifty-move draw.
   */
  sinceIrreversible: readonly number[];
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

/**
 * How the game stands after the last move. A mate ends it even on the move
 * that would also complete a repetition or the fifty moves, as in chess.
 */
const gameOverAt = (board: Board, turn: Turn, positions: readonly number[]): GameOver | null => {
  if (board.isCheckmate(turn)) {
    return { result: 'checkmate', winner: turn === 'white' ? 'black' : 'white' };
  }
  if (board.isStalemate(turn)) return { result: 'stalemate' };
  const now = positions[positions.length - 1];
  if (positions.filter((p) => p === now).length >= REPETITIONS) return { result: 'repetition' };
  if (positions.length - 1 >= FIFTY_MOVE_PLIES) return { result: 'fifty-moves' };
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

  // Replay from the starting position, or carry on from `prev` when this
  // record only adds moves to the one it was made from (a move landing):
  // its boards are never touched, and new moves give new boards
  const extending =
    prev &&
    prev.snapshot === snapshot &&
    prev.replayFailedAt === null &&
    prev.moveRecords.length < moveRecords.length &&
    prev.moveRecords.every((r, i) => r === moveRecords[i]);
  let board = extending ? prev.board : Board.setupStartingPosition();
  // The board before the last applied move, for what that move captured
  let before = extending ? prev.boardBefore : null;
  const captured: Record<Turn, PieceType[]> = extending
    ? { white: [...prev.captured.white], black: [...prev.captured.black] }
    : { white: [], black: [] };
  let replayFailedAt: number | null = null;
  let appliedMoveCount = extending ? prev.appliedMoveCount : 0;
  const positions = extending
    ? [...prev.sinceIrreversible]
    : [positionHash(board, turnAfter(appliedMoveCount))];
  for (let i = appliedMoveCount; i < moveRecords.length; i++) {
    try {
      const move = moveFromMessage(moveRecords[i]);
      const next = board.applyMove(move);
      // The rules evaluate a position by finding each king (check detection),
      // so a record that captured one is unplayable from that move on.
      next.findKing('white');
      next.findKing('black');
      const taken = board.getPiece(move.to);
      if (taken) captured[turnAfter(i)].push(taken.type);
      // A capture or a pawn move can't be undone: no earlier position can stand again
      const hash = hashAfter(positions[positions.length - 1], board, next, move);
      if (taken || board.getPiece(move.from)?.type === PieceType.Pawn) positions.length = 0;
      positions.push(hash);
      before = board;
      board = next;
      appliedMoveCount = i + 1;
    } catch {
      replayFailedAt = i;
      break;
    }
  }

  const gameOver =
    replayFailedAt === null ? gameOverAt(board, turnAfter(appliedMoveCount), positions) : null;
  let lastMove: LastMove | undefined;
  if (appliedMoveCount > 0) {
    // This record was applied successfully above, so converting it again can't throw.
    const move = moveFromMessage(moveRecords[appliedMoveCount - 1]);
    lastMove = {
      move,
      moveCount: appliedMoveCount,
      capturedPiece: before!.getPiece(move.to),
    };
  }

  return {
    snapshot,
    moveRecords,
    board,
    boardBefore: before,
    appliedMoveCount,
    currentTurn: turnAfter(appliedMoveCount),
    lastMove,
    captured,
    replayFailedAt,
    sinceIrreversible: positions,
    gameOver,
  };
}
