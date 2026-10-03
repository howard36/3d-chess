// A game against the computer, played without the server: this stands in
// for it, answering the messages the game screen sends as the server would,
// so the screen derives everything from its log exactly as for a game
// between two people (README, "Event-sourced client state"). The game is
// kept in the browser (lib/computerGames.ts) and comes back on a reload.

import { Board } from '../engine';
import { moveFromMessage, moveToMessage } from '../engine/protocol';
import type { Difficulty } from '../ai/levels';
import type { Color, Error as ServerError, MoveRecord, WebSocketMessage } from '../types/messages';

export interface ComputerGame {
  id: string;
  /** The player's side; the computer has the other. */
  color: Color;
  difficulty: Difficulty;
  /** The computer has taken its seat (a beat after the game was made). */
  started: boolean;
  moves: MoveRecord[];
}

export interface Answer {
  /** The game after the message (the same object if it did not change). */
  game: ComputerGame | null;
  /** What the server would have sent back. */
  replies: WebSocketMessage[];
}

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** The side to move after `moves`. */
const turnAfter = (moves: readonly MoveRecord[]): Color =>
  moves.length % 2 === 0 ? 'white' : 'black';

/** The position after `moves`, or null if one of them cannot be played. */
const replay = (moves: readonly MoveRecord[]): Board | null => {
  let board = Board.setupStartingPosition();
  try {
    for (const m of moves) board = board.applyMove(moveFromMessage(m));
  } catch {
    return null;
  }
  return board;
};

/** Whether `record` is a legal move for the side to move on `board`. */
const isLegal = (board: Board, record: MoveRecord): boolean => {
  let move;
  try {
    move = moveFromMessage(record);
  } catch {
    return false;
  }
  const piece = board.getPiece(move.from);
  if (!piece || piece.color !== record.by) return false;
  return board
    .generateLegalMoves(move.from)
    .some(
      (m) =>
        m.to.x === move.to.x &&
        m.to.y === move.to.y &&
        m.to.z === move.to.z &&
        m.promotion === move.promotion,
    );
};

/** Whether the game has ended (the side to move has no legal move), or cannot go on. */
export function isOver(game: ComputerGame): boolean {
  const board = replay(game.moves);
  return !board || !board.hasLegalMove(turnAfter(game.moves));
}

/** Whether it is the computer's move in a game under way. */
export function computerToMove(game: ComputerGame | null): game is ComputerGame {
  return !!game && game.started && turnAfter(game.moves) !== game.color && !isOver(game);
}

const error = (code: ServerError['code'], message: string): WebSocketMessage => ({
  type: 'error',
  code,
  message,
});

/**
 * The server's answer to `msg` from the player of `game` (null: no such game
 * is stored under the page's id).
 */
export function answer(game: ComputerGame | null, gameId: string, msg: WebSocketMessage): Answer {
  const none = (replies: WebSocketMessage[]): Answer => ({ game, replies });
  if (msg.type === 'look_game' || msg.type === 'rejoin_game' || msg.type === 'join_game') {
    if (!game || game.id !== gameId) return none([error('invalid_game', 'No such game')]);
    if (msg.type === 'look_game')
      return none([{ type: 'game_info', gameId, seats: ['white', 'black'] }]);
    if (msg.type === 'join_game') return none([error('game_full', 'Game is full')]);
    return none([
      { type: 'game_state', color: game.color, started: game.started, moves: game.moves },
    ]);
  }
  if (msg.type === 'move') {
    if (!game) return none([error('invalid_game', 'No such game')]);
    if (!game.started) return none([error('game_not_started', 'The game has not started')]);
    const by = turnAfter(game.moves);
    if (by !== game.color) return none([error('wrong_turn', 'Not your turn')]);
    const record: MoveRecord = { by, from: msg.from, to: msg.to };
    if (msg.promotion) record.promotion = msg.promotion;
    const board = replay(game.moves);
    if (!board || !isLegal(board, record)) return none([error('invalid_move', 'Illegal move')]);
    return {
      game: { ...game, moves: [...game.moves, record] },
      replies: [{ type: 'move_made', ...record }],
    };
  }
  return none([error('invalid_message', 'Not available against the computer')]);
}

/** The computer takes its seat: the game begins. */
export function startGame(game: ComputerGame): Answer {
  if (game.started) return { game, replies: [] };
  return { game: { ...game, started: true }, replies: [{ type: 'game_start', color: game.color }] };
}

/**
 * The computer plays `move` (without its side), if it is its move and the
 * move is legal; otherwise nothing happens (a stale answer from its search).
 */
export function computerMove(
  game: ComputerGame,
  move: Pick<MoveRecord, 'from' | 'to' | 'promotion'>,
): Answer {
  if (!computerToMove(game)) return { game, replies: [] };
  const record: MoveRecord = { by: other(game.color), from: move.from, to: move.to };
  if (move.promotion) record.promotion = move.promotion;
  const board = replay(game.moves);
  if (!board || !isLegal(board, record)) return { game, replies: [] };
  return {
    game: { ...game, moves: [...game.moves, record] },
    replies: [{ type: 'move_made', ...record }],
  };
}

/** A legal move for the computer, should its search fail to answer. */
export function fallbackMove(
  game: ComputerGame,
): Pick<MoveRecord, 'from' | 'to' | 'promotion'> | null {
  const board = replay(game.moves);
  if (!board) return null;
  const moves = board.generateAllLegalMoves(turnAfter(game.moves));
  if (moves.length === 0) return null;
  const { from, to, promotion } = moveToMessage(moves[0]);
  return promotion ? { from, to, promotion } : { from, to };
}
